import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { projects as projectsTable } from '@/db/schema'
import type { EngineType, PermissionPolicy } from '@/engines/types'
import { BUILT_IN_PROFILES } from '@/engines/types'
import { ROOT_DIR } from '@/root'

// ---------- Error classification ----------

export function isMissingExternalSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('no conversation found with session id')
    || (msg.includes('no conversation found') && msg.includes('session id'))
  )
}

// ---------- Permission options ----------

export function getPermissionOptions(
  engineType: EngineType,
  overridePolicy?: PermissionPolicy,
): {
  permissionMode: PermissionPolicy
} {
  const profile = BUILT_IN_PROFILES[engineType]
  const policy = overridePolicy ?? profile?.permissionPolicy ?? 'supervised'

  return { permissionMode: policy }
}

// ---------- Working directory ----------

export async function resolveWorkingDir(projectId: string): Promise<string> {
  const [project] = await db
    .select({ directory: projectsTable.directory })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
  const dir = project?.directory ? resolve(project.directory) : ROOT_DIR
  await mkdir(dir, { recursive: true })
  const s = await stat(dir)
  if (!s.isDirectory()) {
    throw new Error(`Project directory is not a directory: ${dir}`)
  }
  return dir
}

// ---------- Project execution context ----------

export interface ProjectExecContext {
  systemPrompt?: string
  envVars?: Record<string, string>
}

export async function getProjectExecContext(projectId: string): Promise<ProjectExecContext> {
  const [project] = await db
    .select({
      systemPrompt: projectsTable.systemPrompt,
      envVars: projectsTable.envVars,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
  if (!project) return {}
  let envVars: Record<string, string> | undefined
  if (project.envVars) {
    try {
      const parsed = JSON.parse(project.envVars) as Record<string, string>
      envVars = Object.keys(parsed).length > 0 ? parsed : undefined
    }
    catch {
      // ignore malformed JSON
    }
  }
  return {
    systemPrompt: project.systemPrompt ?? undefined,
    envVars,
  }
}

/** @deprecated Use getProjectExecContext instead */
export async function getProjectEnvVars(
  projectId: string,
): Promise<Record<string, string> | undefined> {
  const ctx = await getProjectExecContext(projectId)
  return ctx.envVars
}
