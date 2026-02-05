import { z } from "zod";

export const PromptConfigSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  content: z.string().optional(),
  generate: z
    .function(z.tuple([z.record(z.unknown())]), z.union([z.string(), z.promise(z.string())]))
    .optional(),
  /** Example message text to use as a chat suggestion */
  suggestion: z.string().optional(),
});

// Inferred type
export type PromptConfig = z.infer<typeof PromptConfigSchema>;

// Note: Prompt interface with getContent method stays as TypeScript interface
// since it includes a method that returns a Promise
