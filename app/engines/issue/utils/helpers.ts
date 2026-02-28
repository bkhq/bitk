import type { EngineType, PermissionPolicy } from '../../types'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { projects as projectsTable } from '../../../db/schema'
import { BUILT_IN_PROFILES } from '../../types'

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
  permissionMode: string
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
  const dir = project?.directory ? resolve(project.directory) : process.cwd()
  await mkdir(dir, { recursive: true })
  const s = await stat(dir)
  if (!s.isDirectory()) {
    throw new Error(`Project directory is not a directory: ${dir}`)
  }
  return dir
}
