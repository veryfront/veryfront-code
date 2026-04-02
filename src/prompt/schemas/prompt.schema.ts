import { z } from "zod";

export const PromptConfigSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  content: z.string().optional(),
  generate: z.function().optional(),
  /** Example message text to use as a chat suggestion */
  suggestion: z.string().optional(),
});

export type PromptConfig = z.infer<typeof PromptConfigSchema>;
