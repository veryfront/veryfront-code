import {
  readProviderOptions,
  stringifyJsonValue,
  unwrapToolInputSchema,
} from "veryfront/provider/shared";
import type { RuntimePromptMessage } from "veryfront/provider/shared";

type ProviderCacheTtl = boolean | "5m" | "1h";

type ProviderCacheControlOption = {
  system?: ProviderCacheTtl;
  tools?: ProviderCacheTtl;
};

type ProviderReasoningEffort = "low" | "medium" | "high" | "max";

type ProviderReasoningOption = {
  enabled?: boolean;
  effort?: ProviderReasoningEffort;
  budgetTokens?: number;
};

export type RuntimeToolDefinition =
  | {
    type: "function";
    name: string;
    description?: string;
    inputSchema: unknown;
  }
  | {
    type: "provider";
    name: string;
    id: `${string}.${string}`;
    args: Record<string, unknown>;
  };

export type OpenAICompatibleLanguageOptions = {
  prompt: RuntimePromptMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: unknown;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  includeRawChunks?: boolean;
  abortSignal?: AbortSignal;
  cacheControl?: ProviderCacheControlOption;
  reasoning?: ProviderReasoningOption;
  userId?: string;
  requestLabels?: Record<string, string>;
  serviceTier?: "auto" | "default" | "flex" | "scale";
  parallelToolCalls?: boolean;
  responseFormat?:
    | { type: "text" }
    | { type: "json" }
    | {
      type: "json_schema";
      name: string;
      schema: unknown;
      description?: string;
      strict?: boolean;
    };
  anthropicContainer?: unknown;
  googleCachedContent?: string;
  googleSafetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  mcpServers?: Array<Record<string, unknown>>;
};

type WarningCollector = {
  push(warning: {
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }): void;
  drain(): Array<{
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }>;
};

type AnthropicCompatibleMessage = {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
};

type AnthropicCompatibleRequest = {
  model: string;
  messages: AnthropicCompatibleMessage[];
  max_tokens: number;
  stream?: boolean;
  system?: string | Array<Record<string, unknown>>;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  [key: string]: unknown;
};

function normalizeAnthropicToolChoice(toolChoice: unknown): unknown {
  if (typeof toolChoice === "string") {
    return { type: toolChoice };
  }

  return toolChoice;
}

function toSnakeCaseRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`),
      value,
    ]),
  );
}

function deepSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSnakeCase);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`),
        deepSnakeCase(v),
      ]),
    );
  }
  return value;
}

function pushAnthropicUserContent(
  messages: AnthropicCompatibleMessage[],
  content: Array<Record<string, unknown>>,
): void {
  if (content.length === 0) {
    return;
  }

  const lastMessage = messages.at(-1);
  if (lastMessage?.role === "user") {
    lastMessage.content.push(...content);
    return;
  }

  messages.push({
    role: "user",
    content,
  });
}

function toAnthropicUserContent(
  parts: Extract<RuntimePromptMessage, { role: "user" }>["content"],
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) {
        content.push({ type: "text", text: part.text });
      }
      continue;
    }

    if (part.type === "image" || part.mediaType.startsWith("image/")) {
      content.push({
        type: "image",
        source: {
          type: "url",
          url: part.url,
        },
      });
    }
  }

  return content;
}

function resolveAnthropicCacheControlBlock(
  ttl: ProviderCacheTtl | undefined,
): { type: "ephemeral"; ttl?: "1h" } | undefined {
  if (ttl === undefined || ttl === false) {
    return undefined;
  }
  if (ttl === "1h") {
    return { type: "ephemeral", ttl: "1h" };
  }
  return { type: "ephemeral" };
}

