import { extract } from "#std/front-matter/yaml.ts";
import { defineSchema, getJsonValueSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { buildAgentCallContext } from "./call-context.ts";
import { resolveModelProviderOptionKey } from "./model-resolution.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";
import { normalizeAgentDelegateIds } from "./agent-delegation-names.ts";
import { CONFIG_INVALID } from "#veryfront/errors";

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

const getRuntimeAgentMcpToolPolicySchema = defineSchema((v) =>
  v.object({
    allow: v.array(v.string().min(1)).optional(),
    deny: v.array(v.string().min(1)).optional(),
    approval: v.literal("never").optional(),
  })
);

/** Schema for a first-party MCP preset that is safe to serialize with an agent definition. */
export const getRuntimeAgentMcpServerConfigSchema = defineSchema((v) =>
  v.object({
    kind: v.union([v.literal("veryfront-api"), v.literal("veryfront-studio")]),
    id: v.string().min(1).optional(),
    toolPolicy: getRuntimeAgentMcpToolPolicySchema().optional(),
  })
);

/** First-party MCP preset carried over the hosted agent-definition boundary. */
export type RuntimeAgentMcpServerConfig = InferSchema<
  ReturnType<typeof getRuntimeAgentMcpServerConfigSchema>
>;

/** Schema for a structured system message carried over the hosted boundary. */
const getRuntimeAgentSystemMessageSchema = defineSchema<ChatSystemMessage>(
  (v): Schema<ChatSystemMessage> =>
    v.object({
      role: v.literal("system"),
      content: v.string(),
      providerOptions: v.record(v.string(), getJsonValueSchema()).optional(),
    }).strict() as Schema<ChatSystemMessage>,
);

/** Zod schema for get runtime agent markdown definition. */
export const getRuntimeAgentMarkdownDefinitionSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    name: v.string().min(1),
    description: v.string(),
    avatarUrl: v.string().url().optional(),
    instructions: v.string(),
    system: v.array(getRuntimeAgentSystemMessageSchema()).optional(),
    thinking: getRuntimeAgentThinkingConfigSchema().optional(),
    model: v.string().min(1).optional(),
    temperature: v.number().min(0).max(2).optional(),
    maxSteps: v.number().optional(),
    providerTools: v.array(v.string().min(1)).optional(),
    skills: v.union([v.literal(true), v.literal(false), v.array(v.string().min(1))]).optional(),
    tools: v.union([v.literal(true), v.array(v.string().min(1))]).optional(),
    /**
     * Tool names an agent author explicitly switched off with `false`. The
     * positive `tools` selector cannot express a denial, so hosted preparation
     * would otherwise re-add runtime-essential skill tools the author denied.
     * Combining this field with `tools: true` fails closed and disables all
     * project tools. List the allowed tools explicitly when denials are needed.
     */
    deniedTools: v.array(v.string().min(1)).optional(),
    delegates: v.array(v.string().min(1)).optional(),
    mcpServers: v.array(getRuntimeAgentMcpServerConfigSchema()).optional(),
  })
);

export { DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER } from "./call-context.ts";

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
  availableToolNames?: readonly string[];
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

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw CONFIG_INVALID.create({
      detail: `Agent frontmatter "${field}" must be an array of non-empty strings.`,
    });
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw CONFIG_INVALID.create({
        detail: `Agent frontmatter "${field}" entry ${index + 1} must be a non-empty string.`,
      });
    }
    return entry.trim();
  });
}

function parseCapabilitySelector(value: unknown, field: string): true | string[] {
  if (value === true) {
    return true;
  }
  return parseStringArray(value, field);
}

function parseSkillSelector(value: unknown): true | false | string[] {
  if (value === false) {
    return false;
  }
  return parseCapabilitySelector(value, "skills");
}

function parseDelegates(value: unknown): string[] {
  return parseStringArray(value, "delegates");
}

function parseMcpServers(value: unknown): RuntimeAgentMcpServerConfig[] {
  if (!Array.isArray(value)) {
    throw CONFIG_INVALID.create({
      detail: 'Agent frontmatter "mcp-servers" must be an array of MCP server configurations.',
    });
  }
  return value.map((server) => getRuntimeAgentMcpServerConfigSchema().parse(server));
}

