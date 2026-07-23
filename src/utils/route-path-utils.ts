/**************************
 * Route Path Utilities
 *
 * Consolidated utilities for route path handling, dynamic segment detection,
 * and route parameter extraction. Used across page rendering, routing, and build.
 **************************/

import { MAX_PATH_LENGTH } from "./constants/security.ts";

/** Supported page file extensions */
export const PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"] as const;

/** Supported component file extensions (subset of page extensions) */
export const COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const;

/** Regex for matching and removing file extensions */
const EXTENSION_REGEX = /\.(tsx|jsx|ts|js|mdx|md)$/;

const INTERCEPTION_ROUTE_PATTERN = /^(?:\(\.\)|\(\.\.\)|\(\.\.\.\)|(?:\(\.\.\)){2,})/;

export type RouteParameterKind = "dynamic" | "catch-all" | "optional-catch-all";

export interface RoutePatternParameter {
  name: string;
  kind: RouteParameterKind;
}

export interface ParsedRouteParameter extends RoutePatternParameter {
  /** A literal file suffix, for example `.tsx` in `[id].tsx`. */
  suffix: string;
}

export interface CompiledRoutePattern {
  regex: RegExp;
  parameters: RoutePatternParameter[];
  segmentKinds: Array<"static" | RouteParameterKind>;
  valid: boolean;
}

export type RouteSpecificityValue = 1 | 2 | 3 | 4;

/** Match-specific route precedence, ordered from the first URL segment onward. */
export interface RouteSpecificity {
  segments: RouteSpecificityValue[];
  emptyOptionalCatchAllCount: number;
}

export interface RoutePatternMatch {
  params: Record<string, string | string[]>;
  specificity: RouteSpecificity;
}

const ROUTE_SEGMENT_SPECIFICITY = {
  static: 4,
  dynamic: 3,
  "catch-all": 2,
  "optional-catch-all": 1,
} as const satisfies Record<"static" | RouteParameterKind, RouteSpecificityValue>;

/** Reject controls that must never reach path or regular-expression handling. */
export function containsPathControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function isValidParameterName(name: string): boolean {
  return name.trim().length > 0 &&
    !/[\/\\[\]]/.test(name) &&
    !containsPathControlCharacters(name);
}

