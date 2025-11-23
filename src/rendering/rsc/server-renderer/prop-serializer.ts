/**
 * Props serialization utilities for RSC renderer
 *
 * This module handles serialization of component props for
 * client-side hydration.
 *
 * @module prop-serializer
 */

import { serverLogger as logger } from "@veryfront/utils";

/**
 * Serialize props for client components
 *
 * Filters out non-serializable values and returns a JSON-safe
 * representation of the props object.
 *
 * @param props - Props to serialize
 * @returns Serializable props object
 */
export function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  // Simple JSON serialization
  // Filter out non-serializable values
  const serializable: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === "children") continue; // Children handled separately

    try {
      // Test if value is JSON serializable
      JSON.stringify(value);
      serializable[key] = value;
    } catch {
      // Skip non-serializable values
      logger.warn(`[RSC] Skipping non-serializable prop: ${key}`);
    }
  }

  return serializable;
}
