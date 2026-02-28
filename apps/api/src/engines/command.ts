import type { CommandParts, ResolvedCommand } from './types'

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
    if (value !== undefined) {
      this.args.push(`${key}=${value}`)
    } else {
      this.args.push(key)
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
    // Parse base command into program + initial args
    const parts = this.baseCommand.split(/\s+/)
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
    const resolvedPath = Bun.which(parts.program) ?? parts.program
    return { ...parts, resolvedPath }
  }
}
