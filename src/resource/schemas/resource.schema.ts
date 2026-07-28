import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { isValidResourceMimeType, RESOURCE_MIME_TYPE_MAX_LENGTH } from "../mime-type.ts";

export const getMcpContentConfigSchema = defineSchema((v) =>
  v.union([
    v.object({
      type: v.literal("json"),
    }).strict(),
    v.object({
      type: v.literal("text"),
      mimeType: v.string()
        .min(1)
        .max(RESOURCE_MIME_TYPE_MAX_LENGTH)
        .refine(
          isValidResourceMimeType,
          "Expected a valid media type without control characters",
        ),
    }).strict(),
    v.object({
      type: v.literal("blob"),
      mimeType: v.string()
        .min(1)
        .max(RESOURCE_MIME_TYPE_MAX_LENGTH)
        .refine(
          isValidResourceMimeType,
          "Expected a valid media type without control characters",
        ),
    }).strict(),
  ])
);

export const getMcpConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean().optional(),
    content: getMcpContentConfigSchema().optional(),
  }).strict()
);

// Backward-compat aliases
export const McpContentConfigSchema = lazySchema(getMcpContentConfigSchema);
export const McpConfigSchema = lazySchema(getMcpConfigSchema);

// Inferred types
/** MCP resource content transport configuration. */
export type McpContentConfig = InferSchema<ReturnType<typeof getMcpContentConfigSchema>>;
/** MCP resource exposure configuration. */
export type McpConfig = InferSchema<ReturnType<typeof getMcpConfigSchema>>;
