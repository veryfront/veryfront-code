import { extract } from "#std/front-matter/yaml.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { createRuntimePromptBlock } from "./prompt-block.ts";
import { buildRuntimeAvailableSkillsPromptBlock } from "./skill-prompt.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

/** Zod schema for get runtime agent thinking config. */
export const getRuntimeAgentThinkingConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean(),
    budgetTokens: v.number().positive().optional(),
  })
);

/** Schema for runtime agent thinking config.
 * @deprecated Use getRuntimeAgentThinkingConfigSchema()
 */
export const runtimeAgentThinkingConfigSchema = lazySchema(getRuntimeAgentThinkingConfigSchema);

/** Configuration used by runtime agent thinking. */
export type RuntimeAgentThinkingConfig = InferSchema<
  ReturnType<typeof getRuntimeAgentThinkingConfigSchema>
>;

/** Zod schema for get runtime agent markdown definition. */
export const getRuntimeAgentMarkdownDefinitionSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    name: v.string().min(1),
    description: v.string(),
    instructions: v.string(),
    thinking: getRuntimeAgentThinkingConfigSchema().optional(),
    model: v.string().min(1).optional(),
    temperature: v.number().min(0).max(2).optional(),
    maxSteps: v.number().optional(),
    providerTools: v.array(v.string().min(1)).optional(),
  })
);

/** Default value for runtime agent context marker. */
export const DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER = "<!-- veryfront-runtime-context -->";

/** Schema for runtime agent markdown definition.
 * @deprecated Use getRuntimeAgentMarkdownDefinitionSchema()
 */
export const runtimeAgentMarkdownDefinitionSchema = lazySchema(
  getRuntimeAgentMarkdownDefinitionSchema,
);

/** Definition for runtime agent markdown. */
export type RuntimeAgentMarkdownDefinition = InferSchema<
  ReturnType<typeof getRuntimeAgentMarkdownDefinitionSchema>
>;

/** Zod schema for get parse runtime agent markdown definition input. */
export const getParseRuntimeAgentMarkdownDefinitionInputSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    content: v.string(),
  })
);

/** Schema for parse runtime agent markdown definition input.
 * @deprecated Use getParseRuntimeAgentMarkdownDefinitionInputSchema()
 */
export const parseRuntimeAgentMarkdownDefinitionInputSchema = lazySchema(
  getParseRuntimeAgentMarkdownDefinitionInputSchema,
);

/** Input payload for parse runtime agent markdown definition. */
export type ParseRuntimeAgentMarkdownDefinitionInput = InferSchema<
  ReturnType<typeof getParseRuntimeAgentMarkdownDefinitionInputSchema>
>;

/** Input payload for create runtime agent system messages. */
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

function parseProviderTools(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value;
}

/** Definition for parse runtime agent markdown. */
export function parseRuntimeAgentMarkdownDefinition(
  input: ParseRuntimeAgentMarkdownDefinitionInput,
): RuntimeAgentMarkdownDefinition {
  const parsedInput = getParseRuntimeAgentMarkdownDefinitionInputSchema().parse(input);
  const { attrs, body } = extract<Record<string, unknown>>(parsedInput.content);
  const name = typeof attrs.name === "string" && attrs.name.trim() ? attrs.name : parsedInput.id;
  const description = typeof attrs.description === "string" ? attrs.description : "";
  const model = typeof attrs.model === "string" && attrs.model.trim() ? attrs.model : undefined;
  const thinking = parseThinking(attrs.thinking);
  const temperature = typeof attrs.temperature === "number" ? attrs.temperature : undefined;
  const maxSteps = typeof attrs["max-steps"] === "number" ? attrs["max-steps"] : undefined;
  const providerTools = parseProviderTools(attrs["provider-tools"]);

  return getRuntimeAgentMarkdownDefinitionSchema().parse({
    id: parsedInput.id,
    name,
    description,
    instructions: body.trim(),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(providerTools ? { providerTools } : {}),
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

/** Create runtime agent system messages. */
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
