/**
 * Argument parsing utilities for CLI
 *
 * @module cli/index/arg-parser
 */

import { parse } from "std/flags/mod.ts";
import type { ParsedArgs } from "./types.ts";

/**
 * Parse an argument that may be a string or array of strings
 *
 * @param arg - The argument to parse
 * @returns Array of strings or undefined
 */
export function parseArrayArg(arg: unknown): string[] | undefined {
  if (Array.isArray(arg)) return arg as string[];
  if (arg) return [String(arg)];
  return undefined;
}

/**
 * Parse CLI arguments with default configuration
 *
 * @param args - Raw CLI arguments
 * @returns Parsed arguments object
 */
export function parseCliArgs(args: string[]): ParsedArgs {
  return parse(args, {
    alias: { p: "port", h: "help", v: "version" },
    default: { port: 3002 },
  });
}
