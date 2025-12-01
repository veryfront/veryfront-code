import type { RouteParams } from "./types.ts";

export function isDynamicRoute(pattern: string): boolean {
  return /\[[\w.]+\]/.test(pattern);
}

export function extractParams(
  pattern: string,
  slug: string,
): RouteParams | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const slugParts = slug.split("/").filter(Boolean);

  const params: RouteParams = {};

  let hasSpreadParam = false;
  for (const part of patternParts) {
    if (part.startsWith("[...") && part.endsWith("]")) {
      hasSpreadParam = true;
      break;
    }
  }

  if (!hasSpreadParam && patternParts.length !== slugParts.length) {
    return null;
  }

  let slugIndex = 0;

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    if (!patternPart) continue;

    if (patternPart.startsWith("[...") && patternPart.endsWith("]")) {
      const paramName = patternPart.slice(4, -1);
      const remainingParts = slugParts.slice(slugIndex);
      params[paramName] = remainingParts;
      return params;
    }

    if (patternPart.startsWith("[") && patternPart.endsWith("]")) {
      const paramName = patternPart.slice(1, -1);
      if (slugIndex >= slugParts.length) {
        return null;
      }
      const slugPart = slugParts[slugIndex];
      if (slugPart !== undefined) {
        params[paramName] = slugPart;
      }
      slugIndex++;
      continue;
    }

    if (slugIndex >= slugParts.length || slugParts[slugIndex] !== patternPart) {
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
