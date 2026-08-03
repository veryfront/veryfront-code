import { buildNonceAttribute } from "#veryfront/html/html-escape.ts";
import { buildTrustedHtmlValidatorScript } from "#veryfront/security/client/html-sanitizer.ts";
import type { ClientModuleStrategy } from "#veryfront/rendering/rsc/client-module-strategy.ts";
import {
  HYDRATION_DATA_ID,
  RSC_DEPENDENCY_PINNING_HEADER,
} from "#veryfront/rendering/rsc/constants.ts";

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
  constructor(
    private readonly isDevelopment: boolean = false,
    private readonly reactVersion?: string,
    private readonly clientModuleStrategy?: ClientModuleStrategy,
    private readonly dependencyPinningCacheKey?: string,
  ) {}

  handle(pathname: string, searchParams: URLSearchParams, nonce?: string): Response {
    const html = this.buildHtml(pathname, searchParams, nonce);
    const headers: Record<string, string> = {
      "content-type": "text/html; charset=utf-8",
    };
    if (this.dependencyPinningCacheKey?.startsWith("on:")) {
      headers["cache-control"] = "no-store";
    }

    return new Response(html, {
      headers,
    });
  }

  private buildHtml(pathname: string, searchParams: URLSearchParams, nonce?: string): string {
    const queryString = searchParams.toString();
    const renderUrl = `/_veryfront/rsc/render${pathname}${queryString ? `?${queryString}` : ""}`;
    const nonceAttr = buildNonceAttribute(nonce);
    const renderUrlJs = jsonForScript(renderUrl);
    const transportHeadersJs = jsonForScript(
      this.dependencyPinningCacheKey?.startsWith("on:")
        ? { [RSC_DEPENDENCY_PINNING_HEADER]: this.dependencyPinningCacheKey }
        : {},
    );
    const trustedHtmlValidatorScript = buildTrustedHtmlValidatorScript();
    const hydrationData = jsonForScript({
      clientModuleStrategy: this.clientModuleStrategy,
      dev: this.isDevelopment,
      reactVersion: this.reactVersion,
      ...(this.dependencyPinningCacheKey?.startsWith("on:")
        ? { dependencyPinningCacheKey: this.dependencyPinningCacheKey }
        : {}),
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Veryfront RSC</title>
  <script${nonceAttr}>window.__VERYFRONT_DEV__ = ${this.isDevelopment};</script>
</head>
<body>
  <script id="${HYDRATION_DATA_ID}" type="application/json"${nonceAttr}>${hydrationData}</script>
  <div id="rsc-root"></div>
  <script type="module"${nonceAttr}>
    const DEPENDENCY_SNAPSHOT_RECOVERY_RESULT = Object.freeze({
      dependencySnapshotRecoveryStarted: true,
    });

    async function isDependencySnapshotConflictResponse(response) {
      if (!response || response.status !== 409) return false;

      try {
        return (await response.clone().text()).trim() === 'Unknown dependency snapshot';
      } catch (_) {
        return false;
      }
    }

    async function recoverFromDependencySnapshotConflict(
      response,
      reloadDocument = () => window.location.reload(),
      recoveryState = window,
    ) {
      if (!(await isDependencySnapshotConflictResponse(response))) return false;

      const recoveryKey = '__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__';
      if (recoveryState[recoveryKey] === true) return true;

      recoveryState[recoveryKey] = true;
      try {
        reloadDocument();
      } catch (_) {
        delete recoveryState[recoveryKey];
        return false;
      }
      return true;
    }

    async function fetchPayload(url, headers) {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          return await recoverFromDependencySnapshotConflict(res)
            ? DEPENDENCY_SNAPSHOT_RECOVERY_RESULT
            : null;
        }
        return await res.json();
      } catch (_) {
        // expected: fetch may fail in browser context
        return null;
      }
    }

    function seedDependencySnapshot(payload) {
      const pinKey = payload?.dependencyPinningCacheKey;
      if (typeof pinKey !== 'string' || !pinKey.startsWith('on:')) return;

      const hydrationDataElement = document.getElementById('${HYDRATION_DATA_ID}');
      if (!hydrationDataElement) return;

      try {
        const hydrationState = JSON.parse(hydrationDataElement.textContent || '{}');
        hydrationState.dependencyPinningCacheKey = pinKey;
        hydrationDataElement.textContent = JSON.stringify(hydrationState);
      } catch (_) {
        // Ignore malformed hydration state; the client will fail closed on pins.
      }
    }

    ${trustedHtmlValidatorScript}

    (async () => {
      const renderUrl = ${renderUrlJs};
      const transportHeaders = ${transportHeadersJs};
      const payloadResult = await fetchPayload(renderUrl, transportHeaders);
      if (payloadResult === DEPENDENCY_SNAPSHOT_RECOVERY_RESULT) return;

      const payload =
        payloadResult ??
        { html: '<p>RSC unavailable</p>', clientRefs: [] };

      seedDependencySnapshot(payload);
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
