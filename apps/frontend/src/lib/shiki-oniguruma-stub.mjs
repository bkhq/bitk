/**
 * Stub for @shikijs/engine-oniguruma.
 *
 * Redirects to the lightweight JavaScript regex engine, avoiding the
 * 622 kB Oniguruma WASM binary.
 */
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'

const jsEngine = createJavaScriptRegexEngine()

export function createOnigurumaEngine() {
  return jsEngine
}

export function loadWasm() {}
