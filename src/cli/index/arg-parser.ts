/**
 * Argument parsing utilities for CLI
 *
 * Cross-platform argument parser that works on Deno, Node.js, and Bun.
 *
 * @module cli/index/arg-parser
 */

import type { ParsedArgs } from "./types.ts";

function parse(
  args: string[],
  options: {
    alias?: Record<string, string>;
    default?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { _: [] as string[], ...options.default };
  const aliasMap = new Map<string, string>();

  if (options.alias) {
    for (const [short, long] of Object.entries(options.alias)) {
      aliasMap.set(short, long);
    }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        result[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          result[key] = next;
          i++;
        } else {
          result[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const short = arg.slice(1);
      const key = aliasMap.get(short) || short;
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else if (!result._) {
      result._ = [arg];
    } else {
      (result._ as string[]).push(arg);
    }
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
 * @param args - Raw CLI arguments
 * @returns Parsed arguments object
 */
export function parseCliArgs(args: string[]): ParsedArgs {
  return parse(args, {
    alias: { p: "port", h: "help", v: "version" },
    default: { port: 3002 },
  }) as ParsedArgs;
}
