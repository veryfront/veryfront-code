/**
 * App Router Route Resolver
 *
 * Resolves App Router route files with support for dynamic segments,
 * catch-all routes, and optional catch-all routes.
 */

import { isWithinDirectory, joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";
import { extractParamName } from "#veryfront/utils/route-path-utils.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { HandlerContext } from "../../types.ts";
import type { AppRouteMatch } from "./types.ts";

const STANDARD_DYNAMIC_SEGMENT_RE = /^\[[^\]]+\]$/;
const CATCH_ALL_SEGMENT_RE = /^\[\.\.\.[^\]]+\]$/;
const OPTIONAL_CATCH_ALL_SEGMENT_RE = /^\[\[\.\.\.[^\]]+\]\]$/;

function isStandardDynamicSegment(name: string): boolean {
  return STANDARD_DYNAMIC_SEGMENT_RE.test(name) &&
    !CATCH_ALL_SEGMENT_RE.test(name) &&
    !OPTIONAL_CATCH_ALL_SEGMENT_RE.test(name);
}

async function readDirectoryNames(current: string, ctx: HandlerContext): Promise<string[] | null> {
  const names: string[] = [];

  try {
    for await (const entry of ctx.adapter.fs.readDir(current)) {
      if (entry.isDirectory && !entry.isSymlink) names.push(entry.name);
    }
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  return names.sort((left, right) => left.localeCompare(right));
}

async function findRouteFile(current: string, ctx: HandlerContext): Promise<string | null> {
  const candidates = ["route.tsx", "route.ts", "route.jsx", "route.js"].map(
    (name) => joinPath(current, name),
  );

  for (const filePath of candidates) {
    try {
      const st = await ctx.adapter.fs.stat(filePath);
      if (st.isFile && !st.isSymlink) return filePath;
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }

  return null;
}

async function resolveFromDirectory(
  current: string,
  segments: string[],
  index: number,
  params: Record<string, string | string[]>,
  ctx: HandlerContext,
): Promise<AppRouteMatch | null> {
  if (index >= segments.length) {
    const file = await findRouteFile(current, ctx);
    if (file) return { file, params };

    const names = await readDirectoryNames(current, ctx);
    if (!names) return null;

    for (
      const optionalCatchAll of names.filter((name) => OPTIONAL_CATCH_ALL_SEGMENT_RE.test(name))
    ) {
      const optionalFile = await findRouteFile(joinPath(current, optionalCatchAll), ctx);
      if (optionalFile) {
        return {
          file: optionalFile,
          params: {
            ...params,
            [extractParamName(optionalCatchAll)]: [],
          },
        };
      }
    }

    return null;
  }

  const names = await readDirectoryNames(current, ctx);
  if (!names) return null;

  const seg = segments[index]!;

  if (names.includes(seg)) {
    const exactMatch = await resolveFromDirectory(
      joinPath(current, seg),
      segments,
      index + 1,
      params,
      ctx,
    );
    if (exactMatch) return exactMatch;
  }

  for (const dynamicSegment of names.filter(isStandardDynamicSegment)) {
    const dynamicMatch = await resolveFromDirectory(
      joinPath(current, dynamicSegment),
      segments,
      index + 1,
      {
        ...params,
        [extractParamName(dynamicSegment)]: seg,
      },
      ctx,
    );
    if (dynamicMatch) return dynamicMatch;
  }

  const remainingSegments = segments.slice(index);

  for (const catchAllSegment of names.filter((name) => CATCH_ALL_SEGMENT_RE.test(name))) {
    const catchAllMatch = await resolveFromDirectory(
      joinPath(current, catchAllSegment),
      segments,
      segments.length,
      {
        ...params,
        [extractParamName(catchAllSegment)]: remainingSegments,
      },
      ctx,
    );
    if (catchAllMatch) return catchAllMatch;
  }

  for (const optionalCatchAll of names.filter((name) => OPTIONAL_CATCH_ALL_SEGMENT_RE.test(name))) {
    const optionalMatch = await resolveFromDirectory(
      joinPath(current, optionalCatchAll),
      segments,
      segments.length,
      {
        ...params,
        [extractParamName(optionalCatchAll)]: remainingSegments,
      },
      ctx,
    );
    if (optionalMatch) return optionalMatch;
  }

  return null;
}

export async function resolveAppRouteFile(
  path: string,
  ctx: HandlerContext,
): Promise<AppRouteMatch | null> {
  const projectRoot = normalizePath(ctx.projectDir);
  const appRoot = normalizePath(joinPath(projectRoot, ctx.config?.directories?.app ?? "app"));
  if (!isWithinDirectory(projectRoot, appRoot)) return null;

  try {
    const st = await ctx.adapter.fs.stat(appRoot);
    if (!st.isDirectory || st.isSymlink) return null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  const normalized = path === "/" ? "/" : path.replace(/\/$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return resolveFromDirectory(appRoot, segments, 0, {}, ctx);
}
