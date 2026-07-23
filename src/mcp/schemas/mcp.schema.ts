import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";

/**
 * MCP auth configuration. One of:
 * - `{ type: "bearer", validate: (token) => Promise<boolean> }`, bearer-token auth.
 * - `{ type: "none", allowUnauthenticated: true }`, explicit opt-in to an
 *   unauthenticated server. Required for local dev/testing; prevents accidental
 *   exposure of the JSON-RPC surface in production (VULN-SRV-5).
 */
const getAuthValidatedSchema = defineSchema((v) =>
  v.object({
    type: v.literal("bearer"),
    validate: v.function(),
  }).strict()
);

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" && url.password === "" && url.origin === value;
  } catch {
    return false;
  }
}

const getAuthNoneSchema = defineSchema((v) =>
  v.object({
    type: v.literal("none"),
    allowUnauthenticated: v.literal(true),
  }).strict()
);

export const getMCPAuthConfigSchema = defineSchema((v) =>
  v.union([getAuthValidatedSchema(), getAuthNoneSchema()])
);

export const getMCPServerConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean(),
    port: v.number().int().min(1).max(65_535).optional(),
    auth: getMCPAuthConfigSchema(),
    cors: v
      .object({
        enabled: v.boolean(),
        origins: v
          .array(
            v.string().max(2_048).refine(
              isHttpOrigin,
              "Expected an HTTP or HTTPS origin without credentials or a path",
            ),
          )
          .max(100)
          .refine(
            (origins) => new Set(origins).size === origins.length,
            "MCP CORS origins must be unique",
          )
          .optional(),
      })
      .strict()
      .optional(),
  }).strict()
);

export const getMCPStatsSchema = defineSchema((v) =>
  v.object({
    tools: v.number().int().nonnegative(),
    resources: v.number().int().nonnegative(),
    prompts: v.number().int().nonnegative(),
    total: v.number().int().nonnegative(),
  }).strict().refine(
    (stats) => stats.total === stats.tools + stats.resources + stats.prompts,
    "MCP stats total must equal tools, resources, and prompts",
  )
);

// Backward-compat aliases
export const MCPAuthConfigSchema = lazySchema(getMCPAuthConfigSchema);
export const MCPServerConfigSchema = lazySchema(getMCPServerConfigSchema);
export const MCPStatsSchema = lazySchema(getMCPStatsSchema);

/** Authentication configuration accepted by the MCP server. */
export type MCPAuthConfig =
  | {
    type: "bearer";
    validate: (token: string) => boolean | Promise<boolean>;
  }
  | {
    type: "none";
    allowUnauthenticated: true;
  };

/** Configuration used by the MCP server. */
export interface MCPServerConfig {
  /** Enable the MCP server. */
  enabled: boolean;
  /** HTTP port used by the MCP server when configured. */
  port?: number;
  /** Authentication policy enforced for every request. */
  auth: MCPAuthConfig;
  /** Cross-origin policy for the HTTP transport. */
  cors?: {
    enabled: boolean;
    origins?: string[];
  };
}

/** Counts of primitives currently visible through the MCP registry. */
export interface MCPStats {
  /** Registered tools. */
  tools: number;
  /** Registered resources. */
  resources: number;
  /** Registered prompts. */
  prompts: number;
  /** Sum of tools, resources, and prompts. */
  total: number;
}
