/**
 * OpenAI provider — implements the {@link AIProvider} contract for OpenAI,
 * OpenAI-compatible endpoints (Azure OpenAI, Moonshot AI), and OpenAI's
 * Responses API.
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 11.
 *
 * @module extensions/ext-openai/openai-provider
 */

import type { AIProvider, AIProviderConfig } from "veryfront/extensions/interfaces";
import type { EmbeddingRuntime, ModelRuntime } from "veryfront/provider/types";
import {
  buildProviderError,
  createOpenAIRequestInit,
  createWarningCollector,
  getOpenAIChatCompletionsUrl,
  getOpenAIEmbeddingUrl,
  getOpenAIResponsesUrl,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  readProviderOptions,
  readRecord,
  readTextParts,
  requestJson,
  requestStream,
  stringifyJsonValue,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  toOpenAICompatibleMessages,
  toOpenAICompatibleTools,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import type { RuntimePromptMessage } from "veryfront/provider/shared";

// Re-export error classes so extension tests can import from this module.
export {
  buildProviderError,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
};

export interface OpenAIRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ProviderReasoningEffort = "low" | "medium" | "high" | "max";

type ProviderReasoningOption = {
  enabled?: boolean;
  effort?: ProviderReasoningEffort;
  budgetTokens?: number;
};

type OpenAICompatibleChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
    role: "assistant";
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }
  | {
    role: "tool";
    tool_call_id: string;
    content: string;
  };

type OpenAICompatibleChatRequest = {
  model: string;
  messages: OpenAICompatibleChatMessage[];
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      parameters: unknown;
      description?: string;
    };
  }>;
  tool_choice?: unknown;
  seed?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  [key: string]: unknown;
};

type OpenAICompatibleChoice = {
  message?: unknown;
  delta?: unknown;
  finish_reason?: unknown;
};

type OpenAIStreamToolCallState = {
  id: string;
  name: string;
  arguments: string;
  started: boolean;
};

type RuntimeToolDefinition =
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

type OpenAICompatibleLanguageOptions = {
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
  reasoning?: ProviderReasoningOption;
  userId?: string;
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
};

type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

function extractOpenAIEmbeddings(payload: unknown): number[][] {
  const record = readRecord(payload);
  const data = record?.data;
  if (!Array.isArray(data)) {
    throw new Error("Invalid OpenAI embedding response: data array missing");
  }

  const embeddings: number[][] = [];

  for (const item of data) {
    const itemRecord = readRecord(item);
    const embedding = itemRecord?.embedding;
    if (!isNumberArray(embedding)) {
      throw new Error("Invalid OpenAI embedding response: embedding vector missing");
    }
    embeddings.push(embedding);
  }

  return embeddings;
}

function extractOpenAIUsageTokens(payload: unknown): number | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  const totalTokens = usage?.total_tokens;
  return typeof totalTokens === "number" ? totalTokens : undefined;
}

// ---------------------------------------------------------------------------
// Chat helpers
// ---------------------------------------------------------------------------

function normalizeOpenAIFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") {
    return null;
  }

  if (raw === "tool_calls") {
    return { unified: "tool-calls", raw };
  }

  if (raw === "content_filter") {
    return { unified: "content-filter", raw };
  }

  return raw;
}

function extractOpenAIUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  const promptTokensDetails = readRecord(usage.prompt_tokens_details);
  const cachedTokens = promptTokensDetails?.cached_tokens;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
  };
}

function extractOpenAIContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  let text = "";
  for (const part of content) {
    const record = readRecord(part);
    const type = record?.type;
    if (type === "text" && typeof record?.text === "string") {
      text += record.text;
    }
  }

  return text;
}

function extractOpenAIToolCalls(message: Record<string, unknown>): Array<{
  toolCallId: string;
  toolName: string;
  input: string;
}> {
  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const normalized: Array<{ toolCallId: string; toolName: string; input: string }> = [];
  for (const entry of toolCalls) {
    const record = readRecord(entry);
    const id = typeof record?.id === "string" ? record.id : undefined;
    const fn = readRecord(record?.function);
    const name = typeof fn?.name === "string" ? fn.name : undefined;
    const argumentsText = typeof fn?.arguments === "string" ? fn.arguments : undefined;
    if (!id || !name || argumentsText === undefined) {
      continue;
    }
    normalized.push({
      toolCallId: id,
      toolName: name,
      input: argumentsText,
    });
  }

  return normalized;
}

