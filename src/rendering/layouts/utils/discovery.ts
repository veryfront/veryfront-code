import {
  memoizeAsync,
  memoizeHash as simpleHash,
  rendererLogger as logger,
} from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem } from "@veryfront/types";
import { dirname, extname, join } from "@veryfront/platform/compat/path-helper.ts";
import { LAYOUT_EXTENSIONS } from "../types.ts";

async function discoverNestedLayoutsImpl(
  pageFilePath: string,
  rootDir: string,
  _projectDir: string,
  adapter: RuntimeAdapter,
): Promise<LayoutItem[]> {
  const nestedLayouts: LayoutItem[] = [];

  try {
    let currentDir = dirname(pageFilePath);
    const candidates: string[] = [];

    while (currentDir.startsWith(rootDir)) {
      for (const ext of LAYOUT_EXTENSIONS) {
        candidates.push(join(currentDir, `layout.${ext}`));
      }
      const parent = dirname(currentDir);
      if (parent === currentDir || currentDir === rootDir) break;
      currentDir = parent;
    }

    if (!candidates.includes(join(rootDir, "layout.mdx"))) {
      for (const ext of LAYOUT_EXTENSIONS) {
        candidates.push(join(rootDir, `layout.${ext}`));
      }
    }

    const existing = await resolveExistingFiles(candidates.reverse(), adapter);

    logger.debug("Found layout files:", existing);
    addLayoutsFromFiles(existing, nestedLayouts);

    await addMissedAncestorLayouts(
      pageFilePath,
      rootDir,
      existing,
      nestedLayouts,
      adapter,
    );
  } catch (e) {
    logger.warn("Nested layout discovery failed", e);
  }

  return nestedLayouts;
}

export const discoverNestedLayouts = memoizeAsync(
  discoverNestedLayoutsImpl,
  (pageFilePath: string, rootDir: string, _projectDir: string, _adapter: RuntimeAdapter) =>
    simpleHash(pageFilePath, rootDir),
);

async function resolveExistingFiles(
  candidates: string[],
  adapter: RuntimeAdapter,
): Promise<string[]> {
  const results = await Promise.allSettled(
    candidates.map((file) => adapter.fs.stat(file)),
  );

  const existing: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) continue;

    if (result.status === "fulfilled" && result.value.isFile) {
      existing.push(candidates[i]!);
    } else if (result.status === "rejected") {
      logger.debug("[layout] stat layout candidate failed", result.reason as Error);
    }
  }
  return existing;
}

function addLayoutsFromFiles(files: string[], nestedLayouts: LayoutItem[]): void {
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext === ".mdx" || ext === ".md") {
      nestedLayouts.push({ kind: "mdx", path: file });
    } else if (ext === ".tsx" || ext === ".jsx" || ext === ".ts" || ext === ".js") {
      logger.debug("Adding TSX layout:", file);
      nestedLayouts.push({
        kind: "tsx",
        component: undefined,
        componentPath: file,
        path: file,
      });
    }
  }
}

async function addMissedAncestorLayouts(
  pageFilePath: string,
  rootDir: string,
  existing: string[],
  nestedLayouts: LayoutItem[],
  adapter: RuntimeAdapter,
): Promise<void> {
  try {
    const included = new Set(existing);
    const candidates: string[] = [];
    let dir = dirname(pageFilePath);

    while (dir.startsWith(rootDir)) {
      for (const ext of LAYOUT_EXTENSIONS) {
        const candidate = join(dir, `layout.${ext}`);
        if (!included.has(candidate)) candidates.push(candidate);
      }

      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    const results = await Promise.allSettled(
      candidates.map((cand) => adapter.fs.stat(cand)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const cand = candidates[i];
      if (!result || !cand) continue;

      if (result.status === "fulfilled" && result.value.isFile) {
        const ext = extname(cand).toLowerCase();
        const kind = (ext === ".mdx" || ext === ".md") ? "mdx" : "tsx";
        if (kind === "mdx") {
          nestedLayouts.push({ kind: "mdx", path: cand });
        } else {
          nestedLayouts.push({
            kind: "tsx",
            component: undefined,
            componentPath: cand,
            path: cand,
          });
        }
        included.add(cand);
      } else if (result.status === "rejected") {
        logger.debug("[layout] stat nested tsx/jsx layout failed", result.reason as Error);
      }
    }
  } catch (e) {
    logger.debug("[layout] nested layout fallback scan failed", e as Error);
  }
}
