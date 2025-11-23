/**
 * Core constants module - centralized magic numbers and strings
 *
 * This module consolidates all magic values used throughout the codebase
 * into well-organized, self-documenting constants. This improves:
 * - Maintainability: Change values in one place
 * - Consistency: Same values used everywhere
 * - Clarity: Named constants explain their purpose
 *
 * @module core/constants
 */

// Re-export all existing constants from utils/constants
export * from "../utils/constants/index.ts";

// Handler priorities - defines execution order in middleware pipeline
export * from "./priorities.ts";

// Retry and error handling constants
export * from "./retry.ts";

// Buffer and memory size constants
export * from "./buffers.ts";

// String truncation and display limits
export * from "./limits.ts";

// Metrics boundaries and histogram buckets
export * from "./metrics.ts";

// Hash algorithm identifiers
export * from "./crypto.ts";
