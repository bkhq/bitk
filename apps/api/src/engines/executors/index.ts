import type {
  EngineAvailability,
  EngineExecutor,
  EngineModel,
  EngineRegistry,
  EngineType,
} from '@/engines/types'
import { AcpExecutor } from './acp'
import { ClaudeCodeExecutor } from './claude'
import { CodexExecutor } from './codex'

// Re-export executor classes
export { AcpExecutor } from './acp'
export { ClaudeCodeExecutor } from './claude'
export { CodexExecutor } from './codex'

/**
 * Default engine registry — manages all executor instances.
 */
class DefaultEngineRegistry implements EngineRegistry {
  private executors = new Map<EngineType, EngineExecutor>()

  register(executor: EngineExecutor): void {
    this.executors.set(executor.engineType, executor)
  }

  get(engineType: EngineType): EngineExecutor | undefined {
    // Direct match first
    const direct = this.executors.get(engineType)
    if (direct) return direct

    // Virtual ACP engine types (e.g. "acp:codex") resolve to the ACP executor
    if (engineType.startsWith('acp:')) {
      return this.executors.get('acp' as EngineType)
    }

    return undefined
  }

  getAll(): EngineExecutor[] {
    return [...this.executors.values()]
  }

  async getAvailable(): Promise<EngineAvailability[]> {
    const results = await Promise.all(this.getAll().map(executor => executor.getAvailability()))
    return results
  }

  async getModels(engineType: EngineType): Promise<EngineModel[]> {
    const executor = this.executors.get(engineType)
    if (!executor) return []
    return executor.getModels()
  }
}

// Create and populate the singleton registry
export const engineRegistry: EngineRegistry = createRegistry()

function createRegistry(): EngineRegistry {
  const registry = new DefaultEngineRegistry()

  // Register all supported executors
  registry.register(new ClaudeCodeExecutor())
  registry.register(new CodexExecutor())
  registry.register(new AcpExecutor())

  return registry
}
