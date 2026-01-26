/**
 * Resource Factory
 *
 * Create MCP resources with data loading and subscription capabilities.
 *
 * @module veryfront/resource
 */
import { createError, toError } from "../errors/veryfront-error.js";
export function resource(config) {
    const pattern = config.pattern ?? generateResourcePattern();
    const id = patternToId(pattern);
    return {
        id,
        pattern,
        description: config.description,
        paramsSchema: config.paramsSchema,
        load: async (params) => {
            try {
                config.paramsSchema.parse(params);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw toError(createError({
                    type: "agent",
                    message: `Resource "${id}" params validation failed: ${message}`,
                }));
            }
            return await config.load(params);
        },
        subscribe: config.subscribe,
        mcp: config.mcp,
    };
}
/**
 * Generate resource pattern fallback
 * Note: In practice, resources should explicitly define their pattern.
 * Auto-discovery is handled by the discovery module which scans
 * the filesystem and extracts patterns from resource definitions.
 */
function generateResourcePattern() {
    return `/resource_${Date.now()}`;
}
/**
 * Convert path pattern to ID
 * Example: "/users/:userId/profile" -> "users_userId_profile"
 */
function patternToId(pattern) {
    return pattern.replace(/^\//, "").replace(/\//g, "_").replace(/:/g, "");
}
