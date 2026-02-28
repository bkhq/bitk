import type { Subprocess } from 'bun'

// ---------- Types ----------

export type ProcessState = 'spawning' | 'running' | 'completed' | 'failed' | 'cancelled'

const TERMINAL_STATES: ReadonlySet<ProcessState> = new Set(['completed', 'failed', 'cancelled'])

export interface ManagedEntry<TMeta> {
  readonly id: string
  readonly group?: string
  readonly subprocess: Subprocess
  state: ProcessState
  readonly startedAt: Date
  finishedAt?: Date
  exitCode?: number
  readonly meta: TMeta
}

export interface ProcessManagerLogger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface ProcessManagerOptions {
  /** Active process limit. 0 = unlimited. Default: 0 */
  maxConcurrent?: number
  /** Delay (ms) before auto-removing a finished entry. 0 = no auto-removal. Default: 300_000 */
  autoCleanupDelayMs?: number
  /** GC interval (ms). 0 = disabled. Default: 600_000 */
  gcIntervalMs?: number
  /** Timeout (ms) before SIGKILL after interrupt. Default: 5_000 */
  killTimeoutMs?: number
  logger?: ProcessManagerLogger
}

export type StateChangeHandler<T> = (
  entry: ManagedEntry<T>,
  prev: ProcessState,
  next: ProcessState,
) => void
export type ProcessExitHandler<T> = (entry: ManagedEntry<T>, exitCode: number) => void
export type UnsubscribeFn = () => void

// ---------- ProcessManager ----------

export class ProcessManager<TMeta> {
  private entries = new Map<string, ManagedEntry<TMeta>>()
  private groupIndex = new Map<string, Set<string>>()
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private gcTimer: ReturnType<typeof setInterval> | null = null

  private stateChangeHandlers = new Map<number, StateChangeHandler<TMeta>>()
  private exitHandlers = new Map<number, ProcessExitHandler<TMeta>>()
  private nextHandlerId = 0

  private readonly maxConcurrent: number
  private readonly autoCleanupDelayMs: number
  private readonly killTimeoutMs: number
  private readonly log: ProcessManagerLogger

  constructor(
    private readonly name: string,
    options?: ProcessManagerOptions,
  ) {
    this.maxConcurrent = options?.maxConcurrent ?? 0
    this.autoCleanupDelayMs = options?.autoCleanupDelayMs ?? 300_000
    this.killTimeoutMs = options?.killTimeoutMs ?? 5_000
    this.log = options?.logger ?? { debug() {}, info() {}, warn() {}, error() {} }

    const gcIntervalMs = options?.gcIntervalMs ?? 600_000
    if (gcIntervalMs > 0) {
      this.gcTimer = setInterval(() => this.gc(), gcIntervalMs)
      if (this.gcTimer && typeof this.gcTimer === 'object' && 'unref' in this.gcTimer) {
        ;(this.gcTimer as NodeJS.Timeout).unref()
      }
    }
  }

  // ---- Registration & State Transitions ----

  register(
    id: string,
    subprocess: Subprocess,
    meta: TMeta,
    opts?: { group?: string; startAsRunning?: boolean },
  ): ManagedEntry<TMeta> {
    if (this.entries.has(id)) {
      throw new Error(`[${this.name}] Process already registered: ${id}`)
    }

    if (this.maxConcurrent > 0 && this.activeCount() >= this.maxConcurrent) {
      throw new Error(
        `[${this.name}] Concurrency limit reached (${this.activeCount()}/${this.maxConcurrent})`,
      )
    }

    const entry: ManagedEntry<TMeta> = {
      id,
      group: opts?.group,
      subprocess,
      state: opts?.startAsRunning ? 'running' : 'spawning',
      startedAt: new Date(),
      meta,
    }

    this.entries.set(id, entry)

    if (opts?.group) {
      let set = this.groupIndex.get(opts.group)
      if (!set) {
        set = new Set()
        this.groupIndex.set(opts.group, set)
      }
      set.add(id)
    }

    this.monitorExit(entry)
    this.log.debug?.({ pm: this.name, id, group: opts?.group, state: entry.state }, 'pm_registered')
    return entry
  }

  markRunning(id: string): void {
    this.transitionState(id, 'running')
  }

  markCompleted(id: string): void {
    this.transitionState(id, 'completed')
  }

  markFailed(id: string): void {
    this.transitionState(id, 'failed')
  }

  // ---- Termination ----

