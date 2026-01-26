/**
 * Unified CLI argument parsing utilities
 *
 * Provides a single, consistent way to extract and validate CLI arguments.
 *
 * @module cli/shared/args
 */
import { z } from "zod";
import type { ParsedArgs } from "../index/types.js";
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
export declare function extractArg(args: ParsedArgs, spec: ArgSpec): string | boolean | number | undefined;
/**
 * Extract all arguments according to an arg map
 */
export declare function extractArgs<T extends z.ZodRawShape>(args: ParsedArgs, argMap: ArgMap<z.infer<z.ZodObject<T>>>): Record<string, unknown>;
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
export declare function createArgParser<T extends z.ZodRawShape>(schema: z.ZodObject<T>, argMap: ArgMap<z.infer<z.ZodObject<T>>>): (args: ParsedArgs) => z.SafeParseReturnType<unknown, z.infer<z.ZodObject<T>>>;
/**
 * Common arg specs for reuse across commands
 */
export declare const CommonArgs: {
    force: {
        keys: string[];
        type: "boolean";
    };
    dryRun: {
        keys: string[];
        type: "boolean";
    };
    branch: {
        keys: string[];
        type: "string";
    };
    env: {
        keys: string[];
        type: "string";
    };
    projectDir: {
        keys: string[];
        type: "string";
    };
    projectSlug: {
        keys: string[];
        type: "string";
    };
};
//# sourceMappingURL=args.d.ts.map