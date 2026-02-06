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
import { join } from "#veryfront/compat/path";
import { extract } from "#std/front-matter/yaml.ts";

export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
): Promise<EntityInfo | null> {
  const exactMatch = await tryExactMatch(projectDir, slug, adapter, appDirName);
  if (exactMatch) return exactMatch;

  return tryDynamicMatch(projectDir, slug, adapter, appDirName);
}

async function tryExactMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
): Promise<EntityInfo | null> {
  const base = slug ? join(projectDir, appDirName, slug) : join(projectDir, appDirName);

  if (adapter.fs.resolveFile) {
    for (const basePath of [`${base}/page`, base]) {
      const resolvedPath = await adapter.fs.resolveFile(basePath);
      if (!resolvedPath) continue;

      const entity = await tryLoadPageFile(resolvedPath, slug, adapter);
      if (entity) return entity;
    }
    return null;
  }

  const candidates = [
    `${base}/page.mdx`,
    `${base}/page.md`,
    `${base}/page.tsx`,
    `${base}/page.jsx`,
    `${base}/page.ts`,
    `${base}/page.js`,
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

  for (const segment of segments) {
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

    const dynamic = await findDynamicDir(currentDir, adapter);
    if (!dynamic) return null;

    currentDir = join(currentDir, dynamic.name);
    if (dynamic.isCatchAll) break;
  }

  for (const ext of [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]) {
    const pageFile = join(currentDir, `page${ext}`);
    const entity = await tryLoadPageFile(pageFile, slug, adapter);
    if (entity) return entity;
  }

  return null;
}

async function findDynamicDir(
  dir: string,
  adapter: RuntimeAdapter,
): Promise<{ name: string; isCatchAll: boolean } | null> {
  try {
    const entries = await adapter.fs.readDir(dir);
    for await (const entry of entries) {
      if (!entry.isDirectory || !isDynamicSegment(entry.name)) continue;
      return { name: entry.name, isCatchAll: entry.name.startsWith("[...") };
    }
  } catch {
    // adapter.fs.readDir failed - no fallback to Deno for npm compatibility
  }

  return null;
}

async function tryLoadPageFile(
  file: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<EntityInfo | null> {
  try {
    const info = await adapter.fs.stat(file);
    if (!info.isFile) return null;
  } catch {
    return null;
  }

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
      fm = (ex.attrs as Record<string, unknown>) ?? {};
    } catch {
      // Malformed frontmatter - use raw content as-is
      // This allows pages with invalid YAML to still render
      content = raw;
    }
  }

  const frontmatter: Record<string, unknown> = { ...fm };
  if (typeof frontmatter.layout === "boolean") {
    frontmatter.layout = frontmatter.layout ? "default" : "false";
  }

  return {
    entity: {
      id: file,
      path: file,
      slug,
      type: "page",
      isPage: true,
      isLayout: false,
      isComponent: false,
      content,
      frontmatter: frontmatter as Frontmatter,
    },
  };
}
