import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { safeEnv } from '@/engines/safe-env'
import { resolveCommand, runCommand } from '@/engines/spawn'
import type { EngineAvailability, EngineModel } from '@/engines/types'
import { queryAcpModels } from '../acp-client'

export type AcpAgentId = 'gemini' | 'codex' | 'claude'

export interface AcpAgentDefinition {
  id: AcpAgentId
  label: string
  commandName: string
  npxFallback: string[]
  acpArgs: string[]
  authStatus: () => EngineAvailability['authStatus']
  verify: (cmd: string[]) => Promise<Pick<EngineAvailability, 'installed' | 'executable' | 'version' | 'binaryPath' | 'error'>>
}

export interface ParsedAcpModel {
  agentId: AcpAgentId
  modelId?: string
  raw: string
  scoped: boolean
}

export const ACP_MODEL_PREFIX = 'acp:'
export const DEFAULT_ACP_AGENT: AcpAgentId = 'gemini'

export function resolveBinaryOnly(commandName: string): string | null {
  const workBin = `/work/bin/${commandName}`
  if (existsSync(workBin)) return workBin

  const fromPath = resolveCommand(commandName)
  if (fromPath) return fromPath

  const home = process.env.HOME ?? ''
  if (home) {
    const candidates = [
      join(home, `.local/bin/${commandName}`),
      join(home, `.bun/bin/${commandName}`),
    ]
    const found = candidates.find(candidate => existsSync(candidate))
    if (found) return found
  }

  const usrLocal = `/usr/local/bin/${commandName}`
  if (existsSync(usrLocal)) return usrLocal

  return null
}

export async function verifyAcpCommand(
  cmd: string[],
  versionArgs: string[],
  binaryPath?: string | null,
): Promise<Pick<EngineAvailability, 'installed' | 'executable' | 'version' | 'binaryPath' | 'error'>> {
  try {
    const { code, stdout, stderr } = await runCommand(
      [...cmd, ...versionArgs],
      {
        env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
        stderr: 'pipe',
        timeout: 15000,
      },
    )

    if (code !== 0) {
      return {
        installed: false,
        executable: false,
        binaryPath: binaryPath ?? undefined,
        error: stderr || stdout || `Command exited with code ${code}`,
      }
    }

    const versionMatch = stdout.match(/(\d+\.\d+\.\d[\w.-]*)/)

    return {
      installed: true,
      executable: true,
      version: versionMatch?.[1],
      binaryPath: binaryPath ?? undefined,
    }
  } catch (error) {
    return {
      installed: false,
      executable: false,
      binaryPath: binaryPath ?? undefined,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export function parseAcpModelWithRegistry(
  model: string | null | undefined,
  registry: Record<AcpAgentId, AcpAgentDefinition>,
): ParsedAcpModel | null {
  if (!model || model === 'auto') return null

  if (!model.startsWith(ACP_MODEL_PREFIX)) {
    return {
      agentId: DEFAULT_ACP_AGENT,
      modelId: model,
      raw: model,
      scoped: false,
    }
  }

  const parts = model.split(':')
  if (parts.length < 3) {
    return {
      agentId: DEFAULT_ACP_AGENT,
      modelId: model,
      raw: model,
      scoped: false,
    }
  }

  const agentId = parts[1] as AcpAgentId
  if (!(agentId in registry)) {
    return {
      agentId: DEFAULT_ACP_AGENT,
      modelId: model,
      raw: model,
      scoped: false,
    }
  }

  return {
    agentId,
    modelId: parts.slice(2).join(':') || undefined,
    raw: model,
    scoped: true,
  }
}

export function toScopedAcpModelId(agentId: AcpAgentId, modelId: string): string {
  return `${ACP_MODEL_PREFIX}${agentId}:${modelId}`
}

export function getAcpLaunchCommandFromRegistry(
  agentId: AcpAgentId,
  registry: Record<AcpAgentId, AcpAgentDefinition>,
): string[] {
  const agent = registry[agentId]
  const binaryPath = resolveBinaryOnly(agent.commandName)
  const base = binaryPath ? [binaryPath] : agent.npxFallback
  return [...base, ...agent.acpArgs]
}

export async function getAcpAgentAvailabilityFromRegistry(
  agentId: AcpAgentId,
  registry: Record<AcpAgentId, AcpAgentDefinition>,
): Promise<EngineAvailability & { agentId: AcpAgentId, label: string }> {
  const agent = registry[agentId]
  const cmd = getAcpLaunchCommandFromRegistry(agentId, registry)
  const result = await agent.verify(cmd)

  return {
    engineType: 'acp',
    agentId,
    label: agent.label,
    authStatus: agent.authStatus(),
    ...result,
  }
}

export async function queryScopedAcpModelsFromRegistry(
  agentId: AcpAgentId,
  workingDir: string,
  registry: Record<AcpAgentId, AcpAgentDefinition>,
): Promise<EngineModel[]> {
  const agent = registry[agentId]
  const models = await queryAcpModels({
    cmd: getAcpLaunchCommandFromRegistry(agentId, registry),
    workingDir,
    env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
  })

  return models.map(model => ({
    id: toScopedAcpModelId(agentId, model.id),
    name: `${agent.label}: ${model.name}`,
    description: model.description,
    isDefault: model.isDefault,
  }))
}
