import { existsSync } from 'node:fs'
import type { EngineAvailability } from '@/engines/types'
import type { AcpAgentDefinition } from './base'
import { verifyAcpCommand } from './base'

function getCodexAuthStatus(): EngineAvailability['authStatus'] {
  if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
    return 'authenticated'
  }

  const home = process.env.HOME ?? '/root'
  return existsSync(`${home}/.codex/auth.json`) ? 'authenticated' : 'unknown'
}

export const codexAgent: AcpAgentDefinition = {
  id: 'codex',
  label: 'Codex',
  commandName: 'codex-acp',
  npxFallback: ['npx', '-y', '@zed-industries/codex-acp@latest'],
  acpArgs: [],
  authStatus: getCodexAuthStatus,
  verify: async (cmd) => {
    const binaryPath = cmd[0] === 'npx' ? undefined : cmd[0]
    return verifyAcpCommand(cmd, ['--help'], binaryPath)
  },
}
