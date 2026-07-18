import type { Route } from "./types.ts";

const ROUTE_PARAMETER_PATTERN = /\[\[\.\.\.(\w+)\]\]|\[\.\.\.(\w+)\]|\[(\w+)\]/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseRoute(pattern: string, page: string): Route {
  const paramNames: string[] = [];
  let isCatchAll = false;
  let isOptionalCatchAll = false;
  let regexPattern = "";
  let cursor = 0;

  for (const match of pattern.matchAll(ROUTE_PARAMETER_PATTERN)) {
    const matchIndex = match.index;
    const matchedText = match[0];
    let literal = pattern.slice(cursor, matchIndex);
    const optionalCatchAll = match[1];
    if (optionalCatchAll) {
      paramNames.push(optionalCatchAll);
      isOptionalCatchAll = true;
      isCatchAll = true;
      const isTrailingSegment = matchIndex + matchedText.length === pattern.length &&
        literal.endsWith("/");
      if (isTrailingSegment) {
        literal = literal.slice(0, -1);
        regexPattern += `${escapeRegex(literal)}(?:/(.*))?`;
      } else {
        regexPattern += `${escapeRegex(literal)}(.*)`;
      }
      cursor = matchIndex + matchedText.length;
      continue;
    }

    const catchAll = match[2];
    if (catchAll) {
      paramNames.push(catchAll);
      isCatchAll = true;
      regexPattern += `${escapeRegex(literal)}(.+)`;
      cursor = matchIndex + matchedText.length;
      continue;
    }

    const param = match[3];
    if (param) {
      paramNames.push(param);
      regexPattern += `${escapeRegex(literal)}([^/]+)`;
      cursor = matchIndex + matchedText.length;
    }
  }

  regexPattern += escapeRegex(pattern.slice(cursor));

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
