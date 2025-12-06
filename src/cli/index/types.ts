/**
 * Type definitions for CLI module
 *
 * @module cli/index/types
 */

/**
 * Interface for build command arguments
 */
export interface BuildCommandArgs {
  _: (string | number)[];
  output?: string;
  o?: string;
  preset?: string;
  split?: boolean;
  compress?: boolean;
  prefetch?: boolean;
  ssg?: boolean;
  "no-ssg"?: boolean;
  include?: string | string[];
  exclude?: string | string[];
  "dry-run"?: boolean;
  dryrun?: boolean;
}

/**
 * Interface for generate command arguments
 */
export interface GenerateCommandArgs {
  _: (string | number)[];
}

/**
 * Parsed CLI arguments structure
 *
 * Supports standard CLI flags per clig.dev guidelines
 */
export interface ParsedArgs {
  _: (string | number)[];
  // Server options
  port?: number;
  p?: number;
  // Help & version
  help?: boolean;
  h?: boolean;
  version?: boolean;
  v?: boolean;
  // Output control (clig.dev compliance)
  quiet?: boolean;
  q?: boolean;
  verbose?: boolean;
  // Color control (clig.dev compliance)
  color?: boolean;
  "no-color"?: boolean;
  // Force mode (skip confirmations)
  force?: boolean;
  f?: boolean;
  // Common aliases
  strict?: boolean;
  s?: boolean;
  template?: string;
  t?: string;
  json?: boolean;
  j?: boolean;
  // Allow additional flags
  [key: string]: unknown;
}
