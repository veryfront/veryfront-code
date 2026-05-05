import { extract } from "#std/front-matter/yaml.ts";
import { z } from "zod";

export const runtimeAgentThinkingConfigSchema = z.object({
  enabled: z.boolean(),
  budgetTokens: z.number().positive().optional(),
});

export type RuntimeAgentThinkingConfig = z.infer<typeof runtimeAgentThinkingConfigSchema>;

export const runtimeAgentMarkdownDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  instructions: z.string(),
  thinking: runtimeAgentThinkingConfigSchema.optional(),
  model: z.string().min(1).optional(),
  maxSteps: z.number().optional(),
});

export type RuntimeAgentMarkdownDefinition = z.infer<typeof runtimeAgentMarkdownDefinitionSchema>;

export const parseRuntimeAgentMarkdownDefinitionInputSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
});

export type ParseRuntimeAgentMarkdownDefinitionInput = z.infer<
  typeof parseRuntimeAgentMarkdownDefinitionInputSchema
>;

function parseThinking(value: unknown): RuntimeAgentThinkingConfig | undefined {
  if (typeof value === "number" && value > 0) {
    return { enabled: true, budgetTokens: value };
  }
  if (value === false) {
    return { enabled: false };
  }
  if (value === true) {
    return { enabled: true };
  }
  return undefined;
}

export function parseRuntimeAgentMarkdownDefinition(
  input: ParseRuntimeAgentMarkdownDefinitionInput,
): RuntimeAgentMarkdownDefinition {
  const parsedInput = parseRuntimeAgentMarkdownDefinitionInputSchema.parse(input);
  const { attrs, body } = extract<Record<string, unknown>>(parsedInput.content);
  const name = typeof attrs.name === "string" && attrs.name.trim() ? attrs.name : parsedInput.id;
  const description = typeof attrs.description === "string" ? attrs.description : "";
  const model = typeof attrs.model === "string" && attrs.model.trim() ? attrs.model : undefined;
  const thinking = parseThinking(attrs.thinking);
  const maxSteps = typeof attrs["max-steps"] === "number" ? attrs["max-steps"] : undefined;

  return runtimeAgentMarkdownDefinitionSchema.parse({
    id: parsedInput.id,
    name,
    description,
    instructions: body.trim(),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(maxSteps === undefined ? {} : { maxSteps }),
  });
}
