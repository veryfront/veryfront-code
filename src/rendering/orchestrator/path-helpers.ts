/**
 * Path Helpers for Render Pipeline
 *
 * Utility functions for handling path validation and hidden path detection.
 *
 * @module rendering/orchestrator/path-helpers
 */

import type { LayoutItem } from "#veryfront/types";
import { isAbsolute, relative } from "#veryfront/compat/path";

/** Check if a path segment is a hidden dot-directory (not . or ..) */
export function isHiddenSegment(segment: string): boolean {
  return segment.startsWith(".") && segment !== "." && segment !== "..";
}

/** Inputs used to determine whether a resolved route is hidden. */
export interface DotPathOptions {
  slug: string;
  filePath?: string;
  projectDir: string;
}

/**
 * Check whether a route contains a dot-prefixed segment.
 *
 * Absolute filesystem ancestors are outside the route namespace and must not
 * make a project hidden (for example, a project checked out under `.worktrees`).
 */
export function isDotPath({ slug, filePath, projectDir }: DotPathOptions): boolean {
  const hasDotSegment = (path: string) =>
    path.replaceAll("\\", "/").split("/").some(isHiddenSegment);
  const projectPath = filePath && isAbsolute(filePath) ? relative(projectDir, filePath) : filePath;

  return hasDotSegment(slug) || (projectPath ? hasDotSegment(projectPath) : false);
}

/** Empty layout result for dot-prefixed paths */
export const EMPTY_LAYOUT_RESULT: {
  layoutBundle: undefined;
  nestedLayouts: LayoutItem[];
} = { layoutBundle: undefined, nestedLayouts: [] };