/** Definition for parse runtime agent markdown. */
export function parseRuntimeAgentMarkdownDefinition(
  input: ParseRuntimeAgentMarkdownDefinitionInput,
): RuntimeAgentMarkdownDefinition {
  const parsedInput = getParseRuntimeAgentMarkdownDefinitionInputSchema().parse(input);
  const { attrs, body } = extract<Record<string, unknown>>(parsedInput.content);
  const name = typeof attrs.name === "string" && attrs.name.trim() ? attrs.name : parsedInput.id;
  const description = typeof attrs.description === "string" ? attrs.description : "";
  const avatarUrl = typeof attrs["avatar-url"] === "string" && attrs["avatar-url"].trim()
    ? attrs["avatar-url"]
    : typeof attrs.avatarUrl === "string" && attrs.avatarUrl.trim()
    ? attrs.avatarUrl
    : typeof attrs.avatar_url === "string" && attrs.avatar_url.trim()
    ? attrs.avatar_url
    : undefined;
  const model = typeof attrs.model === "string" && attrs.model.trim() ? attrs.model : undefined;
  const thinking = parseThinking(attrs.thinking);
  const temperature = typeof attrs.temperature === "number" ? attrs.temperature : undefined;
  const maxSteps = typeof attrs["max-steps"] === "number" ? attrs["max-steps"] : undefined;
  const providerTools = Object.hasOwn(attrs, "provider-tools")
    ? parseStringArray(attrs["provider-tools"], "provider-tools")
    : undefined;
  const skills = Object.hasOwn(attrs, "skills") ? parseSkillSelector(attrs.skills) : undefined;
  const tools = Object.hasOwn(attrs, "tools")
    ? parseCapabilitySelector(attrs.tools, "tools")
    : undefined;
  if (Object.hasOwn(attrs, "denied-tools") && Object.hasOwn(attrs, "deniedTools")) {
    throw CONFIG_INVALID.create({
      detail: 'Agent frontmatter must use only one of "denied-tools" or "deniedTools".',
    });
  }
  const deniedTools = Object.hasOwn(attrs, "denied-tools")
    ? parseStringArray(attrs["denied-tools"], "denied-tools")
    : Object.hasOwn(attrs, "deniedTools")
    ? parseStringArray(attrs.deniedTools, "deniedTools")
    : undefined;
  const delegates = normalizeAgentDelegateIds(
    parsedInput.id,
    Object.hasOwn(attrs, "delegates") ? parseDelegates(attrs.delegates) : undefined,
  );
  if (tools === true && delegates?.length) {
    throw CONFIG_INVALID.create({
      detail:
        `Agent frontmatter for "${parsedInput.id}" cannot combine delegates with tools: true. ` +
        "Declare the required tools by name so delegate capabilities remain explicit.",
    });
  }
  if (Object.hasOwn(attrs, "mcp-servers") && Object.hasOwn(attrs, "mcpServers")) {
    throw CONFIG_INVALID.create({
      detail: 'Agent frontmatter must use only one of "mcp-servers" or "mcpServers".',
    });
  }
  const mcpServers = Object.hasOwn(attrs, "mcp-servers")
    ? parseMcpServers(attrs["mcp-servers"])
    : Object.hasOwn(attrs, "mcpServers")
    ? parseMcpServers(attrs.mcpServers)
    : undefined;

  return getRuntimeAgentMarkdownDefinitionSchema().parse({
    id: parsedInput.id,
    name,
    description,
    ...(avatarUrl ? { avatarUrl } : {}),
    instructions: body.trim(),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(providerTools ? { providerTools } : {}),
    ...(skills === undefined ? {} : { skills }),
    ...(tools === undefined ? {} : { tools }),
    ...(deniedTools === undefined ? {} : { deniedTools }),
    ...(delegates === undefined ? {} : { delegates }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
  });
}

/**
 * Create runtime agent system messages.
 *
 * Assembly is delegated to {@link buildAgentCallContext}, which deduplicates:
 * a runtime block whose leading tag already appears as a complete element in
 * the agent's instructions is dropped rather than emitted twice.
 */
export function createRuntimeAgentSystemMessages(
  input: CreateRuntimeAgentSystemMessagesInput,
): ChatSystemMessage[] {
  const anthropicProviderAlias = resolveModelProviderOptionKey(input.agent.model);
  const instructions = Array.isArray(input.agent.system) && input.agent.system.length === 0
    ? input.agent.instructions
    : input.agent.system ?? input.agent.instructions;
  return buildAgentCallContext({
    instructions,
    ...(anthropicProviderAlias ? { anthropicProviderAlias } : {}),
    ...(input.runtimeContextMarker === undefined
      ? {}
      : { runtimeContextMarker: input.runtimeContextMarker }),
    ...(input.runtimeBlocks === undefined ? {} : { extraBlocks: input.runtimeBlocks }),
    ...(input.skills === undefined ? {} : { skills: input.skills }),
    ...(input.availableToolNames === undefined
      ? {}
      : { availableToolNames: input.availableToolNames }),
    ...(input.environmentContext === undefined
      ? {}
      : { environmentContext: input.environmentContext }),
  });
}
