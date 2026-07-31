import { HYDRATION_RUNTIME_BUNDLE } from "./hydration-runtime.generated.ts";
import { buildNonceAttribute, escapeInlineScriptContent } from "../html-escape.ts";

/**
 * Dev serves the same bundled hydration runtime as production, inline.
 *
 * Inlining keeps dev on one request and one cache story: the document already
 * carries per-request hydration data, so a separate versioned module URL would
 * only add a round trip. The bundle itself is identical to the production
 * artifact — both come from `runtime/` via the prebundle step.
 *
 * The bundle is escaped on the way in. Its bytes come from whatever the runtime
 * modules happen to contain, so a `</script` in any future string literal would
 * otherwise close this tag and spill the rest of the runtime into the document
 * as markup. `</script` can only appear inside a JS string, comment or regex,
 * where `<\/script` means the same thing.
 */
export function generateDevClientRendererScript(nonce?: string): string {
  const nonceAttr = buildNonceAttribute(nonce);

  return `
  <script type="module"${nonceAttr}>
${escapeInlineScriptContent(HYDRATION_RUNTIME_BUNDLE)}
  </script>`;
}
