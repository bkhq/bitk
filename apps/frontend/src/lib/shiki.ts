import type { codeToHtml as ShikiCodeToHtml } from 'shiki'

const THEMES = {
  light: 'github-light-default' as const,
  dark: 'github-dark-default' as const,
}

type ShikiModule = {
  codeToHtml: typeof ShikiCodeToHtml
}

let shikiPromise: Promise<ShikiModule> | null = null

async function getShiki(): Promise<ShikiModule> {
  if (!shikiPromise) {
    shikiPromise = import('shiki').then((m) => ({ codeToHtml: m.codeToHtml }))
  }
  return shikiPromise
}

/**
 * Render code to HTML with dual-theme support (light/dark via CSS variables).
 * Languages are loaded lazily from our slim bundle; unknown languages
 * fall back to plain text.
 */
export async function codeToHtml(code: string, lang: string): Promise<string> {
  const { codeToHtml: shikiCodeToHtml } = await getShiki()
  try {
    return await shikiCodeToHtml(code, {
      lang,
      themes: THEMES,
      defaultColor: false,
    })
  } catch {
    return await shikiCodeToHtml(code, {
      lang: 'text',
      themes: THEMES,
      defaultColor: false,
    })
  }
}
