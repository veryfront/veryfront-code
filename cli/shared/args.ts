/**
 * Unified CLI argument parsing utilities
 *
 * Provides a single, consistent way to extract and validate CLI arguments.
 *
 * @module cli/shared/args
 */

import type { Schema } from "veryfront/extensions/schema";
import type { ParsedArgs } from "./types.ts";

/** Compat type for safeParse result (SafeParseReturnType removed in zod v4). */
export type SafeParseResult<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: Error & { issues: unknown[] } };

/**
 * Argument specification for a single option
 */
export interface ArgSpec {
  /** Possible argument keys to check (e.g., ["project-slug", "p"]) */
  keys: string[];
  /** Type of the argument: "array" handles CSV strings and repeated flags */
  type: "string" | "boolean" | "number" | "array";
  /** Positional argument index (0 = first arg after command) */
  positional?: number;
}

/**
 * Map of schema field names to their arg specs
 */
export type ArgMap<T> = {
  [K in keyof T]?: ArgSpec;
};

function coerceValue(
  value: unknown,
  type: ArgSpec["type"],
): string | boolean | number | string[] {
  if (type === "boolean") return Boolean(value);
  if (type === "number") {
    return typeof value === "number" ? value : parseInt(String(value), 10);
  }
  if (type === "array") {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
    if (value) return [String(value)];
    return [];
  }
  return String(value);
}

/**
 * Extract a single argument value from parsed args
 */
export function extractArg(
  args: ParsedArgs,
  spec: ArgSpec,
): string | boolean | number | string[] | undefined {
  const { keys, type, positional } = spec;

  for (const key of keys) {
    const value = args[key];
    if (value !== undefined) return coerceValue(value, type);
  }

  if (positional === undefined) return undefined;

  const value = args._[positional + 1]; // +1 because _[0] is the command name
  if (value === undefined) return undefined;

  return coerceValue(value, type);
}

/**
 * Extract all arguments according to an arg map
 */
export function extractArgs<T>(
  args: ParsedArgs,
  argMap: ArgMap<T>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(argMap)) {
    if (!spec) continue;

    const value = extractArg(args, spec as ArgSpec);
    if (value !== undefined) result[field] = value;
  }

  return result;
}

/**
 * Create a typed argument parser for a command
 *
 * @example
 * ```ts
 * const getPullArgsSchema = defineSchema((v) => v.object({
 *   projectSlug: v.string().optional(),
 *   projectDir: v.string().optional(),
 *   force: v.boolean().default(false),
 * }));
 * const PullArgsSchema = getPullArgsSchema();
 *
 * const parsePullArgs = createArgParser(PullArgsSchema, {
 *   projectSlug: { keys: ["project-slug", "p"], type: "string", positional: 0 },
 *   projectDir: { keys: ["project-dir", "dir", "d"], type: "string" },
 *   force: { keys: ["force", "f"], type: "boolean" },
 * });
 *
 * const result = parsePullArgs(args);
 * if (result.success) {
 *   // result.data is typed as PullOptions
 * }
 * ```
 */
export function createArgParser<T>(
  schema: Schema<T>,
  argMap: ArgMap<T>,
): (args: ParsedArgs) => SafeParseResult<T> {
  return function parseArgs(args: ParsedArgs): SafeParseResult<T> {
    const result = schema.safeParse(extractArgs(args, argMap));
    if (result.success) {
      return { success: true, data: result.data };
    }
    const message = result.issues?.map((i) => i.message).join("; ") ?? "Validation failed";
    const error = Object.assign(new Error(message), { issues: result.issues ?? [] });
    return { success: false, error };
  };
}

/**
 * Parse args with a parser function and throw on failure.
 * Eliminates the repeated parse-validate-throw boilerplate in handlers.
 */
export function parseArgsOrThrow<T>(
  parser: (args: ParsedArgs) => SafeParseResult<T>,
  commandName: string,
  args: ParsedArgs,
): T {
  const result = parser(args);
  if (!result.success) {
    throw new Error(
      `Invalid ${commandName} arguments: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * Common arg specs for reuse across commands
 */
export const CommonArgs = {
  force: { keys: ["force", "f"], type: "boolean" },
  dryRun: { keys: ["dry-run"], type: "boolean" },
  branch: { keys: ["branch", "b"], type: "string" },
  env: { keys: ["env"], type: "string" },
  projectDir: { keys: ["project-dir", "dir", "d"], type: "string" },
  projectSlug: { keys: ["project-slug", "project", "p"], type: "string" },
  quiet: { keys: ["quiet", "q"], type: "boolean" },
  releaseName: { keys: ["release-name"], type: "string" },
  into: { keys: ["into"], type: "string" },
  release: { keys: ["release"], type: "string" },
  output: { keys: ["output", "o"], type: "string" },
  json: { keys: ["json", "j"], type: "boolean" },
} satisfies Record<string, ArgSpec>;

// ── Raw CLI argument parsing ────────────────────────────────────────────
// Low-level parser that converts process argv into a ParsedArgs object.
// Used once in cli/main.ts before routing to individual command handlers.

const ARRAY_FLAGS = new Set(["with", "candidate-model"]);

function maybeNumber(val: unknown): unknown {
  if (typeof val === "string" && /^\d+$/.test(val)) return parseInt(val, 10);
  return val;
}

function isValue(arg: string | undefined): boolean {
  return arg !== undefined && !arg.startsWith("-");
}

function parse(
  args: string[],
  options: { alias?: Record<string, string>; default?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { _: [] as string[], ...options.default };
  const aliasMap = new Map(Object.entries(options.alias ?? {}));
  const explicit: Record<string, true> = {};

  function setValue(key: string, value: unknown): void {
    explicit[key] = true;
    const converted = maybeNumber(value);

    if (!ARRAY_FLAGS.has(key)) {
      result[key] = converted;
      return;
    }

    const arr = (result[key] as unknown[] | undefined) ?? [];
    result[key] = [...arr, converted];
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");

      if (eqIdx !== -1) {
        setValue(arg.slice(2, eqIdx), arg.slice(eqIdx + 1));
        continue;
      }

      const key = arg.slice(2);
      const next = args[i + 1];

      if (isValue(next)) {
        setValue(key, next);
        i++;
        continue;
      }

      setValue(key, true);
      continue;
    }

    if (arg.startsWith("-") && arg.length === 2) {
      const short = arg.slice(1);
      const key = aliasMap.get(short) ?? short;
      const next = args[i + 1];

      if (isValue(next)) {
        setValue(key, next);
        if (key !== short) setValue(short, next);
        i++;
        continue;
      }

      setValue(key, true);
      if (key !== short) setValue(short, true);
      continue;
    }

    (result._ as string[]).push(arg);
  }

  result.__explicit = explicit;
  return result;
}

/** Parse raw CLI arguments into a structured `ParsedArgs` object with aliases. */
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
      y: "yes",
      w: "with",
      m: "mode",
    },
  }) as ParsedArgs;
}
