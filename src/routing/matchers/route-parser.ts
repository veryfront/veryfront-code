import type { Route } from "./types.ts";

export function parseRoute(pattern: string, page: string): Route {
  const orderedParamNames: string[] = [];
  let isCatchAll = false;
  let isOptionalCatchAll = false;

  for (const match of pattern.matchAll(/\[\[\.\.\.(\w+)\]\]|\[\.\.\.(\w+)\]|\[(\w+)\]/g)) {
    if (match[1]) {
      const name = match[1];
      orderedParamNames.push(name);
      isOptionalCatchAll = true;
      isCatchAll = true;
    } else if (match[2]) {
      const name = match[2];
      orderedParamNames.push(name);
      isCatchAll = true;
    } else if (match[3]) {
      orderedParamNames.push(match[3]);
    }
  }

  let regexPattern = pattern;

  regexPattern = regexPattern.replace(/\[\[\.\.\.(\w+)\]\]/g, () => {
    return "___OPTIONAL_CATCHALL___";
  });

  regexPattern = regexPattern.replace(/\[\.\.\.(\w+)\]/g, () => {
    return "___CATCHALL___";
  });

  regexPattern = regexPattern.replace(/\[(\w+)\]/g, () => {
    return "___PARAM___";
  });

  regexPattern = regexPattern.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

  regexPattern = regexPattern
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

export function getSpecificityScore(route: Route): number {
  let score = 0;
  const segments = route.pattern.split("/").filter(Boolean);

  for (const segment of segments) {
    if (segment.includes("[[...")) {
      score += 1;
    } else if (segment.includes("[...")) {
      score += 2;
    } else if (segment.includes("[")) {
      score += 3;
    } else {
      score += 4;
    }
  }

  score += segments.length * 0.1;

  return score;
}
