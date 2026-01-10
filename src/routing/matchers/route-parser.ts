import type { Route } from "./types.ts";

export function parseRoute(pattern: string, page: string): Route {
  const orderedParamNames: string[] = [];
  let isCatchAll = false;
  let isOptionalCatchAll = false;

  for (const match of pattern.matchAll(/\[\[\.\.\.(\w+)\]\]|\[\.\.\.(\w+)\]|\[(\w+)\]/g)) {
    if (match[1]) {
      orderedParamNames.push(match[1]);
      isOptionalCatchAll = true;
      isCatchAll = true;
    } else if (match[2]) {
      orderedParamNames.push(match[2]);
      isCatchAll = true;
    } else if (match[3]) {
      orderedParamNames.push(match[3]);
    }
  }

  let regexPattern = pattern
    .replace(/\[\[\.\.\.(\w+)\]\]/g, "___OPTIONAL_CATCHALL___")
    .replace(/\[\.\.\.(\w+)\]/g, "___CATCHALL___")
    .replace(/\[(\w+)\]/g, "___PARAM___")
    .replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
    .replace(/___OPTIONAL_CATCHALL___/g, "(.*)")
    .replace(/___CATCHALL___/g, "(.+)")
    .replace(/___PARAM___/g, "([^/]+)");

  if (isOptionalCatchAll) {
    regexPattern = regexPattern.replace(/\\\/\(\.\*\)$/, "(?:\\/(.*))?");
  }

  return {
    pattern,
    page,
    regex: new RegExp(`^${regexPattern}$`),
    paramNames: orderedParamNames,
    isCatchAll,
    isOptionalCatchAll,
  };
}

function getSegmentScore(segment: string): number {
  if (segment.includes("[[...")) return 1; // Optional catch-all - lowest priority
  if (segment.includes("[...")) return 2; // Catch-all
  if (segment.includes("[")) return 3; // Dynamic segment
  return 4; // Static segment - highest priority
}

export function getSpecificityScore(route: Route): number {
  const segments = route.pattern.split("/").filter(Boolean);
  const baseScore = segments.reduce((sum, seg) => sum + getSegmentScore(seg), 0);
  return baseScore + segments.length * 0.1;
}
