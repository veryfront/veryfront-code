import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";

export const CACHE_POLICY_VALUES = ["no-cache", "cache", "cache-first"] as const;

export const getCachePolicySchema = defineSchema((v) => v.enum(CACHE_POLICY_VALUES));

export const getMcpConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean().optional(),
    cachePolicy: getCachePolicySchema().optional(),
  }).strict()
);

// Backward-compat aliases
export const cachePolicySchema = lazySchema(getCachePolicySchema);
export const McpConfigSchema = lazySchema(getMcpConfigSchema);

/** Cache behavior exposed through the MCP resource contract. */
export type CachePolicy = typeof CACHE_POLICY_VALUES[number];
/** MCP exposure options for a resource. */
export interface McpConfig {
  /** Whether MCP clients can discover the resource. */
  readonly enabled?: boolean;
  /** Client-facing cache behavior. */
  readonly cachePolicy?: CachePolicy;
}
