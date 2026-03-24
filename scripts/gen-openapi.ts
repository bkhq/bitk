/**
 * Generate static openapi.json from the app's OpenAPIHono routes.
 *
 * Usage: bun scripts/gen-openapi.ts [--output path]
 *
 * Default output: skills/bkd/references/openapi.json
 */
import { resolve } from 'node:path'
import app from '../apps/api/src/app'

const args = process.argv.slice(2)
const outputIdx = args.indexOf('--output')
const outputPath = outputIdx !== -1 && args[outputIdx + 1]
  ? resolve(args[outputIdx + 1])
  : resolve(import.meta.dir, '../skills/bkd/references/openapi.json')

const spec = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'BKD API', version: 'dev' },
  servers: [{ url: '/' }],
})
const json = JSON.stringify(spec, null, 2)

await Bun.write(outputPath, json)
console.log(`OpenAPI spec written to ${outputPath} (${(json.length / 1024).toFixed(1)} KB)`)
