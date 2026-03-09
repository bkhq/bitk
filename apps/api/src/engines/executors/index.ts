import type {
  EngineAvailability,
  EngineExecutor,
  EngineModel,
  EngineRegistry,
  EngineType,
} from '@/engines/types'
import { ClaudeCodeExecutor } from './claude'
import { CodexExecutor } from './codex'
import { EchoExecutor } from './echo'
import { GeminiExecutor } from './gemini'

// Re-export executor classes
export { ClaudeCodeExecutor } from './claude'
export { CodexExecutor } from './codex'
export { EchoExecutor } from './echo'
export { GeminiExecutor } from './gemini'

/**
 * Default engine registry — manages all executor instances.
 */
class DefaultEngineRegistry implements EngineRegistry {
  private executors = new Map<EngineType, EngineExecutor>()

  register(executor: EngineExecutor): void {
    this.executors.set(executor.engineType, executor)
  }

  get(engineType: EngineType): EngineExecutor | undefined {
    return this.executors.get(engineType)
  }

  getAll(): EngineExecutor[] {
    return [...this.executors.values()]
  }

  async getAvailable(): Promise<EngineAvailability[]> {
    const results = await Promise.all(this.getAll().map((executor) => executor.getAvailability()))
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
  registry.register(new GeminiExecutor())
  registry.register(new EchoExecutor())

  return registry
}
