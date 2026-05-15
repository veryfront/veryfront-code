/**
 * Bridge Messaging
 *
 * Communication layer between the preview iframe and Studio.
 * Captures the Studio origin from the first valid incoming message
 * and uses it as the targetOrigin for outgoing postMessage calls
 * to prevent information leakage to untrusted embedders.
 *
 * Outgoing messages sent before the handshake establishes studioOrigin
 * are buffered and flushed once the origin is captured. This avoids the
 * previous behavior of broadcasting pre-handshake messages with targetOrigin
 * "*", which could leak project state to any parent frame that embedded
 * the preview iframe.
 */

import { logger } from "./bridge-logger.ts";

const MAX_PENDING_MESSAGES = 100;

let studioOrigin: string | null = null;
const pendingMessages: Record<string, unknown>[] = [];

function send(message: Record<string, unknown>, origin: string): void {
  try {
    window.parent.postMessage(message, origin);
  } catch (e) {
    logger.debug("postMessage failed", e instanceof Error ? e : { error: String(e) });
  }
}

function flushPending(): void {
  if (!studioOrigin) return;
  const origin = studioOrigin;
  while (pendingMessages.length > 0) {
    const msg = pendingMessages.shift()!;
    send(msg, origin);
  }
}

export function postToStudio(message: Record<string, unknown>): void {
  if (!window.parent || window.parent === window) return;
  if (!studioOrigin) {
    if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
      // Drop oldest to keep memory bounded if handshake never completes.
      pendingMessages.shift();
    }
    pendingMessages.push(message);
    return;
  }
  send(message, studioOrigin);
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
      flushPending();
    }
    return valid;
  } catch (_) {
    /* expected: invalid URL in event.origin */
    return false;
  }
}

/** Test-only: reset module state. Not exported from the public surface. */
export function _resetForTest(): void {
  studioOrigin = null;
  pendingMessages.length = 0;
}

/** Test-only: read pending buffer length. */
export function _pendingCountForTest(): number {
  return pendingMessages.length;
}