function toAnthropicMessages(
  prompt: RuntimePromptMessage[],
  systemCacheControl?: { type: "ephemeral"; ttl?: "1h" },
): {
  system?: string | Array<Record<string, unknown>>;
  messages: AnthropicCompatibleMessage[];
} {
  const systemParts: string[] = [];
  const messages: AnthropicCompatibleMessage[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        if (message.content.length > 0) {
          systemParts.push(message.content);
        }
        break;
      case "user":
        pushAnthropicUserContent(messages, toAnthropicUserContent(message.content));
        break;
      case "assistant":
        messages.push({
          role: "assistant",
          content: message.content.map((part) => {
            if (part.type === "text") {
              return { type: "text", text: part.text };
            }
            if (part.type === "reasoning") {
              if (typeof part.redactedData === "string") {
                return {
                  type: "redacted_thinking",
                  data: part.redactedData,
                };
              }
              return {
                type: "thinking",
                thinking: part.text ?? "",
                ...(typeof part.signature === "string" ? { signature: part.signature } : {}),
              };
            }
            return {
              type: "tool_use",
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            };
          }),
        });
        break;
      case "tool":
        pushAnthropicUserContent(
          messages,
          message.content.map((part) => ({
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: stringifyJsonValue(part.output.value),
          })),
        );
        break;
    }
  }

  if (systemParts.length === 0) {
    return { messages };
  }

  const joined = systemParts.join("\n\n");
  if (systemCacheControl) {
    return {
      system: [{
        type: "text",
        text: joined,
        cache_control: systemCacheControl,
      }],
      messages,
    };
  }

  return { system: joined, messages };
}

const ANTHROPIC_TOOL_VERSION_ALIASES: Record<string, string> = {
  code_execution: "code_execution_20260120",
  computer_use: "computer_20250124",
  computer: "computer_20250124",
  text_editor: "text_editor_20250728",
  bash: "bash_20250124",
  memory: "memory_20250818",
  web_search: "web_search_20250305",
  web_fetch: "web_fetch_20250910",
};

function resolveAnthropicProviderType(rawType: string): string {
  if (/_\d{8}$/.test(rawType)) {
    return rawType;
  }
  return ANTHROPIC_TOOL_VERSION_ALIASES[rawType] ?? rawType;
}

