import { HYDRATION_RUNTIME_BUNDLE } from "./hydration-runtime.generated.ts";
import { buildNonceAttribute } from "../html-escape.ts";

/**
 * Dev serves the same bundled hydration runtime as production, inline.
 *
 * Inlining keeps dev on one request and one cache story: the document already
 * carries per-request hydration data, so a separate versioned module URL would
 * only add a round trip. The bundle itself is identical to the production
 * artifact — both come from `runtime/` via the prebundle step.
 */
export function generateDevClientRendererScript(nonce?: string): string {
  const nonceAttr = buildNonceAttribute(nonce);

  return `
  <script type="module"${nonceAttr}>
${HYDRATION_RUNTIME_BUNDLE}
  </script>`;
}