/**
 * OpenAI reasoning models (o1 / o3 / o4 family) use the completion path but
 * have different constraints than chat models: sampling params are rejected,
 * and they accept a `reasoning_effort` field. We detect them by model id
 * prefix so callers don't have to configure it per runtime.
 */
function isOpenAIReasoningModel(modelId: string): boolean {
  return /^o[134](-|$)/.test(modelId);
}

/**
 * Detect native OpenAI models (gpt-*, o-series, chatgpt-*) vs third-party
 * OpenAI-compatible providers (Kimi, etc.). Native OpenAI models require
 * `max_completion_tokens` (the old `max_tokens` is rejected by newer models
 * like gpt-5.2), while third-party providers still expect `max_tokens`.
 */
function isNativeOpenAIModel(modelId: string): boolean {
  return /^(gpt-|o[134](-|$)|chatgpt-)/.test(modelId);
}

/**
 * Kimi K2.5 fixes sampling parameters (temperature, top_p, presence_penalty,
 * frequency_penalty) to predetermined values and rejects any other values.
 * See https://platform.moonshot.cn/docs/guide/kimi-k2-5-quickstart
 */
function isFixedSamplingModel(modelId: string): boolean {
  return /^kimi-k2\.5/.test(modelId);
}

/**
 * Map the unified reasoning effort to OpenAI's `reasoning_effort` enum.
 * OpenAI doesn't accept "max" — we collapse it to "high".
 */
function resolveOpenAIReasoningEffort(
  option: ProviderReasoningOption | undefined,
): "low" | "medium" | "high" | undefined {
  if (!option || option.enabled !== true) {
    return undefined;
  }
  switch (option.effort) {
    case "low":
      return "low";
    case "high":
    case "max":
      return "high";
    case "medium":
    default:
      return "medium";
  }
}

function unwrapToolInputSchema(inputSchema: unknown): unknown {
  if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) {
    return inputSchema;
  }

  const candidate = Reflect.get(inputSchema, "jsonSchema");
  return candidate ?? inputSchema;
}

function toSnakeCaseRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`),
      value,
    ]),
  );
}

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

function buildOpenAIChatRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): OpenAICompatibleChatRequest {
  const isReasoningModel = isOpenAIReasoningModel(modelId);
  const reasoningEffort = resolveOpenAIReasoningEffort(options.reasoning);
  const reasoningEnabled = isReasoningModel || reasoningEffort !== undefined;
  const fixedSampling = isFixedSamplingModel(modelId);
  const dropSamplingParams = reasoningEnabled || fixedSampling;

  // OpenAI Chat Completions has no top_k surface.
  if (options.topK !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "openai",
      setting: "topK",
      details: "OpenAI Chat Completions does not expose top_k; the value was dropped.",
    });
  }

  // Reasoning models (o1 / o3 / o4) and models with fixed sampling params
  // reject sampling params outright. Emit warnings.
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
          details: fixedSampling
            ? `Dropped because this model uses fixed sampling parameters.`
            : `Dropped because OpenAI reasoning models reject ${openaiName}. Reasoning was active for this request.`,
        });
      }
    }
  }

  const body: OpenAICompatibleChatRequest = {
    model: modelId,
    messages: toOpenAICompatibleMessages(options.prompt),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(options.maxOutputTokens !== undefined
      ? isNativeOpenAIModel(modelId)
        ? { max_completion_tokens: options.maxOutputTokens }
        : { max_tokens: options.maxOutputTokens }
      : {}),
    ...(!dropSamplingParams && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(!dropSamplingParams && options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stop: options.stopSequences }
      : {}),
    ...(toOpenAICompatibleTools(options.tools)
      ? { tools: toOpenAICompatibleTools(options.tools) }
      : {}),
    ...(options.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(!dropSamplingParams && options.presencePenalty !== undefined
      ? { presence_penalty: options.presencePenalty }
      : {}),
    ...(!dropSamplingParams && options.frequencyPenalty !== undefined
      ? { frequency_penalty: options.frequencyPenalty }
      : {}),
    ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
    ...(typeof options.userId === "string" && options.userId.length > 0
      ? { user: options.userId }
      : {}),
    ...(options.serviceTier !== undefined ? { service_tier: options.serviceTier } : {}),
    ...(options.parallelToolCalls !== undefined
      ? { parallel_tool_calls: options.parallelToolCalls }
      : {}),
    ...(options.responseFormat && options.responseFormat.type !== "text"
      ? {
        response_format: options.responseFormat.type === "json" ? { type: "json_object" } : {
          type: "json_schema",
          json_schema: {
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

  const providerOpts = readProviderOptions(options.providerOptions, "openai", providerName);

  // Normalize max_tokens → max_completion_tokens for native OpenAI models.
  if (isNativeOpenAIModel(modelId) && "max_tokens" in providerOpts) {
    if (!("max_completion_tokens" in providerOpts)) {
      providerOpts.max_completion_tokens = providerOpts.max_tokens;
    }
    delete providerOpts.max_tokens;
  }

  Object.assign(body, providerOpts);
  return body;
}

// ---------------------------------------------------------------------------
// Chat streaming
// ---------------------------------------------------------------------------

function parseSseChunk(chunk: string): {
  events: Array<unknown | "[DONE]">;
  remainder: string;
} {
  const blocks = chunk.split(/\r?\n\r?\n/);
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const dataLines = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return [];
    }

    const payload = dataLines.join("\n").trim();
    if (payload === "[DONE]") {
      return ["[DONE]" as const];
    }

    try {
      return [JSON.parse(payload) as unknown];
    } catch {
      return [];
    }
  });

  return { events, remainder };
}

function extractFirstChoice(payload: unknown): OpenAICompatibleChoice | undefined {
  const record = readRecord(payload);
  const choices = record?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }

  const first = readRecord(choices[0]);
  if (!first) {
    return undefined;
  }

  return first;
}

function buildOpenAIGenerateResult(payload: unknown): {
  content: Array<
    { type: "text"; text: string } | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: string;
    }
  >;
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
} {
  const choice = extractFirstChoice(payload);
  const message = readRecord(choice?.message);
  const text = extractOpenAIContentText(message?.content);
  const toolCalls = message ? extractOpenAIToolCalls(message) : [];

  return {
    content: [
      ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
      ...toolCalls.map((toolCall) => ({
        type: "tool-call" as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
      })),
    ],
    finishReason: normalizeOpenAIFinishReason(choice?.finish_reason),
    usage: extractOpenAIUsage(payload),
  };
}

async function* streamOpenAICompatibleParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, OpenAIStreamToolCallState>();
  let reasoningId: string | null = null;
  let reasoningIndex = 0;
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }

      const record = readRecord(event);
      usage = extractOpenAIUsage(record) ?? usage;
      const choice = extractFirstChoice(record);
      if (!choice) {
        continue;
      }

      const delta = readRecord(choice.delta);
      if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
        if (!reasoningId) {
          reasoningId = `reasoning-${reasoningIndex++}`;
          yield {
            type: "reasoning-start",
            id: reasoningId,
          };
        }

        yield {
          type: "reasoning-delta",
          id: reasoningId,
          delta: delta.reasoning_content,
        };
      }

      const textDelta = extractOpenAIContentText(delta?.content);
      if (textDelta.length > 0) {
        if (reasoningId) {
          yield {
            type: "reasoning-end",
            id: reasoningId,
          };
          reasoningId = null;
        }
        yield { type: "text-delta", delta: textDelta };
      }

      const rawToolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
      for (const rawToolCall of rawToolCalls) {
        if (reasoningId) {
          yield {
            type: "reasoning-end",
            id: reasoningId,
          };
          reasoningId = null;
        }

        const toolCallRecord = readRecord(rawToolCall);
        const index = typeof toolCallRecord?.index === "number" ? toolCallRecord.index : 0;
        const current = toolCalls.get(index) ?? {
          id: typeof toolCallRecord?.id === "string" ? toolCallRecord.id : `tool-${index}`,
          name: "",
          arguments: "",
          started: false,
        };

        if (typeof toolCallRecord?.id === "string") {
          current.id = toolCallRecord.id;
        }

        const fn = readRecord(toolCallRecord?.function);
        if (typeof fn?.name === "string") {
          current.name = fn.name;
        }

        if (!current.started && current.name.length > 0) {
          current.started = true;
          yield {
            type: "tool-input-start",
            id: current.id,
            toolName: current.name,
          };
        }

        if (typeof fn?.arguments === "string" && fn.arguments.length > 0) {
          current.arguments += fn.arguments;
          yield {
            type: "tool-input-delta",
            id: current.id,
            delta: fn.arguments,
          };
        }

        toolCalls.set(index, current);
      }

      const normalizedFinishReason = normalizeOpenAIFinishReason(choice.finish_reason);
      if (normalizedFinishReason) {
        finishReason = normalizedFinishReason;
      }
    }
  }

  if (buffer.trim().length > 0) {
    const parsed = parseSseChunk(`${buffer}\n\n`);
    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }

      const record = readRecord(event);
      usage = extractOpenAIUsage(record) ?? usage;
    }
  }

  if (reasoningId) {
    yield {
      type: "reasoning-end",
      id: reasoningId,
    };
  }

  if (
    finishReason &&
    typeof finishReason === "object" &&
    finishReason.unified === "tool-calls"
  ) {
    for (const toolCall of toolCalls.values()) {
      yield {
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.arguments,
      };
    }
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}

// ---------------------------------------------------------------------------
// Responses API types and helpers
// ---------------------------------------------------------------------------

type OpenAIResponsesInputItem = Record<string, unknown>;

type OpenAIResponsesRequest = {
  model: string;
  input: OpenAIResponsesInputItem[];
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

/**
 * Convert the unified RuntimePromptMessage[] to the Responses API `input`
 * array shape. Differences from Chat Completions:
 *  - System prompts go on the top-level `instructions` field, not inline.
 *  - Content parts use `input_text` / `output_text` discriminants instead
 *    of the Chat Completions plain-text shorthand.
 *  - Assistant tool calls become standalone `function_call` items in the
 *    input array, not nested `tool_calls` on a message.
 *  - Tool results become standalone `function_call_output` items.
 *  - Reasoning content parts roundtrip as `reasoning` items so callers can
 *    replay multi-turn conversations with chain-of-thought intact.
 */
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
          content: [{ type: "input_text", text: readTextParts(message.content) }],
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
            // Reasoning items are top-level entries in the input array,
            // not nested inside the assistant message — flush whatever
            // text we've accumulated first, then push the reasoning item.
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
          // tool-call: flush message content, then push as standalone
          // function_call item per Responses API shape.
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

/**
 * Tools on the Responses API differ from Chat Completions: instead of
 * `{ type: "function", function: { name, parameters } }` the function
 * shape lifts the name/parameters/strict to the top of the entry. Native
 * tools (web_search, file_search, computer_use, code_interpreter) live
 * alongside function tools in the same array.
 */
function toOpenAIResponsesTools(
  tools: RuntimeToolDefinition[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools) return undefined;
  const normalized: Array<Record<string, unknown>> = [];
  for (const tool of tools) {
    if (tool.type === "function") {
      normalized.push({
        type: "function",
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        parameters: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }
    if (!tool.id.startsWith("openai.")) continue;
    const providerType = tool.id.slice("openai.".length);
    if (providerType.length === 0) continue;
    normalized.push({
      type: providerType,
      ...toSnakeCaseRecord(tool.args),
    });
  }
  return normalized.length > 0 ? normalized : undefined;
}

function buildOpenAIResponsesRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): OpenAIResponsesRequest {
  const isReasoningModel = isOpenAIReasoningModel(modelId);
  const reasoningEffort = resolveOpenAIReasoningEffort(options.reasoning);
  const reasoningEnabled = isReasoningModel || reasoningEffort !== undefined;

  // Same param-sanitization rules as Chat Completions: reasoning models
  // reject sampling params. Drop with a warning.
  if (options.topK !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "openai",
      setting: "topK",
      details: "OpenAI Responses API does not expose top_k; the value was dropped.",
    });
  }
  if (reasoningEnabled) {
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
          details:
            `Dropped because OpenAI reasoning models reject ${openaiName}. Reasoning was active for this request.`,
        });
      }
    }
  }

  const { instructions, input } = toOpenAIResponsesInput(options.prompt);
  const responsesTools = toOpenAIResponsesTools(options.tools);

  const body: OpenAIResponsesRequest = {
    model: modelId,
    input,
    ...(instructions !== undefined ? { instructions } : {}),
    ...(stream ? { stream: true } : {}),
    ...(options.maxOutputTokens !== undefined
      ? { max_output_tokens: options.maxOutputTokens }
      : {}),
    ...(!reasoningEnabled && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(!reasoningEnabled && options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(responsesTools ? { tools: responsesTools } : {}),
    ...(options.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {}),
    // The Responses API surfaces reasoning effort + summary verbosity
    // in a structured `reasoning` object instead of a flat field.
    ...(reasoningEffort !== undefined
      ? { reasoning: { effort: reasoningEffort, summary: "auto" } }
      : {}),
    ...(typeof options.userId === "string" && options.userId.length > 0
      ? { user: options.userId }
      : {}),
    ...(options.serviceTier !== undefined ? { service_tier: options.serviceTier } : {}),
    ...(options.parallelToolCalls !== undefined
      ? { parallel_tool_calls: options.parallelToolCalls }
      : {}),
    // Responses API uses `text.format` instead of Chat Completions'
    // `response_format`. The shape is similar but nested under `text`.
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

  Object.assign(body, readProviderOptions(options.providerOptions, "openai", providerName));
  return body;
}

/**
 * The Responses API uses `input_tokens` / `output_tokens` field names
 * instead of Chat Completions' `prompt_tokens` / `completion_tokens`.
 */
function extractOpenAIResponsesUsage(payload: unknown): RuntimeUsage | undefined {
  const record = readRecord(payload);
  // Streaming usage lives on response.completed inside `response.usage`;
  // non-streaming has it at the top level.
  const responseRecord = readRecord(record?.response);
  const usage = readRecord(responseRecord?.usage) ?? readRecord(record?.usage);
  if (!usage) return undefined;

  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === "number"
    ? usage.total_tokens
    : (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const inputDetails = readRecord(usage.input_tokens_details);
  const cachedTokens = inputDetails?.cached_tokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(typeof cachedTokens === "number" ? { cacheReadInputTokens: cachedTokens } : {}),
  };
}

function normalizeOpenAIResponsesFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") return null;
  switch (raw) {
    case "completed":
      return { unified: "stop", raw };
    case "incomplete":
      return { unified: "length", raw };
    case "failed":
      return { unified: "error", raw };
    case "in_progress":
      return null;
    default:
      return raw;
  }
}

type OpenAIResponsesContentPart =
  | { type: "text"; text: string }
  | {
    type: "reasoning";
    summaries?: Array<{ id?: string; text: string }>;
    signature?: string;
  }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string };

function buildOpenAIResponsesGenerateResult(payload: unknown): {
  content: OpenAIResponsesContentPart[];
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
} {
  const record = readRecord(payload);
  const output = Array.isArray(record?.output) ? record.output : [];
  const content: OpenAIResponsesContentPart[] = [];

  for (const item of output) {
    const itemRecord = readRecord(item);
    const itemType = typeof itemRecord?.type === "string" ? itemRecord.type : undefined;

    if (itemType === "message" && Array.isArray(itemRecord?.content)) {
      // A message item bundles one or more output_text parts.
      let text = "";
      for (const part of itemRecord.content) {
        const p = readRecord(part);
        if (typeof p?.type === "string" && p.type === "output_text" && typeof p.text === "string") {
          text += p.text;
        }
      }
      if (text.length > 0) {
        content.push({ type: "text", text });
      }
      continue;
    }

    if (itemType === "function_call") {
      content.push({
        type: "tool-call",
        toolCallId: typeof itemRecord?.call_id === "string"
          ? itemRecord.call_id
          : (typeof itemRecord?.id === "string" ? itemRecord.id : ""),
        toolName: typeof itemRecord?.name === "string" ? itemRecord.name : "",
        input: typeof itemRecord?.arguments === "string"
          ? itemRecord.arguments
          : stringifyJsonValue(itemRecord?.arguments ?? {}),
      });
      continue;
    }

    if (itemType === "reasoning") {
      const summary = Array.isArray(itemRecord?.summary) ? itemRecord.summary : [];
      const summaries: Array<{ id?: string; text: string }> = [];
      for (const s of summary) {
        const sr = readRecord(s);
        if (typeof sr?.text === "string" && sr.text.length > 0) {
          summaries.push({
            ...(typeof sr?.id === "string" ? { id: sr.id } : {}),
            text: sr.text,
          });
        }
      }
      content.push({
        type: "reasoning",
        ...(summaries.length > 0 ? { summaries } : {}),
        ...(typeof itemRecord?.encrypted_content === "string"
          ? { signature: itemRecord.encrypted_content }
          : {}),
      });
      continue;
    }
  }

  return {
    content,
    finishReason: normalizeOpenAIResponsesFinishReason(record?.status),
    usage: extractOpenAIResponsesUsage(payload),
  };
}

type OpenAIResponsesStreamReasoningState = {
  id: string;
  emittedStart: boolean;
};

type OpenAIResponsesStreamFunctionCallState = {
  id: string;
  toolCallId: string;
  name: string;
  arguments: string;
};

/**
 * Parse the Responses API streaming event grammar into the same UI part
 * shapes the existing OpenAI / Anthropic / Google streams emit.
 */
async function* streamOpenAIResponsesParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reasoningBlocks = new Map<string, OpenAIResponsesStreamReasoningState>();
  const functionCalls = new Map<string, OpenAIResponsesStreamFunctionCallState>();
  const startedToolCalls = new Set<string>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: RuntimeUsage | undefined;
  let reasoningCounter = 0;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event === "[DONE]") continue;
      const record = readRecord(event);
      const type = typeof record?.type === "string" ? record.type : undefined;
      if (!type) continue;

      // response.output_item.added: a new output item begins.
      if (type === "response.output_item.added") {
        const item = readRecord(record?.item);
        const itemType = typeof item?.type === "string" ? item.type : undefined;
        const itemId = typeof item?.id === "string" ? item.id : undefined;
        if (itemType === "function_call" && itemId) {
          const callId = typeof item?.call_id === "string" ? item.call_id : itemId;
          const name = typeof item?.name === "string" ? item.name : "";
          functionCalls.set(itemId, {
            id: itemId,
            toolCallId: callId,
            name,
            arguments: "",
          });
        }
        if (itemType === "reasoning" && itemId) {
          reasoningBlocks.set(itemId, {
            id: `reasoning-${reasoningCounter++}`,
            emittedStart: false,
          });
        }
        continue;
      }

      // response.output_text.delta: text chunk for a message item.
      if (type === "response.output_text.delta" && typeof record?.delta === "string") {
        if (record.delta.length > 0) {
          yield { type: "text-delta", delta: record.delta };
        }
        continue;
      }

      // response.reasoning_summary_text.delta: reasoning summary text chunk.
      if (type === "response.reasoning_summary_text.delta" && typeof record?.delta === "string") {
        const itemId = typeof record?.item_id === "string" ? record.item_id : undefined;
        const state = itemId ? reasoningBlocks.get(itemId) : undefined;
        if (state && record.delta.length > 0) {
          if (!state.emittedStart) {
            yield { type: "reasoning-start", id: state.id };
            state.emittedStart = true;
          }
          yield { type: "reasoning-delta", id: state.id, delta: record.delta };
        }
        continue;
      }

      // response.function_call_arguments.delta: tool call argument chunk.
      if (type === "response.function_call_arguments.delta" && typeof record?.delta === "string") {
        const itemId = typeof record?.item_id === "string" ? record.item_id : undefined;
        const state = itemId ? functionCalls.get(itemId) : undefined;
        if (state && record.delta.length > 0) {
          if (!startedToolCalls.has(state.id)) {
            yield {
              type: "tool-input-start",
              id: state.toolCallId,
              toolName: state.name,
            };
            startedToolCalls.add(state.id);
          }
          state.arguments += record.delta;
          yield {
            type: "tool-input-delta",
            id: state.toolCallId,
            delta: record.delta,
          };
        }
        continue;
      }

      // response.output_item.done: an item has finished emitting deltas.
      if (type === "response.output_item.done") {
        const item = readRecord(record?.item);
        const itemType = typeof item?.type === "string" ? item.type : undefined;
        const itemId = typeof item?.id === "string" ? item.id : undefined;
        if (itemType === "reasoning" && itemId) {
          const state = reasoningBlocks.get(itemId);
          if (state?.emittedStart) {
            yield { type: "reasoning-end", id: state.id };
          }
          reasoningBlocks.delete(itemId);
        }
        if (itemType === "function_call" && itemId) {
          const state = functionCalls.get(itemId);
          if (state) {
            yield {
              type: "tool-call",
              toolCallId: state.toolCallId,
              toolName: state.name,
              input: state.arguments,
            };
          }
          functionCalls.delete(itemId);
        }
        continue;
      }

      // response.completed: terminal event with the final response object.
      if (type === "response.completed") {
        usage = extractOpenAIResponsesUsage(record) ?? usage;
        const responseRecord = readRecord(record?.response);
        finishReason = normalizeOpenAIResponsesFinishReason(responseRecord?.status);
        continue;
      }

      if (type === "response.failed" || type === "response.incomplete") {
        const responseRecord = readRecord(record?.response);
        finishReason = normalizeOpenAIResponsesFinishReason(responseRecord?.status) ??
          (type === "response.failed"
            ? { unified: "error", raw: "failed" }
            : { unified: "length", raw: "incomplete" });
        usage = extractOpenAIResponsesUsage(record) ?? usage;
        continue;
      }
    }
  }

  // Close any reasoning streams still open at end-of-stream (defensive).
  for (const state of reasoningBlocks.values()) {
    if (state.emittedStart) {
      yield { type: "reasoning-end", id: state.id };
    }
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public factory functions
// ---------------------------------------------------------------------------

export function createOpenAIModelRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "openai",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIChatCompletionsUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIChatRequest(
        modelId,
        config.name ?? "openai",
        options,
        false,
        warnings,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((payload) => {
        const drained = warnings.drain();
        return {
          ...buildOpenAIGenerateResult(payload),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIChatCompletionsUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIChatRequest(
        modelId,
        config.name ?? "openai",
        options,
        true,
        warnings,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(
            withToolInputStatusTransitions(streamOpenAICompatibleParts(responseStream)),
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
  };
}

export function createOpenAIResponsesRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "openai",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIResponsesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIResponsesRequest(
        modelId,
        config.name ?? "openai",
        options,
        false,
        warnings,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((payload) => {
        const drained = warnings.drain();
        return {
          ...buildOpenAIResponsesGenerateResult(payload),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIResponsesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildOpenAIResponsesRequest(
        modelId,
        config.name ?? "openai",
        options,
        true,
        warnings,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          extraHeaders: options.headers,
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
      }).then((responseStream) => {
        const drained = warnings.drain();
        return {
          stream: ReadableStream.from(
            withToolInputStatusTransitions(streamOpenAIResponsesParts(responseStream)),
          ),
          ...(drained.length > 0 ? { warnings: drained } : {}),
        };
      });
    },
  };
}

export function createOpenAIEmbeddingRuntime(
  config: OpenAIRuntimeConfig,
  modelId: string,
): EmbeddingRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "openai",
    modelId,
    supportsParallelCalls: true,
    doEmbed({ values, abortSignal }) {
      if (values.length === 0) {
        return Promise.resolve({
          embeddings: [],
          warnings: [],
          rawResponse: { data: [] },
        });
      }

      const url = getOpenAIEmbeddingUrl(config.baseURL);
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        providerKind: "openai",
        init: createOpenAIRequestInit({
          apiKey: config.apiKey,
          body: JSON.stringify({
            model: modelId,
            input: values,
          }),
          signal: abortSignal,
        }),
      }).then((payload) => ({
        embeddings: extractOpenAIEmbeddings(payload),
        usage: {
          tokens: extractOpenAIUsageTokens(payload),
        },
        rawResponse: payload,
        warnings: [],
      }));
    },
  };
}

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIModelRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createEmbedding(modelId: string, config: AIProviderConfig): EmbeddingRuntime {
    return createOpenAIEmbeddingRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createResponses(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIResponsesRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
