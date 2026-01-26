/**
 * App Router Route Resolver
 *
 * Resolves App Router route files with support for dynamic segments,
 * catch-all routes, and optional catch-all routes.
 */

import { joinPath } from "../../../../utils/path-utils.js";
import type { HandlerContext } from "../../types.js";
import type { AppRouteMatch } from "./types.js";

export async function resolveAppRouteFile(
  path: string,
  ctx: HandlerContext,
): Promise<AppRouteMatch | null> {
  const appRoot = joinPath(ctx.projectDir, "app");

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

    let names: string[];
    try {
      names = [];
      for await (const e of ctx.adapter.fs.readDir(current)) {
        if (e.isDirectory) names.push(e.name);
      }
    } catch {
      return null;
    }

    if (names.includes(seg)) {
      current = joinPath(current, seg);
      continue;
    }

    const dyn = names.find((n) => /^\[[^\]]+\]$/.test(n));
    if (dyn) {
      params[dyn.slice(1, -1)] = seg;
      current = joinPath(current, dyn);
      continue;
    }

    const ca = names.find((n) => /^\[\.\.\.[^\]]+\]$/.test(n));
    if (ca) {
      params[ca.slice(4, -1)] = segments.slice(i).join("/");
      current = joinPath(current, ca);
      break;
    }

    const opt = names.find((n) => /^\[\[\.\.\.[^\]]+\]\]$/.test(n));
    if (opt) {
      params[opt.slice(5, -2)] = segments.slice(i).join("/");
      current = joinPath(current, opt);
      break;
    }

    return null;
  }

  const candidates = ["route.tsx", "route.ts", "route.jsx", "route.js"].map(
    (n) => joinPath(current, n),
  );

  for (const f of candidates) {
    try {
      const st = await ctx.adapter.fs.stat(f);
      if (st.isFile) return { file: f, params };
    } catch {
      // continue
    }
  }

  return null;
}
