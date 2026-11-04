import { closePrivateStream, enqueuePrivateStream } from "#veryfront/security/private-stream.ts";
/**
 * SSE (Server-Sent Events) Utilities
 *
 * Utilities for sending Server-Sent Events to stream controllers.
 *
 * @module ai/agent/runtime/sse-utils
 */

import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { encodePrivateText } from "#veryfront/security/private-text.ts";
import { getActiveRunEventSinks } from "#veryfront/runtime/run-event-sink-context.ts";
import {
  observeToolResultMirrorStream,
  registerQueuedToolResult,
} from "#veryfront/runtime/tool-result-mirror-barrier.ts";
import {
  commitToolResultSequence,
  nextToolResultSequence,
  observeToolResultSequenceStream,
} from "#veryfront/runtime/tool-result-sequence.ts";
import {
  getRuntimeStreamControllerOwner,
  isPrimaryRuntimeStream,
} from "#veryfront/runtime/runtime-stream-ownership.ts";
import { structuredAgentOutputForWire } from "#veryfront/agent/output-schema.ts";

const getOwnDescriptor = Object.getOwnPropertyDescriptor;

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
    const owner = getRuntimeStreamControllerOwner(controller);
    const type = getOwnDescriptor(event, "type")?.value;
    const sink = getActiveRunEventSinks().mandatory;
    if (isPrimaryRuntimeStream()) {
      observeToolResultMirrorStream(sink, owner, type);
      observeToolResultSequenceStream(owner, type);
    }
    const id = getOwnDescriptor(event, "toolCallId")?.value;
    const preliminary = getOwnDescriptor(event, "preliminary")?.value;
    const terminalToolResult = typeof id === "string" &&
      ((type === "tool-output-available" && preliminary !== true) ||
        type === "tool-output-error" || type === "tool-output-denied" ||
        type === "tool-input-error");
    const sequence = terminalToolResult ? nextToolResultSequence(owner) : undefined;
    enqueuePrivateStream(
      controller,
      encodePrivateText(
        `data: ${
          privateJsonStringify(structuredAgentOutputForWire(
            sequence ? { ...event, privateToolResultSequence: sequence } : event,
          ))
        }\n\n`,
        encoder,
      ),
    );
    if (sequence) commitToolResultSequence(sequence);
    if (terminalToolResult && typeof id === "string") {
      registerQueuedToolResult(sink, owner, id);
    }
  } catch (error) {
    if (isClosedStreamControllerError(error)) {
      return;
    }

    throw error;
  }
}

export function closeSSEStream(controller: ReadableStreamDefaultController): void {
  try {
    closePrivateStream(controller);
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
