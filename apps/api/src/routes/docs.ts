import { Hono } from 'hono'
import { swaggerUI } from '@hono/swagger-ui'
import { buildOpenAPISpec } from '@/openapi/spec'

const docs = new Hono()

// GET /api/docs — Swagger UI
docs.get('/', swaggerUI({ url: '/api/openapi.json' }))

// GET /api/openapi.json — raw OpenAPI spec
docs.get('/openapi.json', (c) => {
  return c.json(buildOpenAPISpec())
})

export default docs
