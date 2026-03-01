import type { ManagedProcess } from '@/engines/issue/types'
import type { SpawnedProcess } from '@/engines/types'

export function getPidFromManaged(managed: ManagedProcess): number | undefined {
  return getPidFromSubprocess(managed.process.subprocess)
}

export function getPidFromSubprocess(
  subprocess: SpawnedProcess['subprocess'],
): number | undefined {
  const maybePid = (subprocess as { pid?: number }).pid
  return typeof maybePid === 'number' ? maybePid : undefined
}
