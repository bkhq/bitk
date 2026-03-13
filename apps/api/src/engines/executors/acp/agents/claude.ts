import { existsSync } from 'node:fs'
import type { EngineAvailability } from '@/engines/types'
import type { AcpAgentDefinition } from './base'
import { verifyAcpCommand } from './base'

function getClaudeAuthStatus(): EngineAvailability['authStatus'] {
  if (process.env.ANTHROPIC_API_KEY) {
    return 'authenticated'
  }

  const home = process.env.HOME ?? '/root'
  if (existsSync(`${home}/.claude/.credentials.json`)) {
    return 'authenticated'
  }

  return 'unknown'
}

export const claudeAgent: AcpAgentDefinition = {
  id: 'claude',
  label: 'Claude',
  commandName: 'claude-code-acp',
  npxFallback: ['npx', '-y', '@zed-industries/claude-code-acp@latest'],
  acpArgs: [],
  authStatus: getClaudeAuthStatus,
  verify: async (cmd) => {
    const binaryPath = cmd[0] === 'npx' ? undefined : cmd[0]
    return verifyAcpCommand(cmd, ['--help'], binaryPath)
  },
}
