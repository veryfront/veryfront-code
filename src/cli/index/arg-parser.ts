/**
 * Argument parsing utilities for CLI
 *
 * Cross-platform argument parser that works on Deno, Node.js, and Bun.
 *
 * @module cli/index/arg-parser
 */

import type { ParsedArgs } from "./types.ts";
import { DEFAULT_PORT } from "#veryfront/config/defaults.ts";

/** Flags that should accumulate values instead of replacing */
const ARRAY_FLAGS = new Set(["with"]);

/** Converts a string to number if it matches a numeric pattern */
function maybeNumber(val: unknown): unknown {
  if (typeof val === "string" && /^\d+$/.test(val)) {
    return parseInt(val, 10);
  }
  return val;
}

/** Checks if an argument looks like a value (not a flag) */
function isValue(arg: string | undefined): boolean {
  return arg !== undefined && !arg.startsWith("-");
}

function parse(
  args: string[],
  options: { alias?: Record<string, string>; default?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { _: [] as string[], ...options.default };
  const aliasMap = new Map(Object.entries(options.alias ?? {}));

  function setValue(key: string, value: unknown): void {
    const converted = maybeNumber(value);
    if (ARRAY_FLAGS.has(key)) {
      const arr = (result[key] as unknown[]) ?? [];
      result[key] = [...arr, converted];
    } else {
      result[key] = converted;
    }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    // Long flag: --key=value or --key value
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        setValue(arg.slice(2, eqIdx), arg.slice(eqIdx + 1));
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (isValue(next)) {
          setValue(key, next);
          i++;
        } else {
          setValue(key, true);
        }
      }
      continue;
    }

    // Short flag: -k value
    if (arg.startsWith("-") && arg.length === 2) {
      const short = arg.slice(1);
      const key = aliasMap.get(short) ?? short;
      const next = args[i + 1];
      if (isValue(next)) {
        setValue(key, next);
        i++;
      } else {
        setValue(key, true);
      }
      continue;
    }

    // Positional argument
    (result._ as string[]).push(arg);
  }

  return result;
}

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
 * Supports standard CLI flags per clig.dev guidelines:
 * - -h, --help: Show help
 * - -v, --version: Show version
 * - -q, --quiet: Suppress non-essential output
 * - --verbose: Show detailed output
 * - -f, --force: Skip confirmations for dangerous operations
 * - --no-color: Disable colored output
 * - --color: Force colored output
 *
 * @param args - Raw CLI arguments
 * @returns Parsed arguments object
 */
export function parseCliArgs(args: string[]): ParsedArgs {
  return parse(args, {
    alias: {
      p: "port",
      h: "help",
      v: "version",
      q: "quiet",
      f: "force",
      s: "strict",
      t: "template",
      j: "json",
      w: "with",
    },
    default: { port: DEFAULT_PORT },
  }) as ParsedArgs;
}
