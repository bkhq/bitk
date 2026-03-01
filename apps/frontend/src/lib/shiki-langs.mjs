/**
 * Slim replacement for shiki/dist/langs.mjs
 *
 * Only bundles the most common languages used in diffs.
 * Everything else falls back to plain text in @pierre/diffs.
 */

const bundledLanguagesInfo = [
  // ── Web ─────────────────────────────────────────
  {
    id: 'html',
    name: 'HTML',
    aliases: ['htm'],
    import: () => import('@shikijs/langs/html'),
  },
  { id: 'css', name: 'CSS', import: () => import('@shikijs/langs/css') },
  {
    id: 'javascript',
    name: 'JavaScript',
    aliases: ['js'],
    import: () => import('@shikijs/langs/javascript'),
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    aliases: ['ts'],
    import: () => import('@shikijs/langs/typescript'),
  },
  { id: 'jsx', name: 'JSX', import: () => import('@shikijs/langs/jsx') },
  { id: 'tsx', name: 'TSX', import: () => import('@shikijs/langs/tsx') },

  // ── Data / Config ───────────────────────────────
  { id: 'json', name: 'JSON', import: () => import('@shikijs/langs/json') },
  {
    id: 'jsonc',
    name: 'JSON with Comments',
    import: () => import('@shikijs/langs/jsonc'),
  },
  {
    id: 'yaml',
    name: 'YAML',
    aliases: ['yml'],
    import: () => import('@shikijs/langs/yaml'),
  },
  { id: 'toml', name: 'TOML', import: () => import('@shikijs/langs/toml') },
  { id: 'xml', name: 'XML', import: () => import('@shikijs/langs/xml') },

  // ── Shell ───────────────────────────────────────
  {
    id: 'shellscript',
    name: 'Shell',
    aliases: ['bash', 'sh', 'zsh', 'shell'],
    import: () => import('@shikijs/langs/shellscript'),
  },

  // ── Common languages ────────────────────────────
  {
    id: 'python',
    name: 'Python',
    aliases: ['py'],
    import: () => import('@shikijs/langs/python'),
  },
  { id: 'go', name: 'Go', import: () => import('@shikijs/langs/go') },
  {
    id: 'rust',
    name: 'Rust',
    aliases: ['rs'],
    import: () => import('@shikijs/langs/rust'),
  },
  { id: 'sql', name: 'SQL', import: () => import('@shikijs/langs/sql') },

  // ── Markup ──────────────────────────────────────
  {
    id: 'markdown',
    name: 'Markdown',
    aliases: ['md'],
    import: () => import('@shikijs/langs/markdown'),
  },
  { id: 'diff', name: 'Diff', import: () => import('@shikijs/langs/diff') },

  // ── DevOps ──────────────────────────────────────
  {
    id: 'dockerfile',
    name: 'Dockerfile',
    aliases: ['docker'],
    import: () => import('@shikijs/langs/dockerfile'),
  },
]

const bundledLanguagesBase = Object.fromEntries(
  bundledLanguagesInfo.map((i) => [i.id, i.import]),
)

const bundledLanguagesAlias = Object.fromEntries(
  bundledLanguagesInfo.flatMap(
    (i) => i.aliases?.map((a) => [a, i.import]) || [],
  ),
)

const bundledLanguages = {
  ...bundledLanguagesBase,
  ...bundledLanguagesAlias,
}

export {
  bundledLanguages,
  bundledLanguagesAlias,
  bundledLanguagesBase,
  bundledLanguagesInfo,
  bundledLanguagesInfo as i,
  bundledLanguagesAlias as n,
  bundledLanguagesBase as r,
  bundledLanguages as t,
}