function toAnthropicTools(
  tools: RuntimeToolDefinition[] | undefined,
  toolsCacheControl?: { type: "ephemeral"; ttl?: "1h" },
): Array<Record<string, unknown>> | undefined {
  if (!tools) {
    return undefined;
  }

  const normalized: Array<Record<string, unknown>> = [];

  for (const tool of tools) {
    if (tool.type === "function") {
      normalized.push({
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        input_schema: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }

    if (!tool.id.startsWith("anthropic.")) {
      continue;
    }

    const rawType = tool.id.slice("anthropic.".length);
    if (rawType.length === 0) {
      continue;
    }

    normalized.push({
      type: resolveAnthropicProviderType(rawType),
      name: tool.name,
      ...toSnakeCaseRecord(tool.args),
    });
  }

  if (normalized.length === 0) {
    return undefined;
  }

  if (toolsCacheControl) {
    const lastIndex = normalized.length - 1;
    normalized[lastIndex] = {
      ...normalized[lastIndex],
      cache_control: toolsCacheControl,
    };
  }

  return normalized;
}

function getAnthropicModelCapabilities(
  modelId: string,
): { maxOutputTokens: number; isKnownModel: boolean } {
  if (modelId.includes("claude-sonnet-4-6") || modelId.includes("claude-opus-4-6")) {
    return { maxOutputTokens: 128_000, isKnownModel: true };
  }
  if (
    modelId.includes("claude-sonnet-4-5") ||
    modelId.includes("claude-opus-4-5") ||
    modelId.includes("claude-haiku-4-5")
  ) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (modelId.includes("claude-opus-4-1")) {
    return { maxOutputTokens: 32_000, isKnownModel: true };
  }
  if (modelId.includes("claude-sonnet-4-")) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (modelId.includes("claude-opus-4-")) {
    return { maxOutputTokens: 32_000, isKnownModel: true };
  }
  if (modelId.includes("claude-3-haiku")) {
    return { maxOutputTokens: 4096, isKnownModel: true };
  }
  return { maxOutputTokens: 4096, isKnownModel: false };
}

function resolveAnthropicMaxTokens(
  modelId: string,
  callerMaxOutputTokens: number | undefined,
): number {
  const { maxOutputTokens: modelMax, isKnownModel } = getAnthropicModelCapabilities(modelId);
  const requested = callerMaxOutputTokens ?? modelMax;
  if (isKnownModel && requested > modelMax) {
    return modelMax;
  }
  return requested;
}

function resolveAnthropicThinkingBudget(
  option: ProviderReasoningOption | undefined,
): number | undefined {
  if (!option || option.enabled !== true) {
    return undefined;
  }
  if (typeof option.budgetTokens === "number" && option.budgetTokens >= 1024) {
    return option.budgetTokens;
  }
  switch (option.effort) {
    case "low":
      return 1024;
    case "high":
      return 16_384;
    case "max":
      return 32_768;
    case "medium":
    default:
      return 4096;
  }
}

export function buildAnthropicMessagesRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): AnthropicCompatibleRequest {
  const systemCacheControl = resolveAnthropicCacheControlBlock(
    options.cacheControl?.system,
  );
  const toolsCacheControl = resolveAnthropicCacheControlBlock(
    options.cacheControl?.tools,
  );

  const { system, messages } = toAnthropicMessages(options.prompt, systemCacheControl);
  const anthropicTools = toAnthropicTools(options.tools, toolsCacheControl);
  const thinkingBudget = resolveAnthropicThinkingBudget(options.reasoning);
  const thinkingEnabled = thinkingBudget !== undefined;

  if (options.presencePenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "presencePenalty",
      details: "Anthropic Messages API has no equivalent and the value was dropped.",
    });
  }
  if (options.frequencyPenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "frequencyPenalty",
      details: "Anthropic Messages API has no equivalent and the value was dropped.",
    });
  }
  if (options.seed !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "seed",
      details: "Anthropic Messages API does not support deterministic seeding.",
    });
  }
  if (options.topK !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "topK",
      details: "Anthropic Messages API does not expose top_k on this surface.",
    });
  }
  if (options.stopSequences && options.stopSequences.length > 4) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "stopSequences",
      details:
        `Anthropic accepts at most 4 stop sequences; ${options.stopSequences.length} were provided and the extras were truncated.`,
    });
  }
  if (thinkingEnabled && options.temperature !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "temperature",
      details:
        "Dropped because Anthropic rejects sampling params when extended thinking is enabled.",
    });
  }
  if (thinkingEnabled && options.topP !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "topP",
      details:
        "Dropped because Anthropic rejects sampling params when extended thinking is enabled.",
    });
  }
  if (options.responseFormat && options.responseFormat.type !== "text") {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "responseFormat",
      details:
        "Anthropic Messages API does not have a structured-output response_format equivalent. Use a tool with the schema as input_schema instead.",
    });
  }

  const baseMaxTokens = resolveAnthropicMaxTokens(modelId, options.maxOutputTokens);
  const maxTokens = thinkingEnabled
    ? Math.min(
      baseMaxTokens + (thinkingBudget ?? 0),
      getAnthropicModelCapabilities(modelId).maxOutputTokens,
    )
    : baseMaxTokens;

  const body: AnthropicCompatibleRequest = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    ...(stream ? { stream: true } : {}),
    ...(system ? { system } : {}),
    ...(!thinkingEnabled && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(!thinkingEnabled && options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stop_sequences: options.stopSequences.slice(0, 4) }
      : {}),
    ...(anthropicTools ? { tools: anthropicTools } : {}),
    ...(options.toolChoice !== undefined
      ? { tool_choice: normalizeAnthropicToolChoice(options.toolChoice) }
      : {}),
    ...(thinkingEnabled ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
    ...(typeof options.userId === "string" && options.userId.length > 0
      ? { metadata: { user_id: options.userId } }
      : {}),
    ...(options.mcpServers && options.mcpServers.length > 0
      ? { mcp_servers: deepSnakeCase(options.mcpServers) as unknown[] }
      : {}),
    ...(options.anthropicContainer !== undefined ? { container: options.anthropicContainer } : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "anthropic", providerName));
  return body;
}
