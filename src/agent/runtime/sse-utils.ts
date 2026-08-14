/**
 * SSE (Server-Sent Events) Utilities
 *
 * Utilities for sending Server-Sent Events to stream controllers.
 *
 * @module ai/agent/runtime/sse-utils
 */

// Runtime heuristic: detects a write to an already-closed ReadableStream controller.
// Browser/Node and Deno use different messages for the same Web Streams state error.
// Keep this narrow so unrelated TypeErrors still surface.
function isClosedStreamControllerError(error: unknown): error is TypeError {
  return error instanceof TypeError &&
    (error.message.includes("The stream controller cannot close or enqueue") ||
      error.message.includes("Controller is already closed"));
}

/**
 * Encode and enqueue a Server-Sent Event (SSE) to the stream controller.
 * Formats event as: data: {json}\n\n
 */
export function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: Record<string, unknown>,
): void {
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  } catch (error) {
    if (isClosedStreamControllerError(error)) {
      return;
    }

    throw error;
  }
}

export function closeSSEStream(controller: ReadableStreamDefaultController): void {
  try {
    controller.close();
  } catch (error) {
    if (isClosedStreamControllerError(error)) {
      return;
    }

    throw error;
  }
}

/**
 * Generate a unique message ID for streaming.
 */
export function generateMessageId(): string {
  return `msg-${crypto.randomUUID()}`;
}
