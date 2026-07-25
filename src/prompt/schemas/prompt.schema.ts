import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/** Generate prompt content from interpolation variables. */
export type PromptGenerateFn = (
  variables: Record<string, unknown>,
) => string | Promise<string>;

export const getPromptConfigSchema = defineSchema((v) => {
  const generator = v.custom<PromptGenerateFn>(
    (value) => typeof value === "function",
    "Expected a prompt generator function",
  );
  const common = {
    id: v.string().optional(),
    description: v.string(),
    /** Example message text to use as a chat suggestion */
    suggestion: v.string().optional(),
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
