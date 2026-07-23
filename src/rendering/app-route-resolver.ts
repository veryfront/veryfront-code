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
import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { ROUTE_CONFLICT } from "#veryfront/errors/error-registry/route.ts";
import { extract } from "#std/front-matter/yaml.ts";

export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
): Promise<EntityInfo | null> {
  const normalizedSlug = normalizeRouteSlug(slug);
  if (normalizedSlug === null || !isSafeRelativePath(appDirName)) return null;

  const appRoot = join(projectDir, appDirName);
  if (!isPathWithinRoot(appRoot, projectDir)) return null;

  const exactMatch = await tryExactMatch(appRoot, normalizedSlug, adapter);
  if (exactMatch) return exactMatch;

  return tryDynamicMatch(appRoot, normalizedSlug, adapter);
}

async function tryExactMatch(
  appRoot: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<EntityInfo | null> {
  const base = slug ? join(appRoot, slug) : appRoot;

  if (adapter.fs.resolveFile) {
    for (const basePath of [`${base}/page`, base]) {
      let resolvedPath: string | null;
      try {
        resolvedPath = await adapter.fs.resolveFile(basePath);
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw error;
      }
      if (!resolvedPath) continue;

      const entity = await tryLoadPageFile(resolvedPath, slug, adapter, appRoot);
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
    const entity = await tryLoadPageFile(file, slug, adapter, appRoot);
    if (entity) return entity;
  }

  return null;
}

async function tryDynamicMatch(
  appRoot: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<EntityInfo | null> {
  const segments = slug ? slug.split("/").filter(Boolean) : [];
  let currentDir = appRoot;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const exactPath = join(currentDir, segment);

    try {
      const stat = await safeDirectoryStat(exactPath, appRoot, adapter);
      if (stat) {
        currentDir = exactPath;
        continue;
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: exact path may not exist, try dynamic segments */
    }

    const dynamic = await findDynamicDir(currentDir, appRoot, adapter);
    if (!dynamic) return null;

    currentDir = join(currentDir, dynamic.name);
    if (dynamic.isCatchAll) break;
  }

  const directPage = await tryLoadPageInDirectory(currentDir, slug, adapter, appRoot);
  if (directPage) return directPage;

  // An optional catch-all also matches an empty remainder.
  const optionalCatchAll = await findOptionalCatchAllDir(currentDir, appRoot, adapter);
  if (optionalCatchAll) {
    return await tryLoadPageInDirectory(
      join(currentDir, optionalCatchAll),
      slug,
      adapter,
      appRoot,
    );
  }

  return null;
}

async function tryLoadPageInDirectory(
  directory: string,
  slug: string,
  adapter: RuntimeAdapter,
  appRoot: string,
): Promise<EntityInfo | null> {
  for (const ext of [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]) {
    const pageFile = join(directory, `page${ext}`);
    const entity = await tryLoadPageFile(pageFile, slug, adapter, appRoot);
    if (entity) return entity;
  }

  return null;
}

async function findDynamicDir(
  dir: string,
  appRoot: string,
  adapter: RuntimeAdapter,
): Promise<{ name: string; isCatchAll: boolean } | null> {
  const candidates: Array<{ name: string; isCatchAll: boolean; priority: number }> = [];

  try {
    const entries = await adapter.fs.readDir(dir);
    for await (const entry of entries) {
      if (
        !entry.isDirectory || entry.isSymlink || !isSafeDirectoryEntryName(entry.name) ||
        !isDynamicSegment(entry.name)
      ) continue;

      const path = join(dir, entry.name);
      if (!await isCandidateWithinRoot(path, appRoot, adapter)) continue;

      const isCatchAll = entry.name.includes("...");
      const priority = entry.name.startsWith("[[...") ? 2 : isCatchAll ? 1 : 0;
      candidates.push({ name: entry.name, isCatchAll, priority });
    }
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  candidates.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const bestPriority = candidates[0]?.priority;
  const best = candidates.filter((candidate) => candidate.priority === bestPriority);
  if (best.length > 1) {
    throw ROUTE_CONFLICT.create({
      detail: "Multiple dynamic route directories match the same segment",
      context: { candidateCount: best.length },
    });
  }

  const selected = best[0];
  return selected ? { name: selected.name, isCatchAll: selected.isCatchAll } : null;
}

async function findOptionalCatchAllDir(
  dir: string,
  appRoot: string,
  adapter: RuntimeAdapter,
): Promise<string | null> {
  let selected: string | null = null;

  try {
    for await (const entry of adapter.fs.readDir(dir)) {
      if (
        !entry.isDirectory || entry.isSymlink || !entry.name.startsWith("[[...") ||
        !isDynamicSegment(entry.name) || !isSafeDirectoryEntryName(entry.name)
      ) continue;
      if (!await isCandidateWithinRoot(join(dir, entry.name), appRoot, adapter)) continue;
      if (selected !== null) {
        throw ROUTE_CONFLICT.create({
          detail: "Multiple optional catch-all route directories match the same route",
          context: { candidateCount: 2 },
        });
      }
      selected = entry.name;
    }
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return selected;
}

async function tryLoadPageFile(
  file: string,
  slug: string,
  adapter: RuntimeAdapter,
  appRoot: string,
): Promise<EntityInfo | null> {
  if (!await isCandidateWithinRoot(file, appRoot, adapter)) return null;

  let raw: string;
  try {
    raw = await adapter.fs.readFile(file);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    /* expected: candidate file may not exist */
    return null;
  }

  let content = raw;
  let fm: Record<string, unknown> = {};

  if (raw.trim().startsWith("---")) {
    try {
      const ex = extract(raw);
      content = ex.body;
      fm = (ex.attrs as Record<string, unknown>) ?? {};
    } catch (_) {
      /* expected: malformed frontmatter - use raw content as-is */
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

function normalizeRouteSlug(slug: string): string | null {
  if (slug.includes("\0") || slug.includes("\\")) return null;
  const segments = slug.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === "..")) return null;
  return segments.join("/");
}

function isSafeRelativePath(path: string): boolean {
  return path !== "" && !path.includes("\0") && !path.includes("\\") &&
    !isAbsolute(path) && path.split("/").every((segment) => segment !== ".." && segment !== "");
}

function isSafeDirectoryEntryName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("\0") &&
    !name.includes("/") && !name.includes("\\");
}

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(normalize(root), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}

async function safeDirectoryStat(
  path: string,
  appRoot: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  if (!await isCandidateWithinRoot(path, appRoot, adapter)) return false;
  const stat = await adapter.fs.stat(path);
  return stat.isDirectory && !stat.isSymlink;
}

async function isCandidateWithinRoot(
  path: string,
  root: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  if (!isPathWithinRoot(path, root)) return false;

  if (adapter.fs.lstat) {
    try {
      const stat = await adapter.fs.lstat(path);
      if (stat.isSymlink) return false;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  if (!adapter.fs.realPath) return true;

  try {
    const [canonicalPath, canonicalRoot] = await Promise.all([
      adapter.fs.realPath(path),
      adapter.fs.realPath(root),
    ]);
    return isPathWithinRoot(canonicalPath, canonicalRoot);
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}
