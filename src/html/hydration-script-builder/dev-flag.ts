import { buildNonceAttribute } from "../html-escape.ts";

/**
 * Announce a development render to client code.
 *
 * `__VERYFRONT_DEV__` is the framework's client-side development signal, read
 * by components that warn about misconfiguration (the optimized image size
 * check, the chat Markdown renderer check). The RSC page handler already sets
 * it, but the app-router shell did not, so those warnings stayed silent on the
 * page path most projects actually use.
 *
 * Emitted only from the dev script set, so a production document never carries
 * it. The value is a literal, so there is nothing to escape.
 *
 * @module html/hydration-script-builder/dev-flag
 */
export function generateDevFlagScript(nonce?: string): string {
  return `<script${buildNonceAttribute(nonce)}>window.__VERYFRONT_DEV__=true;</script>`;
}
