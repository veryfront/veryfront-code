import { z } from "zod";

/**
 * MCP auth configuration. One of:
 * - `{ type: "bearer", validate?: (token) => Promise<boolean> }` — bearer-token auth.
 * - `{ type: "none", allowUnauthenticated: true }` — explicit opt-in to an
 *   unauthenticated server. Required for local dev/testing; prevents accidental
 *   exposure of the JSON-RPC surface in production (VULN-SRV-5).
 */
const AuthValidatedSchema = z.object({
  type: z.literal("bearer"),
  validate: z.function().optional(),
});

const AuthNoneSchema = z.object({
  type: z.literal("none"),
  allowUnauthenticated: z.literal(true),
});

export const MCPAuthConfigSchema = z.union([AuthValidatedSchema, AuthNoneSchema]);

export const MCPServerConfigSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().positive().optional(),
  auth: MCPAuthConfigSchema,
  cors: z
    .object({
      enabled: z.boolean(),
      origins: z.array(z.string()).optional(),
    })
    .optional(),
});

export const MCPStatsSchema = z.object({
  tools: z.number().int().nonnegative(),
  resources: z.number().int().nonnegative(),
  prompts: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

// Inferred types
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type MCPStats = z.infer<typeof MCPStatsSchema>;
