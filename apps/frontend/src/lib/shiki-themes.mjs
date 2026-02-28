/**
 * Slim replacement for shiki/dist/themes.mjs
 *
 * Only bundles GitHub light/dark themes. The project exclusively uses
 * github-light-default and github-dark-default in DiffPanel and code blocks.
 */

const bundledThemesInfo = [
  {
    id: 'github-dark-default',
    import: () => import('@shikijs/themes/github-dark-default'),
  },
  {
    id: 'github-light-default',
    import: () => import('@shikijs/themes/github-light-default'),
  },
]

const bundledThemes = Object.fromEntries(
  bundledThemesInfo.map((i) => [i.id, i.import]),
)

export { bundledThemes, bundledThemesInfo }
