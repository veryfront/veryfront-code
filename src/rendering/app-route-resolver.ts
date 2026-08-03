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
import {
  type EntityResolutionGate,
  type EntityResolutionOptions,
  withEntityResolutionAdmission,
} from "#veryfront/types/entities/getEntityInfo.ts";
import { isCatchAllSegment, isDynamicSegment } from "#veryfront/utils/route-path-utils.ts";
import { join } from "#veryfront/compat/path";
import { extract } from "#std/front-matter/yaml.ts";

export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
  options: EntityResolutionOptions = {},
): Promise<EntityInfo | null> {
  return await withEntityResolutionAdmission(
    projectDir,
    adapter,
    options,
    async (gate) => {
      const exactMatch = await tryExactMatch(
        projectDir,
        slug,
        adapter,
        appDirName,
        gate,
      );
      if (exactMatch) return exactMatch;

      return await tryDynamicMatch(projectDir, slug, adapter, appDirName, gate);
    },
  );
}

async function tryExactMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
  gate: EntityResolutionGate,
): Promise<EntityInfo | null> {
  const base = slug ? join(projectDir, appDirName, slug) : join(projectDir, appDirName);

  if (adapter.fs.resolveFile) {
    for (const basePath of [`${base}/page`, base]) {
      const resolvedPath = await gate.awaitOperation(() => adapter.fs.resolveFile!(basePath));
      if (!resolvedPath) continue;

      const entity = await tryLoadPageFile(resolvedPath, slug, adapter, gate);
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
    const entity = await tryLoadPageFile(file, slug, adapter, gate);
    if (entity) return entity;
  }

  return null;
}

async function tryDynamicMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
  gate: EntityResolutionGate,
): Promise<EntityInfo | null> {
  const segments = slug ? slug.split("/").filter(Boolean) : [];
  let currentDir = join(projectDir, appDirName);

  for (const segment of segments) {
    const routeDirectory = await findRouteDirectory(currentDir, segment, adapter, gate);
    if (!routeDirectory) return null;

    currentDir = join(currentDir, routeDirectory.name);
    if (routeDirectory.isCatchAll) break;
  }

  for (const ext of [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]) {
    const pageFile = join(currentDir, `page${ext}`);
    const entity = await tryLoadPageFile(pageFile, slug, adapter, gate);
    if (entity) return entity;
  }

  return null;
}

async function findRouteDirectory(
  dir: string,
  segment: string,
  adapter: RuntimeAdapter,
  gate: EntityResolutionGate,
): Promise<{ name: string; isCatchAll: boolean } | null> {
  try {
    return await gate.awaitOperation(async () => {
      const entries = await adapter.fs.readDir(dir);
      let dynamic: { name: string; isCatchAll: boolean } | null = null;

      for await (const entry of entries) {
        if (!entry.isDirectory && !entry.isSymlink) continue;
        if (entry.name === segment) return { name: entry.name, isCatchAll: false };
        if (!dynamic && isDynamicSegment(entry.name)) {
          dynamic = {
            name: entry.name,
            isCatchAll: isCatchAllSegment(entry.name),
          };
        }
      }

      return dynamic;
    });
  } catch (_) {
    gate.throwIfCancelled();
    /* expected: adapter.fs.readDir may fail for npm compatibility */
  }

  return null;
}

async function tryLoadPageFile(
  file: string,
  slug: string,
  adapter: RuntimeAdapter,
  gate: EntityResolutionGate,
): Promise<EntityInfo | null> {
  let raw: string;
  try {
    raw = await gate.awaitOperation(() => adapter.fs.readFile(file));
  } catch (_) {
    gate.throwIfCancelled();
    /* expected: file may not be readable */
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
