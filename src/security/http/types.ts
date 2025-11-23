/**
 * Security Handler Types
 * Shared types for security handlers
 */

// Re-export common handler types
export type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "@veryfront/types";

// Re-export security-specific types
export type { CORSConfig, SecurityConfig } from "./middleware/index.ts";
