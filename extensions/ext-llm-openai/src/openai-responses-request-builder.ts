import {
  readProviderOptions,
  stringifyJsonValue,
  unwrapToolInputSchema,
} from "veryfront/provider/shared";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import type {
  OpenAICompatibleLanguageOptions,
  RuntimeToolDefinition,
} from "./openai-chat-request-builder.ts";
import {
  rejectsOpenAISamplingParams,
  resolveOpenAIReasoningConfig,
  shouldRequestOpenAIReasoningSummary,
} from "./openai-reasoning-models.ts";

export type OpenAIResponsesInputItem = Record<string, unknown>;

export type OpenAIResponsesRequest = {
  model: string;
  input: OpenAIResponsesInputItem[];
  store?: boolean;
  instructions?: string;
  stream?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  reasoning?: { effort?: string; summary?: string };
  metadata?: Record<string, string>;
  user?: string;
  service_tier?: string;
  parallel_tool_calls?: boolean;
  text?: { format: Record<string, unknown> };
  [key: string]: unknown;
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

export type OpenAINativeToolSearchMode = "hosted" | "client";

type OpenAINativeToolSearchConfig = {
  mode: OpenAINativeToolSearchMode;
};

const OPENAI_NATIVE_TOOL_SEARCH_MODEL_IDS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

/** Explicit capability gate for Responses API tool search. */
export function supportsOpenAINativeToolSearch(
  modelId: string,
  providerName = "openai",
): boolean {
  if (providerName !== "openai" && providerName !== "veryfront-cloud") {
    return false;
  }
  const baseModelId = modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return OPENAI_NATIVE_TOOL_SEARCH_MODEL_IDS.some((supportedModelId) =>
    baseModelId === supportedModelId
  );
}

function readOpenAINativeToolSearchConfig(
  tools: RuntimeToolDefinition[] | undefined,
): OpenAINativeToolSearchConfig | undefined {
  const searchTool = tools?.find((tool) => tool.type === "function" && tool.name === "tool_search");
  return searchTool?.type === "function" && searchTool.nativeToolSearch
    ? { mode: searchTool.nativeToolSearch.mode }
    : undefined;
}

function normalizeOpenAIProviderToolMember(
  value: unknown,
  nativeEnabled: boolean,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const member = value as Record<string, unknown>;
  if (
    !nativeEnabled &&
    (member.deferLoading === true || member.defer_loading === true)
  ) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(member).flatMap(([key, nested]) => {
      if (key === "deferLoading" || key === "defer_loading") {
        return nativeEnabled && nested === true ? [["defer_loading", true]] : [];
      }
      return [[key, nested]];
    }),
  );
}

function normalizeOpenAIProviderToolArgs(
  args: Record<string, unknown>,
  nativeEnabled: boolean,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).flatMap(([key, nested]) => {
      if (key === "deferLoading" || key === "defer_loading") {
        return nativeEnabled && nested === true ? [["defer_loading", true]] : [];
      }
      const normalizedKey = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
      if (key === "tools" && Array.isArray(nested)) {
        return [[
          normalizedKey,
          nested.flatMap((member) => {
            const normalized = normalizeOpenAIProviderToolMember(member, nativeEnabled);
            return normalized === undefined ? [] : [normalized];
          }),
        ]];
      }
      return [[normalizedKey, nested]];
    }),
  );
}

function toOpenAIResponsesInput(
  prompt: RuntimePromptMessage[],
): { instructions?: string; input: OpenAIResponsesInputItem[] } {
  const instructionsParts: string[] = [];
  const input: OpenAIResponsesInputItem[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        if (message.content.length > 0) {
          instructionsParts.push(message.content);
        }
        break;
      case "user":
        input.push({
          role: "user",
          content: toOpenAIResponsesUserContent(message.content),
        });
        break;
      case "assistant": {
        const messageContent: Array<Record<string, unknown>> = [];
        for (const part of message.content) {
          if (part.type === "text") {
            messageContent.push({ type: "output_text", text: part.text });
            continue;
          }
          if (part.type === "reasoning") {
            if (messageContent.length > 0) {
              input.push({ role: "assistant", content: [...messageContent] });
              messageContent.length = 0;
            }
            const summary: Array<Record<string, unknown>> = [];
            if (typeof part.text === "string" && part.text.length > 0) {
              summary.push({ type: "summary_text", text: part.text });
            }
            input.push({
              type: "reasoning",
              ...(typeof part.signature === "string" ? { encrypted_content: part.signature } : {}),
              summary,
            });
            continue;
          }
          if (part.type === "provider-block") {
            if (messageContent.length > 0) {
              input.push({ role: "assistant", content: [...messageContent] });
              messageContent.length = 0;
            }
            if (part.provider === "openai-responses") {
              input.push(part.block);
            }
            continue;
          }
          if (messageContent.length > 0) {
            input.push({ role: "assistant", content: [...messageContent] });
            messageContent.length = 0;
          }
          input.push({
            type: "function_call",
            call_id: part.toolCallId,
            name: part.toolName,
            arguments: stringifyJsonValue(part.input),
          });
        }
        if (messageContent.length > 0) {
          input.push({ role: "assistant", content: messageContent });
        }
        break;
      }
      case "tool":
        for (const part of message.content) {
          input.push({
            type: "function_call_output",
            call_id: part.toolCallId,
            output: stringifyJsonValue(part.output.value),
          });
        }
        break;
    }
  }

  return {
    ...(instructionsParts.length > 0 ? { instructions: instructionsParts.join("\n\n") } : {}),
    input,
  };
}

