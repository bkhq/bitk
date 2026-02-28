import type {
  EngineAvailability,
  EngineCapability,
  EngineExecutor,
  EngineModel,
  ExecutionEnv,
  FollowUpOptions,
  NormalizedLogEntry,
  SpawnedProcess,
  SpawnOptions,
} from '../../types'
import { safeEnv } from '../../safe-env'

/**
 * Gemini CLI executor — uses ACP (Agent Communication Protocol).
 *
 * Launch: `npx -y @google/gemini-cli`
 * Communication: ACP over stdin/stdout
 *
 * TODO: Implement spawn/follow-up when Gemini CLI protocol stabilizes.
 */
export class GeminiExecutor implements EngineExecutor {
  readonly engineType = 'gemini' as const
  readonly protocol = 'acp' as const
  readonly capabilities: EngineCapability[] = ['session-fork']

  async spawn(_options: SpawnOptions, _env: ExecutionEnv): Promise<SpawnedProcess> {
    // TODO: Implement Gemini CLI spawn
    // 1. Start `npx -y @google/gemini-cli` with appropriate flags
    // 2. Send initial prompt via ACP protocol
    // 3. Stream stdout for responses
    throw new Error('Gemini executor not yet implemented')
  }

  async spawnFollowUp(_options: FollowUpOptions, _env: ExecutionEnv): Promise<SpawnedProcess> {
    // TODO: Implement follow-up via ACP session continuation
    throw new Error('Gemini follow-up not yet implemented')
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    spawnedProcess.cancel()
    const timeout = setTimeout(() => {
      try {
        spawnedProcess.subprocess.kill(9)
      } catch {
        /* already dead */
      }
    }, 5000)

    try {
      await spawnedProcess.subprocess.exited
    } finally {
      clearTimeout(timeout)
    }
  }

  async getAvailability(): Promise<EngineAvailability> {
    try {
      const proc = Bun.spawn(['npx', '-y', '@google/gemini-cli', '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
      })

      const timer = setTimeout(() => proc.kill(), 10000)
      const exitCode = await proc.exited
      clearTimeout(timer)

      if (exitCode !== 0) {
        return { engineType: 'gemini', installed: false, authStatus: 'unknown' }
      }

      const stdout = await new Response(proc.stdout).text()
      const versionMatch = stdout.match(/(\d+\.\d+\.\d[\w.-]*)/)
      const version = versionMatch?.[1]

      // Check auth — GOOGLE_API_KEY, GEMINI_API_KEY, or ~/.gemini/oauth_creds.json
      let authStatus: EngineAvailability['authStatus'] = 'unknown'
      if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
        authStatus = 'authenticated'
      } else {
        const home = process.env.HOME ?? '/root'
        const configFile = Bun.file(`${home}/.gemini/oauth_creds.json`)
        if (await configFile.exists()) {
          authStatus = 'authenticated'
        } else {
          authStatus = 'unauthenticated'
        }
      }

      return {
        engineType: 'gemini',
        installed: true,
        executable: false, // spawn not yet implemented
        version,
        authStatus,
      }
    } catch (error) {
      return {
        engineType: 'gemini',
        installed: false,
        executable: false,
        authStatus: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getModels(): Promise<EngineModel[]> {
    try {
      // Gemini CLI — query via `gemini --list-models` or Google API
      // TODO: Implement proper model discovery when Gemini CLI supports it
      const proc = Bun.spawn(['npx', '-y', '@google/gemini-cli', '--list-models'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
      })

      const timer = setTimeout(() => proc.kill(), 10000)
      const exitCode = await proc.exited
      clearTimeout(timer)

      if (exitCode !== 0) {
        return []
      }

      const stdout = await new Response(proc.stdout).text()
      const models: EngineModel[] = []
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const idMatch = trimmed.match(/^(\S+)/)
        if (idMatch) {
          models.push({ id: idMatch[1]!, name: idMatch[1]! })
        }
      }
      return models
    } catch {
      return []
    }
  }

  normalizeLog(rawLine: string): NormalizedLogEntry | null {
    // TODO: Implement ACP log normalization for Gemini CLI
    try {
      const data = JSON.parse(rawLine)

      // ACP message types (placeholder — refine when protocol is finalized)
      if (data.type === 'response' || data.type === 'message') {
        return {
          entryType: 'assistant-message',
          content: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
          timestamp: data.timestamp ?? new Date().toISOString(),
        }
      }

      if (data.type === 'error') {
        return {
          entryType: 'error-message',
          content: data.message ?? data.error ?? 'Unknown error',
          timestamp: data.timestamp ?? new Date().toISOString(),
        }
      }

      if (data.type === 'tool_call' || data.type === 'function_call') {
        return {
          entryType: 'tool-use',
          content: `Tool: ${data.name ?? data.function ?? 'unknown'}`,
          timestamp: data.timestamp ?? new Date().toISOString(),
          metadata: { toolName: data.name, input: data.arguments ?? data.input },
        }
      }

      return null
    } catch {
      if (rawLine.trim()) {
        return {
          entryType: 'system-message',
          content: rawLine,
        }
      }
      return null
    }
  }
}
