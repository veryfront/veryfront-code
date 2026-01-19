/**
 * App Router Entity Resolution
 *
 * Handles resolution of App Router page entities, including:
 * - Exact route matching
 * - Dynamic segment matching ([id], [...slug], etc.)
 * - Page file loading with frontmatter extraction
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, Frontmatter } from "#veryfront/types";
import { isDynamicSegment } from "#veryfront/utils/route-path-utils.ts";
import { join } from "../platform/compat/path-helper.ts";
import { extract } from "#std/front-matter/yaml.ts";

export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
): Promise<EntityInfo | null> {
  const exactMatch = await tryExactMatch(projectDir, slug, adapter, appDirName);
  if (exactMatch) return exactMatch;

  return await tryDynamicMatch(projectDir, slug, adapter, appDirName);
}

async function tryExactMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
): Promise<EntityInfo | null> {
  const base = slug ? join(projectDir, appDirName, slug) : join(projectDir, appDirName);

  // If adapter has resolveFile, use pattern-based resolution
  if (adapter.fs.resolveFile) {
    const basePaths = [`${base}/page`, base];
    for (const basePath of basePaths) {
      const resolvedPath = await adapter.fs.resolveFile(basePath);
      if (resolvedPath) {
        const entity = await tryLoadPageFile(resolvedPath, slug, adapter);
        if (entity) return entity;
      }
    }
    return null;
  }

  // Fallback for adapters without resolveFile
  const candidates = [
    `${base}/page.mdx`,
    `${base}/page.md`,
    `${base}/page.tsx`,
    `${base}/page.jsx`,
    `${base}/page.ts`,
    `${base}/page.js`,
    // index-like shorthand
    `${base}.mdx`,
    `${base}.md`,
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

async function tryDynamicMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
): Promise<EntityInfo | null> {
  const segments = slug ? slug.split("/").filter(Boolean) : [];
  let currentDir = join(projectDir, appDirName);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const exactPath = join(currentDir, segment);

    try {
      const stat = await adapter.fs.stat(exactPath);
      if (stat.isDirectory) {
        currentDir = exactPath;
        continue;
      }
    } catch {
      // Exact match failed, try dynamic segments
    }

    let foundDynamic = false;
    let isCatchAll = false;
    try {
      const entries = await adapter.fs.readDir(currentDir);
      for await (const entry of entries) {
        if (entry.isDirectory && isDynamicSegment(entry.name)) {
          currentDir = join(currentDir, entry.name);
          foundDynamic = true;
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
      return null;
    }

    if (isCatchAll) {
      break;
    }
  }

  const pageExtensions = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"];
  for (const ext of pageExtensions) {
    const pageFile = join(currentDir, `page${ext}`);
    const entity = await tryLoadPageFile(pageFile, slug, adapter);
    if (entity) return entity;
  }

  return null;
}

async function tryLoadPageFile(
  file: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<EntityInfo | null> {
  let info: { isFile: boolean };
  try {
    info = await adapter.fs.stat(file);
  } catch {
    return null;
  }
  if (!info.isFile) return null;

  let raw: string;
  try {
    raw = await adapter.fs.readFile(file);
  } catch {
    return null;
  }

  let content = raw;
  let fm: Record<string, unknown> = {};

  if (raw.trim().startsWith("---")) {
    try {
      const ex = extract(raw);
      content = ex.body;
      fm = (ex.attrs as Record<string, unknown>) || {};
    } catch {
      // Malformed frontmatter - use raw content as-is
      // This allows pages with invalid YAML to still render
      content = raw;
    }
  }

  const coercedFm: Record<string, unknown> = { ...fm };
  if (typeof coercedFm.layout === "boolean") {
    coercedFm.layout = coercedFm.layout ? "default" : "false";
  }

  return {
    entity: {
      id: file,
      path: file,
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
}
