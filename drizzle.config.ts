import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './apps/api/src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/bitk.db',
  },
})
