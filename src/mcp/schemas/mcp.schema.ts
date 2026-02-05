import { z } from "zod";

export const MCPServerConfigSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().positive().optional(),
  auth: z
    .object({
      type: z.enum(["bearer", "api-key", "none"]),
      validate: z.function(z.tuple([z.string()]), z.union([z.promise(z.boolean()), z.boolean()]))
        .optional(),
    })
    .optional(),
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
