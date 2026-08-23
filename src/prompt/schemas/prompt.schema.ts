import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/** Cancellation and deadline controls for one prompt render. */
export interface PromptRenderContext {
  /** Cooperative cancellation signal for generator work. */
  readonly abortSignal?: AbortSignal;
  /** Absolute Unix timestamp in milliseconds after which rendering is cancelled. */
  readonly deadline?: number;
}

/** Generate prompt content from interpolation variables. */
export type PromptGenerateFn = (
  variables: Record<string, unknown>,
  context?: Readonly<PromptRenderContext>,
) => string | Promise<string>;

export const getPromptArgumentSchema = defineSchema((v) =>
  v.object({
    name: v.string().min(1),
    title: v.string().optional(),
    description: v.string().optional(),
    required: v.boolean().optional(),
  })
);

export const getPromptMCPConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean().optional(),
    title: v.string().optional(),
    arguments: v
      .array(getPromptArgumentSchema())
      .refine(
        (arguments_) => new Set(arguments_.map(({ name }) => name)).size === arguments_.length,
        { message: "Prompt argument names must be unique" },
      )
      .optional(),
  })
);

export const getPromptConfigSchema = defineSchema((v) => {
  const generator = v.custom<PromptGenerateFn>(
    (value) => typeof value === "function",
    "Expected a prompt generator function",
  );
  const common = {
    id: v.string().refine((value) => value.trim().length > 0, {
      message: "Prompt id must not be empty",
    }).optional(),
    description: v.string(),
    /** Example message text to use as a chat suggestion */
    suggestion: v.string().optional(),
    /** MCP exposure and argument metadata. */
    mcp: getPromptMCPConfigSchema().optional(),
  };

  // At least one content source is required. Static content intentionally
  // takes precedence when both fields are supplied.
  return v.union([
    v.object({
      ...common,
      content: v.string(),
      generate: generator.optional(),
    }),
    v.object({
      ...common,
      content: v.string().optional(),
      generate: generator,
    }),
  ]);
});

/** Configuration used by prompt. */
export type PromptConfig = InferSchema<ReturnType<typeof getPromptConfigSchema>>;
/** Public MCP argument metadata for a prompt. */
export type PromptArgument = InferSchema<ReturnType<typeof getPromptArgumentSchema>>;
/** Public MCP exposure metadata for a prompt. */
export type PromptMCPConfig = InferSchema<ReturnType<typeof getPromptMCPConfigSchema>>;
