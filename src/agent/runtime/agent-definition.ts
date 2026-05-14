import { extract } from "#std/front-matter/yaml.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { createRuntimePromptBlock } from "./prompt-block.ts";
import { buildRuntimeAvailableSkillsPromptBlock } from "./skill-prompt.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

export const getRuntimeAgentThinkingConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean(),
    budgetTokens: v.number().positive().optional(),
  })
);

/** @deprecated Use getRuntimeAgentThinkingConfigSchema() */
export const runtimeAgentThinkingConfigSchema = getRuntimeAgentThinkingConfigSchema();

export type RuntimeAgentThinkingConfig = InferSchema<
  ReturnType<typeof getRuntimeAgentThinkingConfigSchema>
>;

export const getRuntimeAgentMarkdownDefinitionSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    name: v.string().min(1),
    description: v.string(),
    instructions: v.string(),
    thinking: getRuntimeAgentThinkingConfigSchema().optional(),
    model: v.string().min(1).optional(),
    maxSteps: v.number().optional(),
  })
);

export const DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER = "<!-- veryfront-runtime-context -->";

/** @deprecated Use getRuntimeAgentMarkdownDefinitionSchema() */
export const runtimeAgentMarkdownDefinitionSchema = getRuntimeAgentMarkdownDefinitionSchema();

export type RuntimeAgentMarkdownDefinition = InferSchema<
  ReturnType<typeof getRuntimeAgentMarkdownDefinitionSchema>
>;

export const getParseRuntimeAgentMarkdownDefinitionInputSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    content: v.string(),
  })
);

/** @deprecated Use getParseRuntimeAgentMarkdownDefinitionInputSchema() */
export const parseRuntimeAgentMarkdownDefinitionInputSchema =
  getParseRuntimeAgentMarkdownDefinitionInputSchema();

export type ParseRuntimeAgentMarkdownDefinitionInput = InferSchema<
  ReturnType<typeof getParseRuntimeAgentMarkdownDefinitionInputSchema>
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
  const parsedInput = getParseRuntimeAgentMarkdownDefinitionInputSchema().parse(input);
  const { attrs, body } = extract<Record<string, unknown>>(parsedInput.content);
  const name = typeof attrs.name === "string" && attrs.name.trim() ? attrs.name : parsedInput.id;
  const description = typeof attrs.description === "string" ? attrs.description : "";
  const model = typeof attrs.model === "string" && attrs.model.trim() ? attrs.model : undefined;
  const thinking = parseThinking(attrs.thinking);
  const maxSteps = typeof attrs["max-steps"] === "number" ? attrs["max-steps"] : undefined;

  return getRuntimeAgentMarkdownDefinitionSchema().parse({
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
