import { getAppSetting } from '@/db/helpers'

const MCP_ENABLED_SETTING = 'mcp:enabled'

/**
 * Check if MCP endpoint is enabled (env override or DB setting).
 */
export async function isMcpEnabled(): Promise<boolean> {
  const envVal = process.env.MCP_ENABLED
  if (envVal !== undefined) {
    return envVal === 'true' || envVal === '1'
  }
  const dbVal = await getAppSetting(MCP_ENABLED_SETTING)
  return dbVal === 'true'
}

/**
 * Get the local MCP server URL (localhost + env port).
 * Used by engine executors to inject MCP config into spawned processes.
 */
export function getMcpLocalUrl(): string {
  const port = process.env.PORT ?? '3000'
  return `http://localhost:${port}/api/mcp`
}

/**
 * Build the MCP server config for Claude Code's --mcp-config flag.
 * Returns the JSON string, or null if MCP is disabled.
 */
export async function getClaudeMcpConfig(): Promise<string | null> {
  if (!await isMcpEnabled()) return null
  return JSON.stringify({
    mcpServers: {
      bkd: {
        type: 'http',
        url: getMcpLocalUrl(),
      },
    },
  })
}

/**
 * Build the MCP server config for ACP protocol's mcpServers parameter.
 * Returns the server list, or empty array if MCP is disabled.
 */
export async function getAcpMcpServers(): Promise<Array<{ name: string, uri: string }>> {
  if (!await isMcpEnabled()) return []
  return [{ name: 'bkd', uri: getMcpLocalUrl() }]
}
