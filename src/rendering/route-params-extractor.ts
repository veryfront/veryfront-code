/**
 * Route Parameter Extraction
 *
 * Handles extraction of route parameters from dynamic routes for both:
 * - App Router ([id], [...slug], [[...optional]])
 * - Pages Router ([id].tsx, [...slug].tsx, etc.)
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { extractParams } from "@veryfront/routing";

/**
 * Extract route parameters from an App Router slug
 *
 * This function scans the app directory to find the matching route pattern,
 * then extracts parameters from the slug.
 *
 * @param projectDir - Project directory
 * @param slug - URL slug (e.g., "app-posts/42")
 * @param adapter - Runtime adapter
 * @returns Route parameters object, or null if not a dynamic route
 *
 * @example
 * ```ts
 * // For app/app-posts/[id]/page.tsx and slug "app-posts/42"
 * await extractAppRouteParams(projectDir, "app-posts/42", adapter)
 * // Returns: { id: "42" }
 *
 * // For app/docs/[...slug]/page.tsx and slug "docs/one/two/three"
 * await extractAppRouteParams(projectDir, "docs/one/two/three", adapter)
 * // Returns: { slug: ["one", "two", "three"] }
 * ```
 */
export async function extractAppRouteParams(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<Record<string, string | string[]> | null> {
  const { join: pathJoin } = await import("https://deno.land/std@0.220.0/path/mod.ts");
  const { extractParams } = await import("@veryfront/routing/slug-mapper/dynamic-route-matcher.ts");

  // Split slug into segments
  const segments = slug ? slug.split("/").filter(Boolean) : [];

  // Start from the app directory
  let currentDir = pathJoin(projectDir, "app");
  const patternParts: string[] = [];

  // Match each segment, building the pattern as we go
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const exactPath = pathJoin(currentDir, segment);

    // Try exact match for this segment
    try {
      const stat = await adapter.fs.stat(exactPath);
      if (stat.isDirectory) {
        currentDir = exactPath;
        patternParts.push(segment);
        continue;
      }
    } catch {
      // Exact match failed, try dynamic segments
    }

    // Try to find a dynamic segment directory
    let foundDynamic = false;
    let isCatchAll = false;
    try {
      const entries = await adapter.fs.readDir(currentDir);
      for await (const entry of entries) {
        if (entry.isDirectory && isDynamicSegment(entry.name)) {
          currentDir = pathJoin(currentDir, entry.name);
          patternParts.push(entry.name);
          foundDynamic = true;
          // Check if this is a catch-all segment
          if (entry.name.startsWith("[...")) {
            isCatchAll = true;
          }
          break;
        }
      }
    } catch {
      // Fallback to Deno.readDir
      try {
        for await (const entry of Deno.readDir(currentDir)) {
          if (entry.isDirectory && isDynamicSegment(entry.name)) {
            currentDir = pathJoin(currentDir, entry.name);
            patternParts.push(entry.name);
            foundDynamic = true;
            // Check if this is a catch-all segment
            if (entry.name.startsWith("[...")) {
              isCatchAll = true;
            }
            break;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!foundDynamic) {
      return null; // No match found
    }

    // If we found a catch-all segment, stop matching
    if (isCatchAll) {
      break;
    }
  }

  // Build the pattern and extract params
  const pattern = patternParts.join("/");
  return extractParams(pattern, slug);
}

/**
 * Extract route params for Pages Router dynamic routes
 * Similar to App Router but looks in /pages directory
 */
export async function extractPagesRouteParams(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<Record<string, string | string[]> | null> {
  const { join: pathJoin } = await import("https://deno.land/std@0.220.0/path/mod.ts");

  // Split slug into segments
  const segments = slug ? slug.split("/").filter(Boolean) : [];
  const pagesDir = pathJoin(projectDir, "pages");

  // Try to find matching page file pattern
  const routeExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];

  // Build possible route patterns (e.g., for "blog/my-post" try "blog/[slug].tsx", "blog/[...slug].tsx", etc.)
  const patternParts: string[] = [];
  let currentDir = pagesDir;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    const exactPath = pathJoin(currentDir, segment);

    // Try exact match first
    try {
      const stat = await adapter.fs.stat(exactPath);
      if (stat.isDirectory) {
        currentDir = exactPath;
        patternParts.push(segment);
        continue;
      }
    } catch {
      // Not an exact directory match
    }

    // Try to find a dynamic segment file or directory
    let foundDynamic = false;
    try {
      const entries = await adapter.fs.readDir(currentDir);
      for await (const entry of entries) {
        const entryName = entry.name;

        // Check if this is a dynamic segment
        if (isDynamicSegment(entryName)) {
          // Extract the param name
          const _paramName = entryName.replace(/\[\.\.\.|\[|\]/g, "");

          // Check if it's a file (last segment) or directory (more segments)
          const isCatchAll = entryName.startsWith("[...");
          const isFile = routeExtensions.some((ext) => entryName.endsWith(ext));

          if (isFile && i === segments.length - 1) {
            // This is the page file
            patternParts.push(entryName.replace(/\.(tsx|jsx|ts|js|mdx)$/, ""));
            foundDynamic = true;
            break;
          } else if (entry.isDirectory) {
            currentDir = pathJoin(currentDir, entryName);
            patternParts.push(entryName);
            foundDynamic = true;

            if (isCatchAll) {
              // Catch-all captures remaining segments
              break;
            }
            break;
          }
        }
      }
    } catch {
      // Fallback to Deno.readDir
      try {
        for await (const entry of Deno.readDir(currentDir)) {
          const entryName = entry.name;

          if (isDynamicSegment(entryName)) {
            const isCatchAll = entryName.startsWith("[...");
            const isFile = routeExtensions.some((ext) => entryName.endsWith(ext));

            if (isFile && i === segments.length - 1) {
              patternParts.push(entryName.replace(/\.(tsx|jsx|ts|js|mdx)$/, ""));
              foundDynamic = true;
              break;
            } else if (entry.isDirectory) {
              currentDir = pathJoin(currentDir, entryName);
              patternParts.push(entryName);
              foundDynamic = true;

              if (isCatchAll) {
                break;
              }
              break;
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!foundDynamic) {
      return null; // No matching dynamic route
    }
  }

  // Build the pattern and extract params
  const pattern = patternParts.join("/");
  return extractParams(pattern, slug);
}

/**
 * Check if a directory or file name represents a dynamic segment
 */
function isDynamicSegment(name: string): boolean {
  // Matches [slug], [id], [...all], [[...optional]], etc.
  return name.startsWith("[") && name.endsWith("]");
}
