/**
 * Studio Communication Types
 *
 * Message types for postMessage communication between Studio and Renderer iframe.
 * These must be compatible with veryfront-frontend's message types.
 */

// Re-export schema-based types
export type {
  ErrorMessage,
  LogMessage,
  LogMethod,
  MessageFromRenderer,
  MessageFromStudio,
  NavigatorNode,
  NavigatorNodeType,
} from "./schemas/index.ts";

export const DATA_VF_ID = "data-vf-id";
export const DATA_VF_SELECTOR = "data-vf-selector";
export const DATA_VF_TEXT = "data-vf-text";
export const DATA_VF_IGNORE = "data-vf-ignore";
