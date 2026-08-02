import { getHeadCollectorNonce } from "../../head-collector.ts";

/**
 * Reuse the response-scoped CSP nonce for framework-owned inline elements.
 * During SSR it comes from the isolated render context; in the browser it is
 * recovered from a framework-generated element during hydration and SPA
 * updates.
 */
export function getDocumentNonce(): string | undefined {
  if (typeof document === "undefined") return getHeadCollectorNonce();

  const element = document.querySelector<HTMLElement>("script[nonce], style[nonce], link[nonce]");
  if (!element) return undefined;

  const nonce = element.nonce || element.getAttribute("nonce") || "";
  return nonce || undefined;
}
