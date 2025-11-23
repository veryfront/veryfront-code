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
 */
export interface ParsedArgs {
  _: (string | number)[];
  port?: number;
  p?: number;
  help?: boolean;
  h?: boolean;
  version?: boolean;
  v?: boolean;
  [key: string]: unknown;
}
