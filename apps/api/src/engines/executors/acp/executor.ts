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
} from '@/engines/types'
import {
  AcpLogNormalizer,
  normalizeAcpEvent,
  spawnAcpProcess,
} from './acp-client'
import type { AcpAgentId } from './agents'
import {
  getAcpAgentAvailability,
  getAcpAgents,
  getAcpLaunchCommand,
  parseAcpModel,
  queryScopedAcpModels,
} from './agents'

export class AcpExecutor implements EngineExecutor {
  readonly engineType = 'acp' as const
  readonly protocol = 'acp' as const
  readonly capabilities: EngineCapability[] = ['session-fork']

  /** Resolve agent ID: model string takes precedence, then SpawnOptions.agent, then 'gemini'. */
  private resolveAgentId(model: string | undefined, agent: string | undefined): AcpAgentId {
    const parsedModel = parseAcpModel(model)
    if (parsedModel) return parsedModel.agentId
    return (agent as AcpAgentId) ?? 'gemini'
  }

  async spawn(options: SpawnOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    const parsedModel = parseAcpModel(options.model)
    const agentId = this.resolveAgentId(options.model, options.agent)
    return spawnAcpProcess({
      cmd: getAcpLaunchCommand(agentId),
      workingDir: options.workingDir,
      prompt: options.prompt,
      permissionMode: options.permissionMode ?? 'auto',
      model: parsedModel?.modelId,
      env: {
        ...env.vars,
        ...(options.env ?? {}),
      },
    })
  }

  async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    const parsedModel = parseAcpModel(options.model)
    const agentId = this.resolveAgentId(options.model, options.agent)
    return spawnAcpProcess({
      cmd: getAcpLaunchCommand(agentId),
      workingDir: options.workingDir,
      prompt: options.prompt,
      permissionMode: options.permissionMode ?? 'auto',
      model: parsedModel?.modelId,
      sessionId: options.sessionId,
      env: {
        ...env.vars,
        ...(options.env ?? {}),
      },
    })
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    spawnedProcess.cancel()

    const timeout = setTimeout(() => {
      try {
        spawnedProcess.subprocess.kill(9)
      } catch {
        // already dead
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
      const agents = await Promise.all(getAcpAgents().map(agent => getAcpAgentAvailability(agent.id)))
      const installedAgents = agents.filter(agent => agent.installed)

      if (installedAgents.length === 0) {
        return {
          engineType: 'acp',
          installed: false,
          executable: false,
          authStatus: 'unknown',
          error: agents.map(agent => `${agent.agentId}: ${agent.error ?? 'not available'}`).join('; '),
        }
      }

      const authenticated = installedAgents.some(agent => agent.authStatus === 'authenticated')
      const unknownAuth = installedAgents.some(agent => agent.authStatus === 'unknown')

      return {
        engineType: 'acp',
        installed: true,
        executable: installedAgents.some(agent => agent.executable !== false),
        authStatus: authenticated ? 'authenticated' : (unknownAuth ? 'unknown' : 'unauthenticated'),
        version: installedAgents
          .map(agent => (agent.version ? `${agent.agentId}=${agent.version}` : null))
          .filter(Boolean)
          .join(', ') || undefined,
        binaryPath: installedAgents
          .map(agent => agent.binaryPath || agent.agentId)
          .join(', '),
      }
    } catch (error) {
      return {
        engineType: 'acp',
        installed: false,
        executable: false,
        authStatus: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getModels(): Promise<EngineModel[]> {
    const allModels = await Promise.allSettled(
      getAcpAgents().map(agent => queryScopedAcpModels(agent.id, process.cwd())),
    )

    return allModels.flatMap((result) => {
      if (result.status !== 'fulfilled') return []
      return result.value
    })
  }

  normalizeLog(rawLine: string): NormalizedLogEntry | null {
    const result = normalizeAcpEvent(rawLine)
    if (Array.isArray(result)) return result[0] ?? null
    return result
  }

  createNormalizer() {
    const normalizer = new AcpLogNormalizer()
    return {
      parse: (rawLine: string) => normalizer.parse(rawLine),
    }
  }
}
