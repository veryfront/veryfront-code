import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/**
 * MCP auth configuration. One of:
 * - `{ type: "bearer", validate?: (token) => Promise<boolean> }` — bearer-token auth.
 * - `{ type: "none", allowUnauthenticated: true }` — explicit opt-in to an
 *   unauthenticated server. Required for local dev/testing; prevents accidental
 *   exposure of the JSON-RPC surface in production (VULN-SRV-5).
 */
export type MCPBearerTokenValidator = (
  token: string,
) => boolean | Promise<boolean>;

const getAuthValidatedSchema = defineSchema((v) =>
  v.object({
    type: v.literal("bearer"),
    validate: v
      .custom<MCPBearerTokenValidator>(
        (value) => typeof value === "function",
        "Expected a bearer token validator function",
      )
      .optional(),
  })
);

const getAuthNoneSchema = defineSchema((v) =>
  v.object({
    type: v.literal("none"),
    allowUnauthenticated: v.literal(true),
  })
);

export const getMCPAuthConfigSchema = defineSchema((v) =>
  v.union([getAuthValidatedSchema(), getAuthNoneSchema()])
);

export const getMCPServerConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean(),
    port: v.number().int().positive().optional(),
    auth: getMCPAuthConfigSchema(),
    cors: v
      .object({
        enabled: v.boolean(),
        origins: v.array(v.string()).optional(),
      })
      .optional(),
  })
);

export const getMCPStatsSchema = defineSchema((v) =>
  v.object({
    tools: v.number().int().nonnegative(),
    resources: v.number().int().nonnegative(),
    prompts: v.number().int().nonnegative(),
    total: v.number().int().nonnegative(),
  })
);

// Backward-compat aliases
export const MCPAuthConfigSchema = lazySchema(getMCPAuthConfigSchema);
export const MCPServerConfigSchema = lazySchema(getMCPServerConfigSchema);
export const MCPStatsSchema = lazySchema(getMCPStatsSchema);

// Inferred types
/** Configuration used by mcpserver. */
export type MCPServerConfig = InferSchema<ReturnType<typeof getMCPServerConfigSchema>>;
/** Public API contract for MCP stats. */
export type MCPStats = InferSchema<ReturnType<typeof getMCPStatsSchema>>;
