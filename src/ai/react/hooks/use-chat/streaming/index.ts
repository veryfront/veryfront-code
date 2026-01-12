/**
 * Streaming Module
 *
 * Exports for streaming response handling.
 *
 * @module ai/react/hooks/use-chat/streaming
 */

export { handleStreamingResponse } from "./handler.ts";
export { buildCurrentParts } from "./parts.ts";
export type {
  StreamingCallbacks,
  StreamingReasoning,
  StreamingTextBlock,
  StreamingToolCall,
} from "./types.ts";
