/**
 * Embedded static file serving for compiled binary mode.
 *
 * When the app is compiled with `bun scripts/compile.ts`, all frontend
 * assets are embedded in the binary via `import ... with { type: "file" }`.
 * This module provides Hono middleware that serves them by matching
 * request paths to the embedded file map.
 */
import type { Context, MiddlewareHandler } from 'hono'

/** The asset map is generated at build time and imported by index.ts */
type StaticAssetMap = Map<string, string>

function serveEmbeddedFile(
  c: Context,
  bunfsPath: string,
  urlPath: string,
): Response {
  const file = Bun.file(bunfsPath)

  let cacheControl = 'public, max-age=3600, must-revalidate'
  if (urlPath.startsWith('/assets/')) {
    // Vite hashed assets — immutable
    cacheControl = 'public, max-age=31536000, immutable'
  }

  return new Response(file, {
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'Cache-Control': cacheControl,
    },
  })
}

/**
 * Creates a Hono middleware that serves files from the embedded asset map.
 * Falls through to `next()` for /api/* routes and unmatched paths.
 */
export function embeddedStatic(assets: StaticAssetMap): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path

    // Never intercept API routes
    if (path.startsWith('/api/')) {
      return next()
    }

    // Exact match
    const exact = assets.get(path)
    if (exact) {
      return serveEmbeddedFile(c, exact, path)
    }

    // SPA fallback → /index.html
    const indexPath = assets.get('/index.html')
    if (indexPath) {
      return new Response(Bun.file(indexPath), {
        headers: {
          'Content-Type': 'text/html;charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      })
    }

    return next()
  }
}
