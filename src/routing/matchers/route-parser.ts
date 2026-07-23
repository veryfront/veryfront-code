import type { Route } from "./types.ts";
import {
  compareRouteSpecificity as compareStructuralSpecificity,
  compileRoutePattern,
  getRouteDefinitionSpecificity,
} from "#veryfront/utils/route-path-utils.ts";

export function parseRoute(pattern: string, page: string): Route {
  const compiled = compileRoutePattern(pattern);
  const kinds = compiled.parameters.map((parameter) => parameter.kind);

  return {
    pattern,
    page,
    regex: compiled.regex,
    paramNames: compiled.parameters.map((parameter) => parameter.name),
    isCatchAll: kinds.some((kind) => kind !== "dynamic"),
    isOptionalCatchAll: kinds.includes("optional-catch-all"),
  };
}

// Larger than every segment and terminal score so an earlier segment always wins.
const SPECIFICITY_RADIX = 7;
const EXACT_TERMINAL_SCORE = 5;
const OPTIONAL_TERMINAL_SCORE = 4;

/** Precision-safe structural ordering for route definitions. */
export function compareRouteSpecificity(left: Route, right: Route): number {
  const leftSpecificity = getRouteDefinitionSpecificity(left.pattern);
  const rightSpecificity = getRouteDefinitionSpecificity(right.pattern);
  if (!leftSpecificity) return rightSpecificity ? -1 : 0;
  if (!rightSpecificity) return 1;
  return compareStructuralSpecificity(leftSpecificity, rightSpecificity);
}

/** @deprecated Use structural comparison for ordering; this number is compatibility-only. */
export function getSpecificityScore(route: Route): number {
  const specificity = getRouteDefinitionSpecificity(route.pattern);
  if (!specificity) return -1;

  let score = specificity.segments.length;
  let weight = 1 / SPECIFICITY_RADIX;

  for (const segmentScore of specificity.segments) {
    score += segmentScore * weight;
    weight /= SPECIFICITY_RADIX;
  }

  // A terminal marker ranks an exact route above the same prefix followed by
  // an optional catch-all that consumed no URL segments.
  const terminalScore = specificity.emptyOptionalCatchAllCount > 0
    ? OPTIONAL_TERMINAL_SCORE
    : EXACT_TERMINAL_SCORE;
  return score + terminalScore * weight;
}
