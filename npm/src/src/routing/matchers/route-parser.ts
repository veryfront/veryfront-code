import type { Route } from "./types.js";

export function parseRoute(pattern: string, page: string): Route {
  const paramNames: string[] = [];
  let isCatchAll = false;
  let isOptionalCatchAll = false;

  for (const match of pattern.matchAll(/\[\[\.\.\.(\w+)\]\]|\[\.\.\.(\w+)\]|\[(\w+)\]/g)) {
    const optionalCatchAll = match[1];
    const catchAll = match[2];
    const param = match[3];

    if (optionalCatchAll) {
      paramNames.push(optionalCatchAll);
      isOptionalCatchAll = true;
      isCatchAll = true;
      continue;
    }

    if (catchAll) {
      paramNames.push(catchAll);
      isCatchAll = true;
      continue;
    }

    if (param) paramNames.push(param);
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
    paramNames,
    isCatchAll,
    isOptionalCatchAll,
  };
}

/** Segment patterns ordered from lowest to highest priority */
const SEGMENT_PATTERNS: Array<{ pattern: string; score: number }> = [
  { pattern: "[[...", score: 1 }, // Optional catch-all - lowest priority
  { pattern: "[...", score: 2 }, // Catch-all
  { pattern: "[", score: 3 }, // Dynamic segment
];

function getSegmentScore(segment: string): number {
  for (const { pattern, score } of SEGMENT_PATTERNS) {
    if (segment.includes(pattern)) return score;
  }
  return 4; // Static segment - highest priority
}

export function getSpecificityScore(route: Route): number {
  const segments = route.pattern.split("/").filter(Boolean);
  const baseScore = segments.reduce((sum, seg) => sum + getSegmentScore(seg), 0);
  return baseScore + segments.length * 0.1;
}
