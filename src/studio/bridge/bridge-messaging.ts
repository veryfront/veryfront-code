/**
 * Bridge Messaging
 *
 * Communication layer between the preview iframe and Studio.
 */

export function postToStudio(message: Record<string, unknown>): void {
  if (!window.parent || window.parent === window) return;
  try {
    window.parent.postMessage(message, "*");
  } catch (e) {
    console.debug("[StudioBridge] postMessage failed:", e);
  }
}

export function isFromStudio(event: MessageEvent): boolean {
  try {
    const url = new URL(event.origin || "");
    const host = url.hostname;
    return (
      host === "localhost" ||
      host.endsWith(".veryfront.org") ||
      host === "veryfront.org" ||
      host.endsWith(".veryfront.com") ||
      host === "veryfront.com" ||
      host.endsWith(".veryfront.dev") ||
      host === "veryfront.dev"
    );
  } catch {
    return false;
  }
}
