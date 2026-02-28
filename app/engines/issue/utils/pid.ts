import type { SpawnedProcess } from '../../types'
import type { ManagedProcess } from '../types'

export function getPidFromManaged(managed: ManagedProcess): number | undefined {
  return getPidFromSubprocess(managed.process.subprocess)
}

export function getPidFromSubprocess(subprocess: SpawnedProcess['subprocess']): number | undefined {
  const maybePid = (subprocess as { pid?: number }).pid
  return typeof maybePid === 'number' ? maybePid : undefined
}
