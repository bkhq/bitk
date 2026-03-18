import { resolveCommand } from '@/engines/spawn'
import type { CommandParts, ResolvedCommand } from './types'

/**
 * Parse a command string into tokens, respecting single and double quotes.
 * e.g. `program --flag "arg with spaces" 'another arg'` → ['program', '--flag', 'arg with spaces', 'another arg']
 */
function parseCommandTokens(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of command) {
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === '\'') {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

export class CommandBuilder {
  private baseCommand: string
  private args: string[] = []
  private envVars: Record<string, string> = {}
  private workDir?: string

  private constructor(baseCommand: string) {
    this.baseCommand = baseCommand
  }

  static create(baseCommand: string): CommandBuilder {
    return new CommandBuilder(baseCommand)
  }

  params(args: string[]): this {
    this.args.push(...args)
    return this
  }

  param(key: string, value?: string): this {
    this.args.push(key)
    if (value !== undefined) {
      this.args.push(value)
    }
    return this
  }

  env(key: string, value: string): this {
    this.envVars[key] = value
    return this
  }

  envs(vars: Record<string, string>): this {
    Object.assign(this.envVars, vars)
    return this
  }

  cwd(dir: string): this {
    this.workDir = dir
    return this
  }

  build(): CommandParts {
    // Parse base command into program + initial args (handles quoted strings)
    const parts = parseCommandTokens(this.baseCommand)
    const program = parts[0]!
    const baseArgs = parts.slice(1)

    return {
      program,
      args: [...baseArgs, ...this.args],
      env: { ...this.envVars },
      cwd: this.workDir,
    }
  }

  async resolve(): Promise<ResolvedCommand> {
    const parts = this.build()
    const resolvedPath = resolveCommand(parts.program) ?? parts.program
    return { ...parts, resolvedPath }
  }
}
