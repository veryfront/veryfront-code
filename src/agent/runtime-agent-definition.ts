import { extract } from "#std/front-matter/yaml.ts";
import { z } from "zod";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { createRuntimePromptBlock } from "./runtime-prompt-block.ts";
import { buildRuntimeAvailableSkillsPromptBlock } from "./runtime-skill-prompt.ts";
import type { RuntimeSkillDefinition } from "./runtime-skill-metadata.ts";

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

export const DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER = "<!-- veryfront-runtime-context -->";

export const parseRuntimeAgentMarkdownDefinitionInputSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
});

export type ParseRuntimeAgentMarkdownDefinitionInput = z.infer<
  typeof parseRuntimeAgentMarkdownDefinitionInputSchema
>;

export type CreateRuntimeAgentSystemMessagesInput = {
  agent: RuntimeAgentMarkdownDefinition;
  runtimeBlocks?: readonly string[];
  skills?: readonly RuntimeSkillDefinition[];
  environmentContext?: string;
  runtimeContextMarker?: string;
};

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

function splitRuntimeAgentInstructions(input: {
  instructions: string;
  runtimeContextMarker: string;
}): { before: string; after: string | null } {
  const markerIndex = input.instructions.indexOf(input.runtimeContextMarker);

  if (markerIndex < 0) {
    return { before: input.instructions, after: null };
  }

  return {
    before: input.instructions.slice(0, markerIndex).trim(),
    after: input.instructions.slice(markerIndex + input.runtimeContextMarker.length).trim() || null,
  };
}

export function createRuntimeAgentSystemMessages(
  input: CreateRuntimeAgentSystemMessagesInput,
): ChatSystemMessage[] {
  const runtimeContextMarker = input.runtimeContextMarker ?? DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER;
  const splitInstructions = splitRuntimeAgentInstructions({
    instructions: input.agent.instructions,
    runtimeContextMarker,
  });
  const staticParts: string[] = [];

  if (splitInstructions.before) {
    staticParts.push(splitInstructions.before);
  }

  staticParts.push(...(input.runtimeBlocks ?? []).filter((block) => block.length > 0));

  if (splitInstructions.after) {
    staticParts.push(splitInstructions.after);
  }

  if (input.skills?.length) {
    staticParts.push(buildRuntimeAvailableSkillsPromptBlock(input.skills));
  }

  const result: ChatSystemMessage[] = [
    {
      role: "system",
      content: staticParts.join("\n\n"),
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
  ];

  if (input.environmentContext) {
    result.push({
      role: "system",
      content: createRuntimePromptBlock({
        name: "environment_context",
        content: input.environmentContext,
      }),
    });
  }

  return result;
}
