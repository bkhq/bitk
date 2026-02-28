import { codeToHtml as _codeToHtml } from 'shiki'

const THEMES = {
  light: 'github-light-default' as const,
  dark: 'github-dark-default' as const,
}

/**
 * Render code to HTML with dual-theme support (light/dark via CSS variables).
 * Languages are loaded lazily from our slim bundle; unknown languages
 * fall back to plain text.
 */
export async function codeToHtml(code: string, lang: string): Promise<string> {
  try {
    return await _codeToHtml(code, { lang, themes: THEMES })
  } catch {
    return await _codeToHtml(code, { lang: 'text', themes: THEMES })
  }
}
