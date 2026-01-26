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
export declare function sendSSE(controller: ReadableStreamDefaultController, encoder: TextEncoder, event: Record<string, unknown>): void;
/**
 * Generate a unique message ID for streaming.
 */
export declare function generateMessageId(): string;
//# sourceMappingURL=sse-utils.d.ts.map