import { buildNonceAttribute } from "./html-escape.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { assertBoundedHTMLText, MAX_HTML_SOURCE_HASH_BYTES } from "./limits.ts";
import { decodePathSegmentFully, isSafeModulePathSegment } from "./path-safety.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import { Z_INDEX_DEV_INDICATOR, Z_INDEX_ERROR_OVERLAY } from "#veryfront/utils/constants/html.ts";
import { snapshotPlainDataRecord } from "./json-snapshot.ts";
import { hasUnpairedUtf16Surrogate, hasUnsafeUnicodeFormatting } from "./unicode-safety.ts";
import {
  MAX_STUDIO_CONFIG_ID_LENGTH,
  MAX_STUDIO_CONFIG_NONCE_LENGTH,
  MAX_STUDIO_CONFIG_PATH_LENGTH,
} from "#veryfront/studio/limits.ts";

export function getPreviewStylesheetLink(): string {
  return `<link id="vf-tailwind-css" rel="stylesheet" href="/_vf_styles/styles.css?t=${Date.now()}">`;
}

export function getDevStyles(nonce?: string): string {
  const nonceAttr = buildNonceAttribute(nonce);

  return `
  <style${nonceAttr}>
    .dev-indicator {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      background: #3b82f6;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      z-index: ${Z_INDEX_DEV_INDICATOR};
    }

    #veryfront-error-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: ${Z_INDEX_ERROR_OVERLAY};
      background: rgba(0,0,0,0.85);
      color: white;
      font-family: monospace;
      overflow: auto;
      padding: 2rem;
    }
  </style>`;
}

export function getDevScripts(_hmrPort?: number, nonce?: string): string {
  const nonceAttr = buildNonceAttribute(nonce);

  return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>
  <script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
}

export function getProdScripts(_slug: string, nonce?: string): string {
  const nonceAttr = buildNonceAttribute(nonce);

  return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>`;
}

interface StudioScriptOptions {
  projectId: string;
  pageId?: string;
  /** Project-relative page path. */
  pagePath?: string;
  nonce?: string;
  /** Hash of source code for sync detection with Navigator tree */
  sourceHash?: string;
  /** @deprecated The current Studio bridge does not provide direct Yjs collaboration. */
  wsUrl?: string;
  /** @deprecated The current Studio bridge does not provide direct Yjs collaboration. */
  yjsGuid?: string;
}

function assertStudioConfigString(
  value: unknown,
  label: string,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" || value.length > maxLength || value.includes("\0")
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `${label} is invalid or too long` });
  }
}

export function getStudioScripts(options: StudioScriptOptions): string {
  options = snapshotPlainDataRecord(
    options,
    "Studio script options",
  ) as unknown as StudioScriptOptions;
  assertStudioConfigString(
    options.projectId,
    "Studio project ID",
    MAX_STUDIO_CONFIG_ID_LENGTH,
  );
  let pagePath: string | undefined;
  if (options.pagePath !== undefined) {
    assertStudioConfigString(
      options.pagePath,
      "Studio page path",
      MAX_STUDIO_CONFIG_PATH_LENGTH,
    );
    if (
      options.pagePath &&
      (options.pagePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(options.pagePath))
    ) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Studio page path is unsafe" });
    }
    const parts = options.pagePath.split("/");
    if (
      options.pagePath && parts.some((part) => {
        if (!isSafeModulePathSegment(part)) return true;
        try {
          const decoded = decodePathSegmentFully(part);
          return hasUnpairedUtf16Surrogate(decoded) || hasUnsafeUnicodeFormatting(decoded);
        } catch {
          return true;
        }
      })
    ) throw INPUT_VALIDATION_FAILED.create({ detail: "Studio page path is unsafe" });
    pagePath = options.pagePath;
  }
  if (options.pageId !== undefined) {
    assertStudioConfigString(options.pageId, "Studio page ID", MAX_STUDIO_CONFIG_ID_LENGTH);
  }
  if (options.nonce !== undefined) {
    assertStudioConfigString(
      options.nonce,
      "Studio CSP nonce",
      MAX_STUDIO_CONFIG_NONCE_LENGTH,
    );
  }
  const pageId = options.pageId ??
    (pagePath !== undefined && pagePath.length <= MAX_STUDIO_CONFIG_ID_LENGTH ? pagePath : "");
  if (options.sourceHash !== undefined) {
    assertBoundedHTMLText(options.sourceHash, "Studio source hash", MAX_HTML_SOURCE_HASH_BYTES);
  }
  if (options.wsUrl !== undefined || options.yjsGuid !== undefined) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Studio bridge collaboration options are not supported",
    });
  }
  const nonceAttr = buildNonceAttribute(options.nonce);

  const bridgeConfig: Record<string, unknown> = {
    projectId: options.projectId,
    pageId,
    pagePath: pagePath ?? pageId,
  };
  if (options.nonce) bridgeConfig.nonce = options.nonce;

  const sourceHashScript = options.sourceHash
    ? `<script${nonceAttr}>window.__VERYFRONT_SOURCE_HASH__=${
      jsonForInlineScript(options.sourceHash)
    };</script>\n  `
    : "";

  const safeJson = jsonForInlineScript(bridgeConfig);
  const configScript = `<script${nonceAttr}>window.__VF_BRIDGE_CONFIG__=${safeJson};</script>`;

  return `
  ${sourceHashScript}${configScript}
  <script type="module" src="/_veryfront/studio-bridge.js"${nonceAttr}></script>`;
}
