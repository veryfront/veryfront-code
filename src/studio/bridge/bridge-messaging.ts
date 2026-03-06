/**
 * Bridge Messaging
 *
 * Communication layer between the preview iframe and Studio.
 * Captures the Studio origin from the first valid incoming message
 * and uses it as the targetOrigin for outgoing postMessage calls
 * to prevent information leakage to untrusted embedders.
 */

let studioOrigin: string | null = null;

export function postToStudio(message: Record<string, unknown>): void {
  if (!window.parent || window.parent === window) return;
  try {
    window.parent.postMessage(message, studioOrigin || "*");
  } catch (e) {
    console.debug("[StudioBridge] postMessage failed:", e);
  }
}

export function isFromStudio(event: MessageEvent): boolean {
  try {
    // Ignore messages from the current window (e.g. React DevTools, browser extensions).
    // Only accept messages from a different window (the parent Studio frame).
    if (!event.source || event.source === window) return false;

    const url = new URL(event.origin || "");
    const host = url.hostname;
    const valid = host === "localhost" ||
      host.endsWith(".veryfront.org") ||
      host === "veryfront.org" ||
      host.endsWith(".veryfront.com") ||
      host === "veryfront.com" ||
      host.endsWith(".veryfront.dev") ||
      host === "veryfront.dev";
    if (valid && !studioOrigin) {
      studioOrigin = event.origin;
    }
    return valid;
  } catch {
    return false;
  }
}
