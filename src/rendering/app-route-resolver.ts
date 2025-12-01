/**
 * App Router Entity Resolution
 *
 * Handles resolution of App Router page entities, including:
 * - Exact route matching
 * - Dynamic segment matching ([id], [...slug], etc.)
 * - Page file loading with frontmatter extraction
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { EntityInfo, Frontmatter } from "@veryfront/types";

/**
 * Resolve an App Router page entity (maps a slug like "blog/post" to app routes)
 */
export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
): Promise<EntityInfo | null> {
  // Try exact match first
  const exactMatch = await tryExactMatch(projectDir, slug, adapter, appDirName);
  if (exactMatch) return exactMatch;

  // Try dynamic segment matching
  return await tryDynamicMatch(projectDir, slug, adapter, appDirName);
}

/**
 * Try to find an exact match for the slug
 */
async function tryExactMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
): Promise<EntityInfo | null> {
  const { join: pathJoin } = await import("https://deno.land/std@0.220.0/path/mod.ts");
  const base = slug ? pathJoin(projectDir, appDirName, slug) : pathJoin(projectDir, appDirName);
  const candidates = [
    `${base}/page.mdx`,
    `${base}/page.tsx`,
    `${base}/page.jsx`,
    `${base}/page.ts`,
    `${base}/page.js`,
    // index-like shorthand
    `${base}.mdx`,
    `${base}.tsx`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.js`,
  ];

  for (const file of candidates) {
    const entity = await tryLoadPageFile(file, slug, adapter);
    if (entity) return entity;
  }

  return null;
}

/**
 * Try to find a dynamic segment match (e.g., [slug], [id], etc.)
 */
async function tryDynamicMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
): Promise<EntityInfo | null> {
  const { join: pathJoin } = await import("https://deno.land/std@0.220.0/path/mod.ts");

  // Split slug into segments (e.g., "blog/test-post" -> ["blog", "test-post"])
  const segments = slug ? slug.split("/").filter(Boolean) : [];

  // Start from the app directory
  let currentDir = pathJoin(projectDir, appDirName);

  // Match each segment, checking for dynamic routes
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const exactPath = pathJoin(currentDir, segment);

    // Try exact match for this segment
    try {
      const stat = await adapter.fs.stat(exactPath);
      if (stat.isDirectory) {
        currentDir = exactPath;
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
          foundDynamic = true;
          // Check if this is a catch-all segment
          if (entry.name.startsWith("[...")) {
            isCatchAll = true;
          }
          break;
        }
      }
    } catch {
      // adapter.fs.readDir failed - no fallback to Deno for npm compatibility
    }

    if (!foundDynamic) {
      return null; // No match found
    }

    // If we found a catch-all segment, stop matching and look for the page file
    if (isCatchAll) {
      break;
    }
  }

  // Now try to find a page file in the final directory
  const pageExtensions = [".mdx", ".tsx", ".jsx", ".ts", ".js"];
  for (const ext of pageExtensions) {
    const pageFile = pathJoin(currentDir, `page${ext}`);
    const entity = await tryLoadPageFile(pageFile, slug, adapter);
    if (entity) return entity;
  }

  return null;
}

/**
 * Check if a directory name represents a dynamic segment
 */
function isDynamicSegment(name: string): boolean {
  // Matches [slug], [id], [...all], [[...optional]], etc.
  return name.startsWith("[") && name.endsWith("]");
}

/**
 * Try to load a page file and return an EntityInfo
 */
async function tryLoadPageFile(
  file: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<EntityInfo | null> {
  try {
    const info = await adapter.fs.stat(file);
    if (!info.isFile) return null;

    const raw = await adapter.fs.readFile(file);
    let content = raw;
    let fm: Record<string, unknown> = {};

    try {
      if (raw.trim().startsWith("---")) {
        const { extract } = await import("https://deno.land/std@0.220.0/front_matter/yaml.ts");
        const ex = extract(raw);
        content = ex.body;
        fm = (ex.attrs as Record<string, unknown>) || {};
      }
    } catch {
      /* best-effort frontmatter extraction */
    }

    // Coerce boolean layout to string as expected by Frontmatter
    const coercedFm: Record<string, unknown> = { ...fm };
    if (typeof coercedFm.layout === "boolean") {
      coercedFm.layout = coercedFm.layout ? "default" : "false";
    }

    return {
      entity: {
        id: file,
        slug,
        type: "page",
        isPage: true,
        isLayout: false,
        isProvider: false,
        isComponent: false,
        content,
        frontmatter: coercedFm as Frontmatter,
      },
    };
  } catch {
    return null;
  }
}
