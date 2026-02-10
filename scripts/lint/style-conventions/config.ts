import type { ParserPlugin } from "@babel/parser";
import type { RuleId } from "./types.ts";

export interface IdentifierCasingReplacement {
  from: string;
  to: string;
}

/**
 * Style conventions currently align with a subset of:
 * https://google.github.io/styleguide/tsguide.html
 */
export const STYLE_GUIDE_REFERENCE =
  "https://google.github.io/styleguide/tsguide.html";

export const RULE_IDS: RuleId[] = [
  "no-default-export",
  "no-explicit-public",
  "identifier-casing",
];

/**
 * Explicit identifier casing replacements derived from style conventions.
 * Add focused replacements here as the project adopts them.
 */
export const IDENTIFIER_CASING_REPLACEMENTS: IdentifierCasingReplacement[] = [
  { from: "APIClient", to: "ApiClient" },
];

export const ROOTS = ["src", "cli"];
export const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx"]);

export const SKIP_PATH_PATTERNS = [
  /(^|\/)\.cache\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)node_modules\//,
  /(^|\/)__fixtures__\//,
  /(^|\/)cli\/templates\//,
  /(^|\/)cli\/mcp\/skills\//,
];

export const BASE_TS_PLUGINS: ParserPlugin[] = [
  "typescript",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "decorators-legacy",
  "dynamicImport",
  "importAttributes",
  "topLevelAwait",
];

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function shouldSkipPath(path: string): boolean {
  const normalized = normalizePath(path);
  return SKIP_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot);
}
