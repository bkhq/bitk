import { existsSync } from 'node:fs'
import type { EngineAvailability } from '@/engines/types'
import type { AcpAgentDefinition } from './base'
import { verifyAcpCommand } from './base'

function getGeminiAuthStatus(): EngineAvailability['authStatus'] {
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    return 'authenticated'
  }

  const home = process.env.HOME ?? '/root'
  return existsSync(`${home}/.gemini/oauth_creds.json`) ? 'authenticated' : 'unauthenticated'
}

export const geminiAgent: AcpAgentDefinition = {
  id: 'gemini',
  label: 'Gemini',
  commandName: 'gemini',
  npxFallback: ['npx', '-y', '@google/gemini-cli@latest'],
  acpArgs: ['--acp'],
  authStatus: getGeminiAuthStatus,
  verify: async (cmd) => {
    const binaryPath = cmd[0] === 'npx' ? undefined : cmd[0]
    return verifyAcpCommand(cmd, ['--version'], binaryPath)
  },
}
