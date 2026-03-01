// Injected at compile time via --define; defaults to 'dev' in dev mode
export const VERSION =
  typeof __BITK_VERSION__ !== 'undefined' ? __BITK_VERSION__ : 'dev'
export const COMMIT =
  typeof __BITK_COMMIT__ !== 'undefined' ? __BITK_COMMIT__ : 'dev'
