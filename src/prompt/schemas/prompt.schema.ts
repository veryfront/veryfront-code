import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getPromptConfigSchema = defineSchema((v) =>
  v.object({
    id: v.string().optional(),
    description: v.string(),
    content: v.string().optional(),
    generate: v.function().optional(),
    /** Example message text to use as a chat suggestion */
    suggestion: v.string().optional(),
  })
);

export type PromptConfig = InferSchema<ReturnType<typeof getPromptConfigSchema>>;
