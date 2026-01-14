/**
 * Unified CLI argument parsing utilities
 *
 * Provides a single, consistent way to extract and validate CLI arguments.
 *
 * @module cli/shared/args
 */

import { z } from "zod";
import type { ParsedArgs } from "../index/types.ts";

/**
 * Argument specification for a single option
 */
export interface ArgSpec {
  /** Possible argument keys to check (e.g., ["project-slug", "p"]) */
  keys: string[];
  /** Type of the argument */
  type: "string" | "boolean" | "number";
  /** Positional argument index (0 = first arg after command) */
  positional?: number;
}

/**
 * Map of schema field names to their arg specs
 */
export type ArgMap<T> = {
  [K in keyof T]?: ArgSpec;
};

/**
 * Extract a single argument value from parsed args
 */
export function extractArg(
  args: ParsedArgs,
  spec: ArgSpec,
): string | boolean | number | undefined {
  const { keys, type, positional } = spec;

  // Check named args first
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined) {
      switch (type) {
        case "boolean":
          return Boolean(value);
        case "number":
          return typeof value === "number" ? value : parseInt(String(value), 10);
        case "string":
          return String(value);
      }
    }
  }

  // Check positional arg
  if (positional !== undefined && args._.length > positional + 1) {
    const value = args._[positional + 1]; // +1 because _[0] is the command name
    switch (type) {
      case "boolean":
        return Boolean(value);
      case "number":
        return parseInt(String(value), 10);
      case "string":
        return String(value);
    }
  }

  return undefined;
}

/**
 * Extract all arguments according to an arg map
 */
export function extractArgs<T extends z.ZodRawShape>(
  args: ParsedArgs,
  argMap: ArgMap<z.infer<z.ZodObject<T>>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(argMap)) {
    if (spec) {
      const value = extractArg(args, spec);
      if (value !== undefined) {
        result[field] = value;
      }
    }
  }

  return result;
}

/**
 * Create a typed argument parser for a command
 *
 * @example
 * ```ts
 * const PullArgsSchema = z.object({
 *   projectSlug: z.string().optional(),
 *   projectDir: z.string().optional(),
 *   force: z.boolean().default(false),
 * });
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
export function createArgParser<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  argMap: ArgMap<z.infer<z.ZodObject<T>>>,
): (args: ParsedArgs) => z.SafeParseReturnType<unknown, z.infer<z.ZodObject<T>>> {
  return (args: ParsedArgs) => {
    const rawArgs = extractArgs(args, argMap);
    return schema.safeParse(rawArgs);
  };
}

/**
 * Common arg specs for reuse across commands
 */
export const CommonArgs = {
  force: { keys: ["force", "f"], type: "boolean" } as const,
  dryRun: { keys: ["dry-run"], type: "boolean" } as const,
  branch: { keys: ["branch", "b"], type: "string" } as const,
  env: { keys: ["env"], type: "string" } as const,
  projectDir: { keys: ["project-dir", "dir", "d"], type: "string" } as const,
  projectSlug: { keys: ["project-slug", "project", "p"], type: "string" } as const,
} satisfies Record<string, ArgSpec>;
