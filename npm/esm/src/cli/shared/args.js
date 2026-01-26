/**
 * Unified CLI argument parsing utilities
 *
 * Provides a single, consistent way to extract and validate CLI arguments.
 *
 * @module cli/shared/args
 */
function coerceValue(value, type) {
    switch (type) {
        case "boolean":
            return Boolean(value);
        case "number":
            return typeof value === "number" ? value : parseInt(String(value), 10);
        case "string":
            return String(value);
    }
}
/**
 * Extract a single argument value from parsed args
 */
export function extractArg(args, spec) {
    const { keys, type, positional } = spec;
    for (const key of keys) {
        const value = args[key];
        if (value !== undefined)
            return coerceValue(value, type);
    }
    if (positional === undefined)
        return undefined;
    const value = args._[positional + 1]; // +1 because _[0] is the command name
    if (value === undefined)
        return undefined;
    return coerceValue(value, type);
}
/**
 * Extract all arguments according to an arg map
 */
export function extractArgs(args, argMap) {
    const result = {};
    for (const [field, spec] of Object.entries(argMap)) {
        if (!spec)
            continue;
        const value = extractArg(args, spec);
        if (value !== undefined)
            result[field] = value;
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
export function createArgParser(schema, argMap) {
    return function parseArgs(args) {
        return schema.safeParse(extractArgs(args, argMap));
    };
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
};
