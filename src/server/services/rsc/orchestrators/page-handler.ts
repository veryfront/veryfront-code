import { buildNonceAttribute } from "#veryfront/html/html-escape.ts";
import { buildTrustedHtmlValidatorScript } from "#veryfront/security/client/html-sanitizer.ts";
import type { ClientModuleStrategy } from "#veryfront/types/rsc.ts";
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
  <script id="${HYDRATION_DATA_ID}" type="application/json"${nonceAttr}>${hydrationData}</script>
  <script${nonceAttr}>window.__VERYFRONT_DEV__ = ${this.isDevelopment};</script>
</head>
<body>
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

    function recoverFromDependencySnapshotAdmissionFailure(
      reloadDocument = () => window.location.reload(),
      recoveryState = window,
    ) {
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

    async function recoverFromDependencySnapshotConflict(
      response,
      reloadDocument = () => window.location.reload(),
      recoveryState = window,
    ) {
      if (!(await isDependencySnapshotConflictResponse(response))) return false;
      return recoverFromDependencySnapshotAdmissionFailure(
        reloadDocument,
        recoveryState,
      );
    }

    function isCanonicalDependencyPinningCacheKey(value) {
      if (typeof value !== 'string') return false;
      if (value === 'on:unknown' || value === 'on:no-project') return false;
      const match = /^on:(0|[1-9a-z][0-9a-z]{0,12})$/.exec(value);
      if (!match) return false;
      const hash = match[1];
      const maxHash = '3w5e11264sgsf';
      return hash.length < maxHash.length || hash <= maxHash;
    }

    function normalizeExpectedDependencySnapshot(value) {
      if (value === undefined || value === null || value === 'off') return 'off';
      return isCanonicalDependencyPinningCacheKey(value) ? value : null;
    }

    function normalizeResponseDependencySnapshot(value) {
      if (value === undefined || value === null) {
        return { present: false, dependencyPinningCacheKey: 'off' };
      }
      if (value === 'off') {
        return { present: true, dependencyPinningCacheKey: 'off' };
      }
      return isCanonicalDependencyPinningCacheKey(value)
        ? { present: true, dependencyPinningCacheKey: value }
        : null;
    }

    function admitDependencySnapshot(
      payload,
      response,
      requestedPinKey,
      currentPinKey,
      reloadDocument = () => window.location.reload(),
      recoveryState = window,
    ) {
      const requested = normalizeExpectedDependencySnapshot(requestedPinKey);
      const current = normalizeExpectedDependencySnapshot(currentPinKey);
      let bodyDescriptor;
      if (payload) {
        if (typeof payload === 'object') {
          if (!Array.isArray(payload)) {
            bodyDescriptor = Object.getOwnPropertyDescriptor(
              payload,
              'dependencyPinningCacheKey',
            );
          }
        }
      }
      const bodyPinKey = !bodyDescriptor
        ? undefined
        : Object.prototype.hasOwnProperty.call(bodyDescriptor, 'value')
        ? bodyDescriptor.value
        : bodyDescriptor;
      const header = normalizeResponseDependencySnapshot(
        response?.headers?.get('${RSC_DEPENDENCY_PINNING_HEADER}'),
      );
      const body = normalizeResponseDependencySnapshot(bodyPinKey);
      let rejected =
        requested === null ||
        current === null ||
        current !== requested ||
        header === null ||
        body === null;
      if (!rejected) {
        if (requested !== 'off') {
          if (!header.present || !body.present) rejected = true;
        }
      }
      if (!rejected) {
        if (header.present) {
          rejected = header.dependencyPinningCacheKey !== requested;
        }
      }
      if (!rejected) {
        if (body.present) {
          rejected = body.dependencyPinningCacheKey !== requested;
        }
      }
      if (!rejected) return true;

      recoverFromDependencySnapshotAdmissionFailure(
        reloadDocument,
        recoveryState,
      );
      return false;
    }

    async function fetchPayload(url, headers) {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          return await recoverFromDependencySnapshotConflict(res)
            ? DEPENDENCY_SNAPSHOT_RECOVERY_RESULT
            : null;
        }
        return Object.freeze({
          payload: await res.json(),
          response: res,
        });
      } catch (_) {
        // expected: fetch may fail in browser context
        return null;
      }
    }

    ${trustedHtmlValidatorScript}

    (async () => {
      const renderUrl = ${renderUrlJs};
      const transportHeaders = ${transportHeadersJs};
      const payloadResult = await fetchPayload(renderUrl, transportHeaders);
      if (payloadResult === DEPENDENCY_SNAPSHOT_RECOVERY_RESULT) return;

      const requestedPinKey =
        transportHeaders['${RSC_DEPENDENCY_PINNING_HEADER}'];
      if (!payloadResult) {
        if (requestedPinKey !== undefined) {
          recoverFromDependencySnapshotAdmissionFailure();
          return;
        }
      }
      const payload = payloadResult?.payload ??
        { html: '<p>RSC unavailable</p>', clientRefs: [] };

      if (payloadResult) {
        let currentPinKey;
        try {
          const hydrationDataElement =
            document.getElementById('${HYDRATION_DATA_ID}');
          if (!hydrationDataElement) throw new Error('missing hydration data');
          const hydrationState = JSON.parse(
            hydrationDataElement.textContent || '{}',
          );
          currentPinKey = hydrationState?.dependencyPinningCacheKey;
        } catch (_) {
          recoverFromDependencySnapshotAdmissionFailure();
          return;
        }

        if (!admitDependencySnapshot(
          payload,
          payloadResult.response,
          requestedPinKey,
          currentPinKey,
        )) return;
      }
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
