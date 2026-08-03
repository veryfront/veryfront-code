/**
 * SSE (Server-Sent Events) Utilities
 *
 * Utilities for sending Server-Sent Events to stream controllers.
 *
 * @module ai/agent/runtime/sse-utils
 */

// Runtime heuristic: detects a write to an already-closed ReadableStream controller.
// The matched message is a Deno/browser engine implementation detail and may change
// across runtime versions. If the wording ever changes, writes to closed controllers
// will throw instead of being silently tolerated — this is the safe failure mode
// (the stream is already gone) but it will appear as an unhandled error.
function isClosedStreamControllerError(error: unknown): error is TypeError {
  return error instanceof TypeError &&
    error.message.includes("The stream controller cannot close or enqueue");
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
