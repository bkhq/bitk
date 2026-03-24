/**
 * Pre-configured OpenAPIHono factory.
 *
 * All route files should use `createOpenAPIRouter()` instead of `new Hono()`
 * to get automatic OpenAPI spec generation + consistent validation error format.
 */
import { OpenAPIHono } from '@hono/zod-openapi'

/**
 * Create an OpenAPIHono router with a defaultHook that formats
 * validation errors to match the project's `{ success, error }` envelope.
 */
export function createOpenAPIRouter() {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        const messages = result.error.issues.map(i => i.message).join(', ')
        return c.json({ success: false, error: messages }, 400)
      }
    },
  })
}
