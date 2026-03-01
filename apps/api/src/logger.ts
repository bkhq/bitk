import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MiddlewareHandler } from 'hono'
import pino from 'pino'
import { ROOT_DIR } from './root'

const level = process.env.LOG_LEVEL ?? 'info'
const name = process.env.SERVICE_NAME ?? 'bitk'

const logDir = join(ROOT_DIR, 'data', 'logs')
mkdirSync(logDir, { recursive: true })

const logFile = join(logDir, `${name}.log`)

export const logger = pino(
  { level, base: undefined },
  pino.multistream([
    { level, stream: process.stdout },
    { level, stream: pino.destination(logFile) },
  ]),
)

export function httpLogger(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    if (c.req.path === '/api/health' || c.req.path === '/api/events') return
    logger.debug(`${c.req.method} ${c.req.path} ${c.res.status}`)
  }
}