  async terminate(id: string, interruptFn?: () => void): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || TERMINAL_STATES.has(entry.state)) return

    if (interruptFn) {
      interruptFn()
    }

    this.transitionState(id, 'cancelled')

    const killTimeout = setTimeout(() => {
      try {
        entry.subprocess.kill(9)
      } catch {
        /* already dead */
      }
    }, this.killTimeoutMs)

    try {
      await entry.subprocess.exited
    } catch {
      /* ignore */
    } finally {
      clearTimeout(killTimeout)
      if (!entry.finishedAt) {
        entry.finishedAt = new Date()
      }
    }
  }

  async terminateGroup(
    group: string,
    interruptFn?: (entry: ManagedEntry<TMeta>) => void,
  ): Promise<void> {
    const ids = this.groupIndex.get(group)
    if (!ids) return
    await Promise.all(
      Array.from(ids).map((id) => {
        const entry = this.entries.get(id)
        return this.terminate(id, entry && interruptFn ? () => interruptFn(entry) : undefined)
      }),
    )
  }

  async terminateAll(): Promise<void> {
    await Promise.all(Array.from(this.entries.keys()).map((id) => this.terminate(id)))
  }

  forceKill(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    try {
      entry.subprocess.kill(9)
    } catch {
      /* already dead */
    }
    if (!TERMINAL_STATES.has(entry.state)) {
      this.transitionState(id, 'cancelled')
    }
    if (!entry.finishedAt) {
      entry.finishedAt = new Date()
    }
  }

  // ---- Queries ----

  get(id: string): ManagedEntry<TMeta> | undefined {
    return this.entries.get(id)
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  getActive(): ManagedEntry<TMeta>[] {
    return Array.from(this.entries.values()).filter((e) => this.isActive(e))
  }

  getActiveInGroup(group: string): ManagedEntry<TMeta>[] {
    const ids = this.groupIndex.get(group)
    if (!ids) return []
    const result: ManagedEntry<TMeta>[] = []
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry && this.isActive(entry)) {
        result.push(entry)
      }
    }
    return result
  }

  getFirstActiveInGroup(group: string): ManagedEntry<TMeta> | undefined {
    const ids = this.groupIndex.get(group)
    if (!ids) return undefined
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry && this.isActive(entry)) return entry
    }
    return undefined
  }

  hasActiveInGroup(group: string): boolean {
    return this.getFirstActiveInGroup(group) !== undefined
  }

  activeCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (this.isActive(entry)) count++
    }
    return count
  }

  size(): number {
    return this.entries.size
  }

  // ---- Events ----

  onStateChange(handler: StateChangeHandler<TMeta>): UnsubscribeFn {
    const id = this.nextHandlerId++
    this.stateChangeHandlers.set(id, handler)
    return () => {
      this.stateChangeHandlers.delete(id)
    }
  }

  onExit(handler: ProcessExitHandler<TMeta>): UnsubscribeFn {
    const id = this.nextHandlerId++
    this.exitHandlers.set(id, handler)
    return () => {
      this.exitHandlers.delete(id)
    }
  }

  // ---- Cleanup ----

  remove(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return

    const timer = this.cleanupTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.cleanupTimers.delete(id)
    }

    if (entry.group) {
      const set = this.groupIndex.get(entry.group)
      if (set) {
        set.delete(id)
        if (set.size === 0) this.groupIndex.delete(entry.group)
      }
    }

    this.entries.delete(id)
  }

  async dispose(): Promise<void> {
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = null
    }
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer)
    }
    this.cleanupTimers.clear()
    await this.terminateAll()
    this.entries.clear()
    this.groupIndex.clear()
    this.stateChangeHandlers.clear()
    this.exitHandlers.clear()
  }

  // ---- Internal ----

  private isActive(entry: ManagedEntry<TMeta>): boolean {
    return !TERMINAL_STATES.has(entry.state)
  }

  private transitionState(id: string, next: ProcessState): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const prev = entry.state
    if (TERMINAL_STATES.has(prev)) return // idempotent — already terminal
    ;(entry as { state: ProcessState }).state = next

    if (TERMINAL_STATES.has(next) && !entry.finishedAt) {
      entry.finishedAt = new Date()
    }

    this.emitStateChange(entry, prev, next)

    if (TERMINAL_STATES.has(next) && this.autoCleanupDelayMs > 0) {
      this.scheduleAutoCleanup(id)
    }
  }

  private monitorExit(entry: ManagedEntry<TMeta>): void {
    void entry.subprocess.exited
      .then((exitCode) => {
        const code = exitCode ?? 1
        entry.exitCode = code

        // Only transition if not already terminal (idempotent)
        if (!TERMINAL_STATES.has(entry.state)) {
          const next: ProcessState = code === 0 ? 'completed' : 'failed'
          this.transitionState(entry.id, next)
        } else if (!entry.finishedAt) {
          entry.finishedAt = new Date()
        }

        this.emitExit(entry, code)
      })
      .catch(() => {
        if (!TERMINAL_STATES.has(entry.state)) {
          this.transitionState(entry.id, 'failed')
        }
        this.emitExit(entry, entry.exitCode ?? 1)
      })
  }

  private scheduleAutoCleanup(id: string): void {
    const existing = this.cleanupTimers.get(id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(id)
      this.remove(id)
    }, this.autoCleanupDelayMs)
    this.cleanupTimers.set(id, timer)
  }

  private gc(): void {
    let cleaned = 0

    // Collect candidates first to avoid mutating entries during iteration
    const toRemove: string[] = []
    for (const [id, entry] of this.entries) {
      if (TERMINAL_STATES.has(entry.state) && !this.cleanupTimers.has(id)) {
        toRemove.push(id)
      }
    }
    for (const id of toRemove) {
      this.remove(id)
      cleaned++
    }

    // Clean orphan group index entries (collect before mutating)
    const emptyGroups: string[] = []
    for (const [group, ids] of this.groupIndex) {
      const orphans: string[] = []
      for (const id of ids) {
        if (!this.entries.has(id)) {
          orphans.push(id)
        }
      }
      for (const id of orphans) {
        ids.delete(id)
        cleaned++
      }
      if (ids.size === 0) {
        emptyGroups.push(group)
      }
    }
    for (const group of emptyGroups) {
      this.groupIndex.delete(group)
    }

    if (cleaned > 0) {
      this.log.debug?.({ pm: this.name, cleaned, remaining: this.entries.size }, 'pm_gc_sweep')
    }
  }

  private emitStateChange(
    entry: ManagedEntry<TMeta>,
    prev: ProcessState,
    next: ProcessState,
  ): void {
    for (const handler of this.stateChangeHandlers.values()) {
      try {
        handler(entry, prev, next)
      } catch {
        /* ignore callback errors */
      }
    }
  }

  private emitExit(entry: ManagedEntry<TMeta>, exitCode: number): void {
    for (const handler of this.exitHandlers.values()) {
      try {
        handler(entry, exitCode)
      } catch {
        /* ignore callback errors */
      }
    }
  }
}