function toOpenAIResponsesUserContent(
  parts: Extract<RuntimePromptMessage, { role: "user" }>["content"],
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) {
        content.push({ type: "input_text", text: part.text });
      }
      continue;
    }

    if (part.type === "image" || part.mediaType.startsWith("image/")) {
      content.push({ type: "input_image", image_url: part.url, detail: "auto" });
      continue;
    }

    content.push({
      type: "input_file",
      file_url: part.url,
      ...(part.filename ? { filename: part.filename } : {}),
    });
  }

  return content;
}

function toOpenAIResponsesTools(
  tools: RuntimeToolDefinition[] | undefined,
  nativeToolSearch?: OpenAINativeToolSearchConfig,
): Array<Record<string, unknown>> | undefined {
  if (!tools) return undefined;
  const normalized: Array<Record<string, unknown>> = [];
  const nativeEnabled = nativeToolSearch !== undefined;
  for (const tool of tools) {
    if (tool.type === "function") {
      if (tool.deferLoading === true && !nativeEnabled) {
        continue;
      }
      if (nativeEnabled && tool.name === "tool_search") {
        normalized.push(
          nativeToolSearch.mode === "client"
            ? {
              type: "tool_search",
              execution: "client",
              ...(typeof tool.description === "string" ? { description: tool.description } : {}),
              parameters: unwrapToolInputSchema(tool.inputSchema),
            }
            : { type: "tool_search" },
        );
        continue;
      }
      normalized.push({
        type: "function",
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        // Responses otherwise attempts to normalize omitted strictness into
        // strict mode, which turns every declared property into a required
        // argument. Runtime and remote tool schemas use normal JSON Schema
        // optional properties, so preserve that contract explicitly.
        strict: false,
        ...(nativeEnabled && tool.deferLoading === true ? { defer_loading: true } : {}),
        parameters: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }
    if (!tool.id.startsWith("openai.")) continue;
    const providerType = tool.id.slice("openai.".length);
    if (providerType.length === 0) continue;
    normalized.push({
      type: providerType,
      ...normalizeOpenAIProviderToolArgs(tool.args, nativeEnabled),
    });
  }
  return normalized.length > 0 ? normalized : undefined;
}

export function buildOpenAIResponsesRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): OpenAIResponsesRequest {
  const reasoning = resolveOpenAIReasoningConfig(modelId, providerName, options.reasoning);
  const reasoningEnabled = reasoning !== undefined;
  const samplingRejected = rejectsOpenAISamplingParams(modelId);
  const dropSamplingParams = reasoningEnabled || samplingRejected;

  if (options.topK !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "openai",
      setting: "topK",
      details: "OpenAI Responses API does not expose top_k; the value was dropped.",
    });
  }
  if (dropSamplingParams) {
    const dropped: Array<[keyof typeof options, string]> = [
      ["temperature", "temperature"],
      ["topP", "top_p"],
      ["presencePenalty", "presence_penalty"],
      ["frequencyPenalty", "frequency_penalty"],
    ];
    for (const [key, openaiName] of dropped) {
      if (options[key] !== undefined) {
        warnings.push({
          type: "unsupported-setting",
          provider: "openai",
          setting: key,
          details: samplingRejected
            ? `Dropped because this model rejects ${openaiName}.`
            : `Dropped because reasoning was active for this request and OpenAI rejects ${openaiName} with reasoning.`,
        });
      }
    }
  }

  const providerOptions = readProviderOptions(
    options.providerOptions,
    ...(providerName === "openai" ? ["openai-compatible"] : []),
    "openai",
    providerName,
  );
  const toolSearch = supportsOpenAINativeToolSearch(modelId, providerName)
    ? readOpenAINativeToolSearchConfig(options.tools)
    : undefined;
  const { instructions, input } = toOpenAIResponsesInput(options.prompt);
  const responsesTools = toOpenAIResponsesTools(options.tools, toolSearch);
  const providerRequestOptions = { ...providerOptions };
  delete providerRequestOptions.toolSearch;

  const body: OpenAIResponsesRequest = {
    model: modelId,
    input,
    // Stay stateless: encrypted reasoning content is never round-tripped via include.
    store: false,
    ...(instructions !== undefined ? { instructions } : {}),
    ...(stream ? { stream: true } : {}),
    ...(options.maxOutputTokens !== undefined
      ? { max_output_tokens: options.maxOutputTokens }
      : {}),
    ...(!dropSamplingParams && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(!dropSamplingParams && options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(responsesTools ? { tools: responsesTools } : {}),
    ...(options.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {}),
    ...(reasoning !== undefined
      ? {
        reasoning: {
          effort: reasoning.effort,
          ...(shouldRequestOpenAIReasoningSummary(providerName, reasoning)
            ? { summary: "auto" }
            : {}),
        },
      }
      : {}),
    ...(typeof options.userId === "string" && options.userId.length > 0
      ? { user: options.userId }
      : {}),
    ...(options.serviceTier !== undefined ? { service_tier: options.serviceTier } : {}),
    ...(options.parallelToolCalls !== undefined
      ? { parallel_tool_calls: options.parallelToolCalls }
      : {}),
    ...(options.responseFormat && options.responseFormat.type !== "text"
      ? {
        text: {
          format: options.responseFormat.type === "json" ? { type: "json_object" } : {
            type: "json_schema",
            name: options.responseFormat.name,
            ...(typeof options.responseFormat.description === "string"
              ? { description: options.responseFormat.description }
              : {}),
            schema: unwrapToolInputSchema(options.responseFormat.schema),
            ...(options.responseFormat.strict !== undefined
              ? { strict: options.responseFormat.strict }
              : {}),
          },
        },
      }
      : {}),
  };

  // Env-BYOK users historically registered options under "openai-compatible";
  // keep merging that bucket at the lowest precedence.
  Object.assign(body, providerRequestOptions);
  return body;
}
