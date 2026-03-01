import type { EngineExecutor, NormalizedLogEntry } from '@/engines/types'
import { loadFilterRules } from '@/engines/write-filter'

export interface LogNormalizer {
  parse: (rawLine: string) => NormalizedLogEntry | NormalizedLogEntry[] | null
}

/**
 * Create a log normalizer for the given executor.
 * Extracts a pattern that was previously duplicated 4 times across orchestration and lifecycle.
 */
export async function createLogNormalizer(
  executor: EngineExecutor,
): Promise<LogNormalizer> {
  const filterRules = await loadFilterRules()
  if (executor.createNormalizer) {
    return executor.createNormalizer(filterRules)
  }
  return { parse: (line: string) => executor.normalizeLog(line) }
}
