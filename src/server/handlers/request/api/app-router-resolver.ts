/**
 * App Router Route Resolver
 *
 * Resolves App Router route files with support for dynamic segments,
 * catch-all routes, and optional catch-all routes.
 */

import { joinPath } from "#veryfront/utils/path-utils.ts";
import {
  type ParsedRouteParameter,
  parseRouteParameterSegment,
} from "#veryfront/utils/route-path-utils.ts";
import type { HandlerContext } from "../../types.ts";
import type { AppRouteMatch } from "./types.ts";

interface RouteParameterDirectory {
  readonly directory: string;
  readonly parameter: ParsedRouteParameter;
}

type RouteParams = Record<string, string | string[]>;

function createRouteParams(): RouteParams {
  return Object.create(null) as RouteParams;
}

function withRouteParam(
  params: RouteParams,
  name: string,
  value: string | string[],
): RouteParams {
  const next = Object.assign(createRouteParams(), params);
  next[name] = value;
  return next;
}

function parameterDirectories(
  names: readonly string[],
  kind: ParsedRouteParameter["kind"],
): RouteParameterDirectory[] {
  const matches: RouteParameterDirectory[] = [];
  for (const directory of names) {
    const parameter = parseRouteParameterSegment(directory);
    if (parameter?.kind === kind && parameter.suffix === "") {
      matches.push({ directory, parameter });
    }
  }
  return matches;
}

async function readDirectoryNames(current: string, ctx: HandlerContext): Promise<string[] | null> {
  const names: string[] = [];

  try {
    for await (const entry of ctx.adapter.fs.readDir(current)) {
      if (entry.isDirectory) names.push(entry.name);
    }
  } catch {
    return null;
  }

  return names;
}

async function findRouteFile(current: string, ctx: HandlerContext): Promise<string | null> {
  const candidates = ["route.tsx", "route.ts", "route.jsx", "route.js"].map(
    (name) => joinPath(current, name),
  );

  for (const filePath of candidates) {
    try {
      const st = await ctx.adapter.fs.stat(filePath);
      if (st.isFile) return filePath;
    } catch {
      // continue
    }
  }

  return null;
}

async function resolveFromDirectory(
  current: string,
  segments: string[],
  index: number,
  params: RouteParams,
  ctx: HandlerContext,
): Promise<AppRouteMatch | null> {
  if (index >= segments.length) {
    const file = await findRouteFile(current, ctx);
    if (file) return { file, params };

    const names = await readDirectoryNames(current, ctx);
    if (!names) return null;

    for (const optionalCatchAll of parameterDirectories(names, "optional-catch-all")) {
      const optionalFile = await findRouteFile(
        joinPath(current, optionalCatchAll.directory),
        ctx,
      );
      if (optionalFile) {
        return {
          file: optionalFile,
          params: withRouteParam(params, optionalCatchAll.parameter.name, []),
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

  for (const dynamicSegment of parameterDirectories(names, "dynamic")) {
    const dynamicMatch = await resolveFromDirectory(
      joinPath(current, dynamicSegment.directory),
      segments,
      index + 1,
      withRouteParam(params, dynamicSegment.parameter.name, seg),
      ctx,
    );
    if (dynamicMatch) return dynamicMatch;
  }

  const remainingSegments = segments.slice(index);

  for (const catchAllSegment of parameterDirectories(names, "catch-all")) {
    const catchAllMatch = await resolveFromDirectory(
      joinPath(current, catchAllSegment.directory),
      segments,
      segments.length,
      withRouteParam(params, catchAllSegment.parameter.name, remainingSegments),
      ctx,
    );
    if (catchAllMatch) return catchAllMatch;
  }

  for (const optionalCatchAll of parameterDirectories(names, "optional-catch-all")) {
    const optionalMatch = await resolveFromDirectory(
      joinPath(current, optionalCatchAll.directory),
      segments,
      segments.length,
      withRouteParam(params, optionalCatchAll.parameter.name, remainingSegments),
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
  const appRoot = joinPath(ctx.projectDir, ctx.config?.directories?.app ?? "app");

  try {
    const st = await ctx.adapter.fs.stat(appRoot);
    if (!st.isDirectory) return null;
  } catch (_) {
    // expected: app directory doesn't exist
    return null;
  }

  const normalized = path === "/" ? "/" : path.replace(/\/$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return resolveFromDirectory(appRoot, segments, 0, createRouteParams(), ctx);
}
