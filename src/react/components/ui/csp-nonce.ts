import { getHeadCollectorNonce } from "#veryfront/react/head-collector.ts";
import { useServerRenderContext } from "#veryfront/react/server-render-context.ts";

/**
 * Reuse the response-scoped CSP nonce for framework-owned inline elements.
 * During SSR it comes from the isolated render context; in the browser it is
 * recovered from a framework-generated element during hydration and SPA
 * updates.
 */
export function getDocumentNonce(): string | undefined {
  const serverNonce = getHeadCollectorNonce();
  if (serverNonce) return serverNonce;
  if (typeof document === "undefined") return undefined;

  const element = document.querySelector<HTMLElement>("script[nonce], style[nonce], link[nonce]");
  if (!element) return undefined;

  const nonce = element.nonce || element.getAttribute("nonce") || "";
  return nonce || undefined;
}

/** Read the nonce from the Suspense-safe server provider or the browser DOM. */
export function useDocumentNonce(): string | undefined {
  return useServerRenderContext()?.nonce ?? getDocumentNonce();
}
