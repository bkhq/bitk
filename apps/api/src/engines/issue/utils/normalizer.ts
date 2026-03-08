import type { EngineExecutor, NormalizedLogEntry } from '@/engines/types'

export interface LogNormalizer {
  parse: (rawLine: string) => NormalizedLogEntry | NormalizedLogEntry[] | null
}

/**
 * Create a log normalizer for the given executor.
 * Extracts a pattern that was previously duplicated 4 times across orchestration and lifecycle.
 *
 * Note: Write filter rules are no longer applied at the normalizer stage.
 * All entries flow through; filtering happens in the MessageRebuilder.
 */
export function createLogNormalizer(executor: EngineExecutor): LogNormalizer {
  if (executor.createNormalizer) {
    return executor.createNormalizer()
  }
  return { parse: (line: string) => executor.normalizeLog(line) }
}
