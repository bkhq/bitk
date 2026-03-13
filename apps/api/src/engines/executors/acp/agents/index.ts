import type { EngineAvailability, EngineModel } from '@/engines/types'
import {
  getAcpAgentAvailabilityFromRegistry,
  getAcpLaunchCommandFromRegistry,
  parseAcpModelWithRegistry,
  queryScopedAcpModelsFromRegistry,
} from './base'
import type { AcpAgentDefinition, AcpAgentId, ParsedAcpModel } from './base'
import { claudeAgent } from './claude'
import { codexAgent } from './codex'
import { geminiAgent } from './gemini'

const ACP_AGENTS: Record<AcpAgentId, AcpAgentDefinition> = {
  gemini: geminiAgent,
  codex: codexAgent,
  claude: claudeAgent,
}

export type { AcpAgentDefinition, AcpAgentId, ParsedAcpModel } from './base'
export { DEFAULT_ACP_AGENT, toScopedAcpModelId } from './base'

export function getAcpAgents(): AcpAgentDefinition[] {
  return Object.values(ACP_AGENTS)
}

export function getAcpAgent(agentId: AcpAgentId): AcpAgentDefinition {
  return ACP_AGENTS[agentId]
}

export function parseAcpModel(model?: string | null): ParsedAcpModel | null {
  return parseAcpModelWithRegistry(model, ACP_AGENTS)
}

export function getAcpLaunchCommand(agentId: AcpAgentId): string[] {
  return getAcpLaunchCommandFromRegistry(agentId, ACP_AGENTS)
}

export async function getAcpAgentAvailability(
  agentId: AcpAgentId,
): Promise<EngineAvailability & { agentId: AcpAgentId, label: string }> {
  return getAcpAgentAvailabilityFromRegistry(agentId, ACP_AGENTS)
}

export async function queryScopedAcpModels(
  agentId: AcpAgentId,
  workingDir: string,
): Promise<EngineModel[]> {
  return queryScopedAcpModelsFromRegistry(agentId, workingDir, ACP_AGENTS)
}
