/**
 * SSE (Server-Sent Events) Utilities
 *
 * Utilities for sending Server-Sent Events to stream controllers.
 *
 * @module ai/agent/runtime/sse-utils
 */

/**
 * Encode and enqueue a Server-Sent Event (SSE) to the stream controller.
 * Formats event as: data: {json}\n\n
 */
export function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: Record<string, unknown>,
): void {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

/**
 * Generate a unique message ID for streaming.
 */
export function generateMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
