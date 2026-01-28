/**
 * Unified import rewriting types.
 *
 * This module defines the strategy pattern interface for import rewriting.
 * All import transformations go through this unified system.
 */

import type { ImportSpecifier } from "../esm/lexer.ts";

/**
 * Transform target environment.
 */
export type RewriteTarget = "ssr" | "browser";

/**
 * Context passed to import rewrite strategies.
 */
export interface RewriteContext {
  /** File path being transformed */
  filePath: string;
  /** Project root directory */
  projectDir: string;
  /** Project identifier for caching and logging */
  projectId: string;
  /** Target environment: SSR or browser */
  target: RewriteTarget;
  /** Development mode */
  dev: boolean;
  /** Module server URL for browser imports */
  moduleServerUrl?: string;
  /** Vendor bundle hash for cache busting */
  vendorBundleHash?: string;
  /** API base URL for cross-project imports */
  apiBaseUrl?: string;
  /** React version to use for esm.sh URLs */
  reactVersion: string;
  /** Import map configuration (loaded lazily) */
  importMap?: ImportMapConfig;
}

/**
 * Import map configuration following WHATWG spec.
 */
export interface ImportMapConfig {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

/**
 * Information about an import specifier being rewritten.
 */
export interface ImportSpecifierInfo {
  /** The raw specifier string (e.g., "react", "./foo.ts", "@/components/Button") */
  specifier: string;
  /** Whether this is a dynamic import */
  isDynamic: boolean;
  /** Start position of the specifier in source */
  start: number;
  /** End position of the specifier in source */
  end: number;
  /** Full import statement start */
  statementStart: number;
  /** Full import statement end */
  statementEnd: number;
  /** Raw import specifier from lexer */
  raw: ImportSpecifier;
}

/**
 * Result of a rewrite operation.
 */
export interface RewriteResult {
  /** New specifier to replace the original (null = no change) */
  specifier: string | null;
  /** Optional: replace entire statement (for complex transforms like vendor splitting) */
  statement?: string;
}

/**
 * Import rewrite strategy interface.
 *
 * Each strategy handles a specific type of import transformation.
 * Strategies are executed in priority order (lower = earlier).
 */
export interface ImportRewriteStrategy {
  /** Strategy name for logging/debugging */
  readonly name: string;
  /** Execution priority (0 = first, higher = later) */
  readonly priority: number;

  /**
   * Check if this strategy should handle the specifier.
   * @param specifier - The import specifier
   * @param ctx - Rewrite context
   * @returns true if this strategy handles this specifier
   */
  matches(specifier: string, ctx: RewriteContext): boolean;

  /**
   * Rewrite the import specifier.
   * Only called if matches() returns true.
   * @param info - Import specifier info
   * @param ctx - Rewrite context
   * @returns Rewrite result
   */
  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
}

/**
 * Specifier classification for strategy matching.
 */
export type SpecifierType =
  | "react" // react, react-dom, react/*
  | "alias" // @/components/Button
  | "veryfront" // #veryfront/*, veryfront/*, @veryfront/*
  | "bare" // lodash, @tanstack/react-query
  | "relative" // ./foo, ../bar
  | "cross-project" // myproject@1.0.0/@/components
  | "url" // https://esm.sh/..., http://...
  | "unknown";

/**
 * Classify a specifier for strategy matching.
 */
export function classifySpecifier(specifier: string): SpecifierType {
  // React and React-DOM packages
  if (
    specifier === "react" ||
    specifier === "react-dom" ||
    specifier.startsWith("react/") ||
    specifier.startsWith("react-dom/")
  ) {
    return "react";
  }

  // URL imports (esm.sh, CDN, etc.)
  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    return "url";
  }

  // Veryfront framework imports
  if (
    specifier.startsWith("#veryfront/") ||
    specifier.startsWith("veryfront/") ||
    specifier.startsWith("@veryfront/") ||
    specifier === "veryfront" ||
    specifier === "@veryfront"
  ) {
    return "veryfront";
  }

  // Path alias imports
  if (specifier.startsWith("@/")) {
    return "alias";
  }

  // Relative imports
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return "relative";
  }

  // Cross-project imports (project@version/@/path or project/@/path)
  if (/^[a-z0-9-]+(?:@[\d^~x][\d.x^~-]*)?\/@\//.test(specifier)) {
    return "cross-project";
  }

  // Bare specifiers (npm packages)
  return "bare";
}

/**
 * Check if specifier is a React package.
 */
export function isReactSpecifier(specifier: string): boolean {
  return classifySpecifier(specifier) === "react";
}

/**
 * Check if specifier is a relative import.
 */
export function isRelativeSpecifier(specifier: string): boolean {
  return classifySpecifier(specifier) === "relative";
}

/**
 * Check if specifier is a bare npm package.
 */
export function isBareSpecifier(specifier: string): boolean {
  return classifySpecifier(specifier) === "bare";
}

/**
 * Check if specifier is a URL.
 */
export function isUrlSpecifier(specifier: string): boolean {
  return classifySpecifier(specifier) === "url";
}