/** Parse a complete dynamic route segment using the public route grammar. */
export function parseRouteParameterSegment(segment: string): ParsedRouteParameter | null {
  if (!segment.startsWith("[") || containsPathControlCharacters(segment)) return null;

  let marker: string;
  let kind: RouteParameterKind;
  let closing: string;

  if (segment.startsWith("[[...")) {
    marker = "[[...";
    kind = "optional-catch-all";
    closing = "]]";
  } else if (segment.startsWith("[...")) {
    marker = "[...";
    kind = "catch-all";
    closing = "]";
  } else {
    marker = "[";
    kind = "dynamic";
    closing = "]";
  }

  const closingIndex = segment.indexOf(closing, marker.length);
  if (closingIndex === -1) return null;

  const name = segment.slice(marker.length, closingIndex);
  const suffix = segment.slice(closingIndex + closing.length);
  if (!isValidParameterName(name)) return null;
  if (suffix && (!suffix.startsWith(".") || /[\/\\[\]]/.test(suffix))) return null;

  return { name, kind, suffix };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function neverMatchingPattern(): CompiledRoutePattern {
  return { regex: /a^/, parameters: [], segmentKinds: [], valid: false };
}

function defineRouteParam(
  params: Record<string, string | string[]>,
  name: string,
  value: string | string[],
): void {
  Object.defineProperty(params, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * Compare two successful route matches lexicographically. Earlier URL
 * segments decide precedence; an exact terminal route wins over an otherwise
 * equal route containing an empty optional catch-all.
 */
export function compareRouteSpecificity(
  left: RouteSpecificity,
  right: RouteSpecificity,
): number {
  const commonLength = Math.min(left.segments.length, right.segments.length);
  for (let index = 0; index < commonLength; index++) {
    const difference = left.segments[index]! - right.segments[index]!;
    if (difference !== 0) return difference;
  }

  const lengthDifference = left.segments.length - right.segments.length;
  if (lengthDifference !== 0) return lengthDifference;

  return right.emptyOptionalCatchAllCount - left.emptyOptionalCatchAllCount;
}

/** Build a precision-safe structural rank for sorting route definitions. */
export function getRouteDefinitionSpecificity(pattern: string): RouteSpecificity | null {
  const compiled = compileRoutePattern(pattern);
  if (!compiled.valid) return null;

  return {
    segments: compiled.segmentKinds
      .filter((kind) => kind !== "optional-catch-all")
      .map((kind) => ROUTE_SEGMENT_SPECIFICITY[kind]),
    emptyOptionalCatchAllCount: compiled.segmentKinds.filter(
      (kind) => kind === "optional-catch-all",
    ).length,
  };
}

/** Build parameters and precedence from a match produced by the compiled pattern. */
export function extractRoutePatternMatch(
  compiled: CompiledRoutePattern,
  match: RegExpMatchArray,
): RoutePatternMatch {
  const params: Record<string, string | string[]> = {};
  const specificity: RouteSpecificity = {
    segments: [],
    emptyOptionalCatchAllCount: 0,
  };
  let parameterIndex = 0;

  for (const kind of compiled.segmentKinds) {
    if (kind === "static") {
      specificity.segments.push(ROUTE_SEGMENT_SPECIFICITY.static);
      continue;
    }

    const parameter = compiled.parameters[parameterIndex]!;
    const value = match[parameterIndex + 1] ?? "";
    parameterIndex++;

    if (kind === "dynamic") {
      defineRouteParam(params, parameter.name, value);
      specificity.segments.push(ROUTE_SEGMENT_SPECIFICITY.dynamic);
      continue;
    }

    const values = value.split("/").filter(Boolean);
    defineRouteParam(params, parameter.name, values);
    if (kind === "optional-catch-all" && values.length === 0) {
      specificity.emptyOptionalCatchAllCount++;
    }
    for (let index = 0; index < values.length; index++) {
      specificity.segments.push(ROUTE_SEGMENT_SPECIFICITY[kind]);
    }
  }

  return { params, specificity };
}

/**
 * Compile a route pattern once. A single catch-all is supported; accepting two
 * would make both parameter assignment and backtracking inherently ambiguous.
 */
export function compileRoutePattern(pattern: string): CompiledRoutePattern {
  if (pattern.length > MAX_PATH_LENGTH || containsPathControlCharacters(pattern)) {
    return neverMatchingPattern();
  }

  const hasLeadingSlash = pattern.startsWith("/");
  const segments = pattern.split("/").filter(Boolean);
  const parameters: RoutePatternParameter[] = [];
  const segmentKinds: Array<"static" | RouteParameterKind> = [];
  let catchAllCount = 0;
  let source = "";
  let suppressNextSeparator = false;

  for (const [index, segment] of segments.entries()) {
    const parameter = parseRouteParameterSegment(segment);
    const separator = suppressNextSeparator ? "" : index === 0 ? (hasLeadingSlash ? "/" : "") : "/";
    suppressNextSeparator = false;

    if (!parameter) {
      source += `${separator}${escapeRegex(segment)}`;
      segmentKinds.push("static");
      continue;
    }

    if (parameter.kind !== "dynamic" && ++catchAllCount > 1) {
      return neverMatchingPattern();
    }

    parameters.push({ name: parameter.name, kind: parameter.kind });
    segmentKinds.push(parameter.kind);
    const suffix = escapeRegex(parameter.suffix);

    if (parameter.kind === "dynamic") {
      source += `${separator}([^/]+)${suffix}`;
    } else if (parameter.kind === "catch-all") {
      source += `${separator}(.+)${suffix}`;
    } else if (index === 0 && !hasLeadingSlash && segments.length > 1) {
      source += `(?:(.*)${suffix}/)?`;
      suppressNextSeparator = true;
    } else {
      source += `(?:${separator}(.*)${suffix})?`;
    }
  }

  if (segments.length === 0 && hasLeadingSlash) source = "/";

  return {
    regex: new RegExp(`^${source}/?$`),
    parameters,
    segmentKinds,
    valid: true,
  };
}

/** Match a route without changing its leading-slash semantics. */
export function matchRoutePattern(pattern: string, path: string): RoutePatternMatch | null {
  if (pattern.length > MAX_PATH_LENGTH || path.length > MAX_PATH_LENGTH) return null;

  const compiled = compileRoutePattern(pattern);
  if (!compiled.valid) return null;

  const match = path.match(compiled.regex);
  return match ? extractRoutePatternMatch(compiled, match) : null;
}

/**
 * Check if a segment name is a dynamic route segment.
 * Handles both directory names like "[id]" and file names like "[id].tsx"
 */
export function isDynamicSegment(name: string): boolean {
  return parseRouteParameterSegment(name) !== null;
}

/**
 * Check if a route pattern contains any dynamic segments
 */
export function isDynamicRoute(pattern: string): boolean {
  if (pattern.length > MAX_PATH_LENGTH) return false;
  return pattern.split("/").filter(Boolean).some(isDynamicSegment);
}

/**
 * Check if a segment is a catch-all segment ([...slug] or [[...slug]])
 */
export function isCatchAllSegment(name: string): boolean {
  const parameter = parseRouteParameterSegment(name);
  return parameter?.kind === "catch-all" || parameter?.kind === "optional-catch-all";
}

/** Check if a segment is an App Router route group such as `(marketing)`. */
export function isRouteGroupSegment(name: string): boolean {
  return name.length > 2 &&
    name.startsWith("(") &&
    name.endsWith(")") &&
    !/[\/\\]/.test(name) &&
    !containsPathControlCharacters(name) &&
    !isInterceptionRouteSegment(name);
}

/** Detect App Router interception markers such as `(.)photo` and `(..)photo`. */
export function isInterceptionRouteSegment(name: string): boolean {
  return INTERCEPTION_ROUTE_PATTERN.test(name);
}

/**
 * Remove file extension from a path
 */
export function removeFileExtension(path: string): string {
  return path.replace(EXTENSION_REGEX, "");
}

/**
 * Extract parameter name from a dynamic segment.
 * "[id]" -> "id"
 * "[...slug]" -> "slug"
 * "[[...params]]" -> "params"
 */
export function extractParamName(segment: string): string {
  return parseRouteParameterSegment(segment)?.name ?? segment;
}

/**
 * Router type detection result
 */
interface RouterBasePath {
  type: "app" | "pages" | null;
  relativePath: string | null;
}

export interface RouterDirectories {
  app?: string;
  pages?: string;
}

function extractPathsBelowRoot(pageEntityId: string, root: string): string[] {
  const pathSegments = pageEntityId.replaceAll("\\", "/").split("/").filter(Boolean);
  const rootSegments = root.replaceAll("\\", "/").split("/").filter(Boolean);
  if (rootSegments.length === 0 || rootSegments.length >= pathSegments.length) return [];

  const relativePaths: string[] = [];
  for (let index = 0; index <= pathSegments.length - rootSegments.length; index++) {
    const isRoot = rootSegments.every((segment, offset) =>
      pathSegments[index + offset] === segment
    );
    if (!isRoot) continue;

    const relative = pathSegments.slice(index + rootSegments.length).join("/");
    if (relative) relativePaths.push(relative);
  }

  return relativePaths;
}

function extractPathBelowRoot(pageEntityId: string, root: string): string | null {
  return extractPathsBelowRoot(pageEntityId, root).at(-1) ?? null;
}

/**
 * Extract the router base path from a page entity ID.
 * Detects whether it's an App Router (/app/) or Pages Router (/pages/) path.
 */
export function extractRouterBasePath(
  pageEntityId: string,
  directories: RouterDirectories = {},
): RouterBasePath {
  const appRelativePath = extractPathBelowRoot(pageEntityId, directories.app ?? "app");
  if (appRelativePath !== null) {
    return { type: "app", relativePath: appRelativePath };
  }

  const pagesRelativePath = extractPathBelowRoot(pageEntityId, directories.pages ?? "pages");
  if (pagesRelativePath !== null) {
    return { type: "pages", relativePath: pagesRelativePath };
  }

  return { type: null, relativePath: null };
}

/**
 * Result of route parameter extraction
 */
interface ExtractedRouteParams {
  params: Record<string, string | string[]>;
  matched: boolean;
}

/**
 * Extract route parameters from a page entity ID and URL slug.
 * Handles both App Router and Pages Router patterns.
 *
 * @param pageEntityId - The page entity ID (file path)
 * @param slug - The URL slug to match against
 * @returns Extracted parameters and whether matching succeeded
 */
export function extractRouteParams(
  pageEntityId: string,
  slug: string,
  directories: RouterDirectories = {},
): ExtractedRouteParams {
  const candidates: Array<{ relativePath: string; type: "app" | "pages" }> = [
    ...extractPathsBelowRoot(pageEntityId, directories.app ?? "app").map((relativePath) => ({
      relativePath,
      type: "app" as const,
    })),
    ...extractPathsBelowRoot(pageEntityId, directories.pages ?? "pages").map((relativePath) => ({
      relativePath,
      type: "pages" as const,
    })),
  ];

  let bestMatch: {
    params: Record<string, string | string[]>;
    segmentCount: number;
  } | null = null;

  for (const { relativePath, type } of candidates) {
    const match = extractRouteParamsFromRelativePath(relativePath, type, slug);
    if (match && (!bestMatch || match.segmentCount > bestMatch.segmentCount)) {
      bestMatch = match;
    }
  }

  if (!bestMatch || Object.keys(bestMatch.params).length === 0) {
    return { params: {}, matched: false };
  }
  return { params: bestMatch.params, matched: true };
}

function extractRouteParamsFromRelativePath(
  relativePath: string,
  type: "app" | "pages",
  slug: string,
): { params: Record<string, string | string[]>; segmentCount: number } | null {
  const pathSegments = relativePath.split("/").filter(Boolean);
  const terminalSegment = pathSegments.at(-1);
  if (!terminalSegment) return null;

  const isRouterConventionFile = PAGE_EXTENSIONS.some((extension) =>
    type === "app"
      ? terminalSegment === `page${extension}` || terminalSegment === `route${extension}`
      : type === "pages" && terminalSegment === `index${extension}`
  );
  if (isRouterConventionFile) {
    pathSegments.pop();
  } else {
    pathSegments[pathSegments.length - 1] = removeFileExtension(terminalSegment);
  }

  const routePatternSegments = type === "app"
    ? pathSegments.filter((segment) => !isRouteGroupSegment(segment))
    : pathSegments;
  const params = extractParamsFromPattern(routePatternSegments.join("/"), slug);
  return params ? { params, segmentCount: routePatternSegments.length } : null;
}

/**
 * Extract relative path from an absolute path by removing the project directory prefix.
 *
 * @param absolutePath - The absolute file path
 * @param projectDir - The project root directory
 * @returns The relative path within the project
 */
export function extractRelativePath(absolutePath: string, projectDir: string): string {
  const normalizedAbsolute = absolutePath.replaceAll("\\", "/");
  const normalizedProject = projectDir.replaceAll("\\", "/").replace(/\/+$/, "");
  const isProjectPath = normalizedAbsolute === normalizedProject ||
    normalizedAbsolute.startsWith(`${normalizedProject}/`);
  const path = isProjectPath
    ? normalizedAbsolute.slice(normalizedProject.length)
    : normalizedAbsolute;

  return path.replace(/^\//, "");
}

/**
 * Extract route params using pattern matching (for slug-mapper).
 * This is a more flexible version that works with route patterns directly.
 *
 * @param pattern - The route pattern (e.g., "[id]/posts/[...slug]")
 * @param slug - The URL slug to match
 * @returns Extracted params or null if no match
 */
export function extractParamsFromPattern(
  pattern: string,
  slug: string,
): Record<string, string | string[]> | null {
  if (pattern.length > MAX_PATH_LENGTH || slug.length > MAX_PATH_LENGTH) return null;

  const normalizedPattern = pattern.split("/").filter(Boolean).join("/");
  const normalizedSlug = slug.split("/").filter(Boolean).join("/");
  return matchRoutePattern(normalizedPattern, normalizedSlug)?.params ?? null;
}

/**
 * Check if a pattern matches a slug
 */
export function matchesPattern(pattern: string, slug: string): boolean {
  return extractParamsFromPattern(pattern, slug) !== null;
}
