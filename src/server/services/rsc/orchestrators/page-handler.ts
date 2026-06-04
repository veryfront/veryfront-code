import { buildNonceAttribute } from "#veryfront/html/html-escape.ts";
import { buildTrustedHtmlValidatorScript } from "#veryfront/security/client/html-sanitizer.ts";

/**
 * Serialize a value as a JSON string literal that is safe to embed inside an
 * inline HTML <script>. JSON already escapes quotes, backslashes, and control
 * characters; we additionally escape:
 *   - `<` / `>` so `</script>`, `<!--`, and `<script` cannot appear literally,
 *   - `&` as defense-in-depth against reparsing contexts (e.g. HTML entity
 *     re-decoding in some legacy paths),
 *   - U+2028 / U+2029 which are valid JSON but terminate JS string literals
 *     in older browsers.
 *
 * See VULN-INJ-1 in the security audit.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export class PageHandler {
  handle(pathname: string, searchParams: URLSearchParams, nonce?: string): Response {
    const html = this.buildHtml(pathname, searchParams, nonce);

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  private buildHtml(pathname: string, searchParams: URLSearchParams, nonce?: string): string {
    const queryString = searchParams.toString();
    const renderUrl = `/_veryfront/rsc/render${pathname}${queryString ? `?${queryString}` : ""}`;
    const nonceAttr = buildNonceAttribute(nonce);
    const renderUrlJs = jsonForScript(renderUrl);
    const trustedHtmlValidatorScript = buildTrustedHtmlValidatorScript();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Veryfront RSC</title>
  <script${nonceAttr}>window.__VERYFRONT_DEV__ = true;</script>
</head>
<body>
  <div id="rsc-root"></div>
  <script type="module"${nonceAttr}>
    async function fetchPayload(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch (_) {
        // expected: fetch may fail in browser context
        return null;
      }
    }

    ${trustedHtmlValidatorScript}

    (async () => {
      const renderUrl = ${renderUrlJs};
      const payload =
        (await fetchPayload(renderUrl)) ??
        (await fetchPayload('/_veryfront/rsc/payload')) ??
        { html: '<p>RSC unavailable</p>', clientRefs: [] };

      const safeHtml = validateTrustedHtml(String(payload.html || ''));
      document.getElementById('rsc-root').innerHTML = safeHtml;
      window.__RSC_CLIENT_REFS__ = payload.clientRefs;

      return import('/_veryfront/rsc/client.js?hydrate=1');
    })().catch(error => {
      console.error('[RSC] Failed to load:', error);
      document.getElementById('rsc-root').innerHTML = '<p>Failed to load RSC component</p>';
    });
  </script>
</body>
</html>`;
  }
}
