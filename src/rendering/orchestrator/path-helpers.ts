/**
 * Path Helpers for Render Pipeline
 *
 * Utility functions for handling path validation and hidden path detection.
 *
 * @module rendering/orchestrator/path-helpers
 */

import type { LayoutItem } from "#veryfront/types";

/** Check if a path segment is a hidden dot-directory (not . or ..) */
export function isHiddenSegment(segment: string): boolean {
  return segment.startsWith(".") && segment !== "." && segment !== "..";
}

/** Check if a path contains dot-prefixed segments (e.g., .veryfront, .hidden) */
export function isDotPath(slug: string, filePath?: string): boolean {
  const hasDotSegment = (path: string) => path.split("/").some(isHiddenSegment);
  return hasDotSegment(slug) || (filePath ? hasDotSegment(filePath) : false);
}

/** Empty layout result for dot-prefixed paths */
export const EMPTY_LAYOUT_RESULT: {
  layoutBundle: undefined;
  nestedLayouts: LayoutItem[];
} = { layoutBundle: undefined, nestedLayouts: [] };
