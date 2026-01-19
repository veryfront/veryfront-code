/**
 * App Router Route Resolver
 *
 * Resolves App Router route files with support for dynamic segments,
 * catch-all routes, and optional catch-all routes.
 */

import { joinPath } from "#veryfront/utils/path-utils.ts";
import type { HandlerContext } from "../../types.ts";
import type { AppRouteMatch } from "./types.ts";

/**
 * Resolves an App Router route file from a pathname
 *
 * Supports:
 * - Static routes: `/about`
 * - Dynamic segments: `/posts/[id]`
 * - Catch-all routes: `/blog/[...slug]`
 * - Optional catch-all: `/docs/[[...slug]]`
 *
 * @param path - Request pathname to resolve
 * @param ctx - Handler context containing project directory and adapter
 * @returns Match result with file path and params, or null if not found
 *
 * @example
 * ```ts
 * const match = await resolveAppRouteFile("/api/users/123", ctx);
 * if (match) {
 *   console.log(match.file); // "/path/to/app/api/users/[id]/route.ts"
 *   console.log(match.params); // { id: "123" }
 * }
 * ```
 */
export async function resolveAppRouteFile(
  path: string,
  ctx: HandlerContext,
): Promise<AppRouteMatch | null> {
  const appRoot = joinPath(ctx.projectDir, "app");

  // Ensure app root exists
  try {
    const st = await ctx.adapter.fs.stat(appRoot);
    if (!st.isDirectory) return null;
  } catch {
    return null;
  }

  const normalized = path === "/" ? "/" : path.replace(/\/$/, "");
  const segments = normalized.split("/").filter(Boolean);
  let current = appRoot;
  const params: Record<string, string | string[]> = {};

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;

    // Read current directory entries
    const names: string[] = [];
    try {
      for await (const e of ctx.adapter.fs.readDir(current)) {
        if (e.isDirectory) names.push(e.name);
      }
    } catch {
      return null;
    }

    // Exact match
    if (names.includes(seg)) {
      current = joinPath(current, seg);
      continue;
    }

    // Dynamic segment [param]
    const dyn = names.find((n) => /^\[[^\]]+\]$/.test(n));
    if (dyn) {
      params[dyn.slice(1, -1)] = seg;
      current = joinPath(current, dyn);
      continue;
    }

    // Catch-all [...param]
    const ca = names.find((n) => /^\[\.\.\.[^\]]+\]$/.test(n));
    if (ca) {
      params[ca.slice(4, -1)] = segments.slice(i).join("/");
      current = joinPath(current, ca);
      break;
    }

    // Optional catch-all [[...param]]
    const opt = names.find((n) => /^\[\[\.\.\.[^\]]+\]\]$/.test(n));
    if (opt) {
      params[opt.slice(5, -2)] = segments.slice(i).join("/");
      current = joinPath(current, opt);
      break;
    }

    return null;
  }

  // Look for route.ts[x]|js[x]
  const candidates = ["route.tsx", "route.ts", "route.jsx", "route.js"].map(
    (n) => joinPath(current, n),
  );

  for (const f of candidates) {
    try {
      const st = await ctx.adapter.fs.stat(f);
      if (st.isFile) return { file: f, params };
    } catch {
      /* continue */
    }
  }

  return null;
}
