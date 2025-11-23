/**
 * Build Command - Backward Compatibility Re-export
 *
 * This file maintains backward compatibility for existing imports.
 * The actual implementation has been refactored into the build/ directory.
 *
 * New modular structure:
 * - build/index.ts - Thin orchestrator (<50 lines)
 * - build/config-display.ts - Configuration display
 * - build/stats-display.ts - Statistics display
 * - build/error-handler.ts - Error handling
 * - build/types.ts - Type definitions
 */

export * from "./build/index.ts";
export type * from "./build/types.ts";
