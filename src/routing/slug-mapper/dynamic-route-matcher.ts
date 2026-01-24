import type { RouteParams } from "./types.ts";

export function isDynamicRoute(pattern: string): boolean {
  return /\[[\w.]+\]/.test(pattern);
}

function isSpreadParam(part: string): boolean {
  return part.startsWith("[...") && part.endsWith("]");
}

function isDynamicParam(part: string): boolean {
  return part.startsWith("[") && part.endsWith("]");
}

function hasSpreadParam(parts: string[]): boolean {
  return parts.some(isSpreadParam);
}

export function extractParams(pattern: string, slug: string): RouteParams | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const slugParts = slug.split("/").filter(Boolean);
  const params: RouteParams = {};

  if (!hasSpreadParam(patternParts) && patternParts.length !== slugParts.length) {
    return null;
  }

  let slugIndex = 0;

  for (const patternPart of patternParts) {
    if (isSpreadParam(patternPart)) {
      const paramName = patternPart.slice(4, -1);
      params[paramName] = slugParts.slice(slugIndex);
      return params;
    }

    const slugPart = slugParts[slugIndex];

    if (isDynamicParam(patternPart)) {
      if (slugPart === undefined) {
        return null;
      }
      const paramName = patternPart.slice(1, -1);
      params[paramName] = slugPart;
      slugIndex++;
      continue;
    }

    if (slugPart !== patternPart) {
      return null;
    }
    slugIndex++;
  }

  if (slugIndex < slugParts.length) {
    return null;
  }

  return params;
}

export function matchesPattern(pattern: string, slug: string): boolean {
  return extractParams(pattern, slug) !== null;
}
