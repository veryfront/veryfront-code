import type { RouteParams } from "./types.ts";
export { isDynamicRoute } from "#veryfront/utils/route-path-utils.ts";

function isSpreadParam(part: string): boolean {
  return part.startsWith("[...") && part.endsWith("]");
}

function isDynamicParam(part: string): boolean {
  return part.startsWith("[") && part.endsWith("]");
}

export function extractParams(pattern: string, slug: string): RouteParams | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const slugParts = slug.split("/").filter(Boolean);
  const params: RouteParams = {};

  const hasSpread = patternParts.some(isSpreadParam);
  if (!hasSpread && patternParts.length !== slugParts.length) {
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

  return slugIndex < slugParts.length ? null : params;
}

export function matchesPattern(pattern: string, slug: string): boolean {
  return extractParams(pattern, slug) !== null;
}
