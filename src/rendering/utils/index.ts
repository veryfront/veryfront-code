/**
 * Rendering Utilities Module
 *
 * Utility functions for rendering, including hash generation, React helpers, and stream utilities.
 *
 * @example
 * ```typescript
 * import { generateHash, normalizeChild, streamToString } from '@veryfront/rendering/utils'
 *
 * // Generate content hash
 * const hash = await generateHash(content)
 *
 * // Normalize React children
 * const normalized = normalizeChild(child)
 *
 * // Convert stream to string
 * const html = await streamToString(stream)
 * ```
 *
 * @module rendering/utils
 */

// Hash utilities (re-exported from core/utils for convenience)
export {
  computeCodeHash,
  computeContentHash,
  computeHash,
  getContentHash,
  type HashBundleCode as BundleCode,
  shortHash,
  simpleHash,
} from "@veryfront/utils";

// React helper functions
export * from "./react-helpers.ts";

// Stream utilities
export * from "./stream-utils.ts";
