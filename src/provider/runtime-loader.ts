import type { EmbeddingRuntime, ModelRuntime } from "./types.ts";

export interface OpenAIRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

export interface AnthropicRuntimeConfig {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

export interface GoogleRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

type RuntimePromptMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: Array<{ type: "text"; text: string }> }
  | {
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
        providerExecuted?: boolean;
      }
    >;
  }
  | {
    role: "tool";
    content: Array<{
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: { type: "json"; value: unknown };
    }>;
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
type AnthropicCompatibleMessage = {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
};
type AnthropicCompatibleRequest = {
  model: string;
  messages: AnthropicCompatibleMessage[];
  max_tokens: number;
  stream?: boolean;
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  [key: string]: unknown;
};
type AnthropicStreamToolCallState = {
  id: string;
  name: string;
  input: string;
  providerExecuted?: boolean;
};
type GoogleCompatibleContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};
type GoogleCompatibleRequest = {
  contents: GoogleCompatibleContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  tools?: Array<{
    functionDeclarations: Array<Record<string, unknown>>;
  }>;
  toolConfig?: {
    functionCallingConfig: Record<string, unknown>;
  };
  generationConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getOpenAIEmbeddingUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "embeddings");
}

function getAnthropicMessagesUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_ANTHROPIC_BASE_URL, "messages");
}

function getOpenAIChatCompletionsUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "chat/completions");
}

function getGoogleGenerateContentUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:generateContent`,
  );
}

function getGoogleStreamGenerateContentUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
  );
}

function getGoogleEmbeddingUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:embedContent`,
  );
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(value));
}

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

function extractGoogleEmbedding(payload: unknown): number[] {
  const record = readRecord(payload);
  const embeddings = record?.embeddings;

  if (Array.isArray(embeddings) && embeddings.length > 0) {
    const firstEmbedding = readRecord(embeddings[0]);
    const values = firstEmbedding?.values;
    if (isNumberArray(values)) {
      return values;
    }
  }

  const embedding = readRecord(record?.embedding);
  const values = embedding?.values;
  if (isNumberArray(values)) {
    return values;
  }

  throw new Error("Invalid Google embedding response: embedding vector missing");
}

function extractGoogleUsageTokens(payload: unknown): number | undefined {
  const record = readRecord(payload);
  const usageMetadata = readRecord(record?.usageMetadata);
  const promptTokenCount = usageMetadata?.promptTokenCount;
  return typeof promptTokenCount === "number" ? promptTokenCount : undefined;
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  return text.trim() || `${response.status} ${response.statusText}`.trim();
}

async function requestJson(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
}): Promise<unknown> {
  const response = await options.fetchImpl(options.url, options.init);
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(`${options.providerLabel} request failed: ${message}`);
  }

  return response.json();
}

async function requestStream(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
}): Promise<ReadableStream<Uint8Array>> {
  const response = await options.fetchImpl(options.url, options.init);
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(`${options.providerLabel} request failed: ${message}`);
  }

  if (!response.body) {
    throw new Error(`${options.providerLabel} request failed: stream body missing`);
  }

  return response.body;
}

function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function readTextParts(parts: Array<{ type: string; text?: string }>): string {
  let text = "";
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      text += part.text;
    }
  }
  return text;
}

function toOpenAICompatibleMessages(prompt: RuntimePromptMessage[]): OpenAICompatibleChatMessage[] {
  const messages: OpenAICompatibleChatMessage[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        messages.push({ role: "system", content: message.content });
        break;
      case "user":
        messages.push({ role: "user", content: readTextParts(message.content) });
        break;
      case "assistant": {
        let text = "";
        const toolCalls: NonNullable<
          Extract<OpenAICompatibleChatMessage, { role: "assistant" }>["tool_calls"]
        > = [];

        for (const part of message.content) {
          if (part.type === "text") {
            text += part.text;
            continue;
          }

          toolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: stringifyJsonValue(part.input),
            },
          });
        }

        messages.push({
          role: "assistant",
          content: text.length > 0 ? text : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
        break;
      }
      case "tool":
        for (const part of message.content) {
          messages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content: stringifyJsonValue(part.output.value),
          });
        }
        break;
    }
  }

  return messages;
}

function toOpenAICompatibleTools(
  tools: RuntimeToolDefinition[] | undefined,
): OpenAICompatibleChatRequest["tools"] | undefined {
  if (!tools) {
    return undefined;
  }

  const functions = tools.flatMap((tool) =>
    tool.type === "function"
      ? [{
        type: "function" as const,
        function: {
          name: tool.name,
          parameters: tool.inputSchema,
          ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        },
      }]
      : []
  );

  return functions.length > 0 ? functions : undefined;
}

function readProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
  ...providerNames: string[]
): Record<string, unknown> {
  if (!providerOptions) {
    return {};
  }

  const merged: Record<string, unknown> = {};
  for (const key of providerNames) {
    const value = providerOptions[key];
    const record = readRecord(value);
    if (record) {
      Object.assign(merged, record);
    }
  }

  return merged;
}

function createRequestHeaders(options: {
  apiKeyHeaderName: string;
  apiKey: string;
  extraHeaders?: HeadersInit;
}): Headers {
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set(options.apiKeyHeaderName, options.apiKey);
  return headers;
}

function normalizeAnthropicFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") {
    return null;
  }

  switch (raw) {
    case "tool_use":
      return { unified: "tool-calls", raw };
    case "end_turn":
    case "stop_sequence":
      return { unified: "stop", raw };
    case "max_tokens":
      return { unified: "length", raw };
    default:
      return raw;
  }
}

function extractAnthropicUsage(payload: unknown):
  | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof inputTokens === "number" || typeof outputTokens === "number"
      ? (typeof inputTokens === "number" ? inputTokens : 0) +
        (typeof outputTokens === "number" ? outputTokens : 0)
      : undefined,
  };
}

function mergeUsage(
  current:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined,
  next:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined,
): { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  const inputTokens = next.inputTokens ?? current.inputTokens;
  const outputTokens = next.outputTokens ?? current.outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
  };
}

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

function toAnthropicMessages(
  prompt: RuntimePromptMessage[],
): { system?: string; messages: AnthropicCompatibleMessage[] } {
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
        messages.push({
          role: "user",
          content: [{ type: "text", text: readTextParts(message.content) }],
        });
        break;
      case "assistant":
        messages.push({
          role: "assistant",
          content: message.content.map((part) =>
            part.type === "text" ? { type: "text", text: part.text } : {
              type: "tool_use",
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            }
          ),
        });
        break;
      case "tool":
        messages.push({
          role: "user",
          content: message.content.map((part) => ({
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: stringifyJsonValue(part.output.value),
          })),
        });
        break;
    }
  }

  return {
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    messages,
  };
}

function toAnthropicTools(
  tools: RuntimeToolDefinition[] | undefined,
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
        input_schema: tool.inputSchema,
      });
      continue;
    }

    if (!tool.id.startsWith("anthropic.")) {
      continue;
    }

    const providerType = tool.id.slice("anthropic.".length);
    if (providerType.length === 0) {
      continue;
    }

    normalized.push({
      type: providerType,
      name: tool.name,
      ...toSnakeCaseRecord(tool.args),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

function createAnthropicRequestHeaders(options: {
  apiKey?: string;
  authToken?: string;
  extraHeaders?: HeadersInit;
}): Headers {
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set("anthropic-version", headers.get("anthropic-version") ?? "2023-06-01");

  if (options.authToken) {
    headers.set("authorization", `Bearer ${options.authToken}`);
  } else if (options.apiKey) {
    headers.set("x-api-key", options.apiKey);
  }

  return headers;
}

function buildAnthropicMessagesRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
): AnthropicCompatibleRequest {
  const { system, messages } = toAnthropicMessages(options.prompt);
  const body: AnthropicCompatibleRequest = {
    model: modelId,
    messages,
    max_tokens: options.maxOutputTokens ?? 1024,
    ...(stream ? { stream: true } : {}),
    ...(system ? { system } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stop_sequences: options.stopSequences }
      : {}),
    ...(toAnthropicTools(options.tools) ? { tools: toAnthropicTools(options.tools) } : {}),
    ...(options.toolChoice !== undefined
      ? { tool_choice: normalizeAnthropicToolChoice(options.toolChoice) }
      : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "anthropic", providerName));
  return body;
}

function buildAnthropicGenerateResult(payload: unknown): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
    | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  >;
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
} {
  const record = readRecord(payload);
  const content = Array.isArray(record?.content) ? record.content : [];
  const normalized: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
    | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  > = [];

  for (const blockValue of content) {
    const block = readRecord(blockValue);
    const blockType = typeof block?.type === "string" ? block.type : undefined;

    if (blockType === "text" && typeof block?.text === "string" && block.text.length > 0) {
      normalized.push({ type: "text", text: block.text });
      continue;
    }

    if (
      (blockType === "tool_use" || blockType === "server_tool_use") &&
      typeof block?.id === "string" &&
      typeof block?.name === "string"
    ) {
      normalized.push({
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: stringifyJsonValue(block.input ?? {}),
      });
      continue;
    }

    if (
      blockType === "web_search_tool_result" &&
      typeof block?.tool_use_id === "string" &&
      Array.isArray(block?.content)
    ) {
      normalized.push({
        type: "tool-result",
        toolCallId: block.tool_use_id,
        toolName: "web_search",
        result: block.content,
      });
    }

    if (
      blockType === "web_fetch_tool_result" &&
      typeof block?.tool_use_id === "string" &&
      readRecord(block?.content)
    ) {
      normalized.push({
        type: "tool-result",
        toolCallId: block.tool_use_id,
        toolName: "web_fetch",
        result: block.content,
      });
    }
  }

  return {
    content: normalized,
    finishReason: normalizeAnthropicFinishReason(record?.stop_reason),
    usage: extractAnthropicUsage(payload),
  };
}

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

async function* streamAnthropicCompatibleParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, AnthropicStreamToolCallState>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }

      const record = readRecord(event);
      const eventType = typeof record?.type === "string" ? record.type : undefined;
      usage = mergeUsage(usage, extractAnthropicUsage(record));

      if (eventType === "message_start") {
        usage = mergeUsage(usage, extractAnthropicUsage(record?.message));
        continue;
      }

      if (eventType === "content_block_start") {
        const index = typeof record?.index === "number" ? record.index : 0;
        const contentBlock = readRecord(record?.content_block);
        const blockType = typeof contentBlock?.type === "string" ? contentBlock.type : undefined;

        if (
          blockType === "text" && typeof contentBlock?.text === "string" &&
          contentBlock.text.length > 0
        ) {
          yield { type: "text-delta", delta: contentBlock.text };
          continue;
        }

        if (
          (blockType === "tool_use" || blockType === "server_tool_use") &&
          typeof contentBlock?.id === "string" &&
          typeof contentBlock?.name === "string"
        ) {
          const providerExecuted = blockType === "server_tool_use" ? true : undefined;
          const current: AnthropicStreamToolCallState = {
            id: contentBlock.id,
            name: contentBlock.name,
            input: "",
            ...(providerExecuted ? { providerExecuted } : {}),
          };

          toolCalls.set(index, current);
          yield {
            type: "tool-input-start",
            id: current.id,
            toolName: current.name,
            ...(providerExecuted ? { providerExecuted } : {}),
          };

          const initialInput = contentBlock.input;
          if (initialInput !== undefined) {
            const serializedInput = stringifyJsonValue(initialInput);
            current.input += serializedInput;
            yield {
              type: "tool-input-delta",
              id: current.id,
              delta: serializedInput,
            };
          }
          continue;
        }

        if (
          blockType === "web_search_tool_result" &&
          typeof contentBlock?.tool_use_id === "string" &&
          Array.isArray(contentBlock?.content)
        ) {
          yield {
            type: "tool-result",
            toolCallId: contentBlock.tool_use_id,
            toolName: "web_search",
            result: contentBlock.content,
            providerExecuted: true,
          };
        }

        if (
          blockType === "web_fetch_tool_result" &&
          typeof contentBlock?.tool_use_id === "string" &&
          readRecord(contentBlock?.content)
        ) {
          yield {
            type: "tool-result",
            toolCallId: contentBlock.tool_use_id,
            toolName: "web_fetch",
            result: contentBlock.content,
            providerExecuted: true,
          };
        }

        continue;
      }

      if (eventType === "content_block_delta") {
        const index = typeof record?.index === "number" ? record.index : 0;
        const delta = readRecord(record?.delta);
        const deltaType = typeof delta?.type === "string" ? delta.type : undefined;

        if (
          deltaType === "text_delta" && typeof delta?.text === "string" && delta.text.length > 0
        ) {
          yield { type: "text-delta", delta: delta.text };
          continue;
        }

        if (deltaType === "input_json_delta" && typeof delta?.partial_json === "string") {
          const current = toolCalls.get(index);
          if (!current) {
            continue;
          }

          current.input += delta.partial_json;
          yield {
            type: "tool-input-delta",
            id: current.id,
            delta: delta.partial_json,
          };
        }

        continue;
      }

      if (eventType === "content_block_stop") {
        const index = typeof record?.index === "number" ? record.index : 0;
        const current = toolCalls.get(index);
        if (!current) {
          continue;
        }

        yield {
          type: "tool-call",
          toolCallId: current.id,
          toolName: current.name,
          input: current.input.length > 0 ? current.input : "{}",
          ...(current.providerExecuted ? { providerExecuted: true } : {}),
        };
        toolCalls.delete(index);
        continue;
      }

      if (eventType === "message_delta") {
        const delta = readRecord(record?.delta);
        const normalizedFinishReason = normalizeAnthropicFinishReason(delta?.stop_reason);
        if (normalizedFinishReason) {
          finishReason = normalizedFinishReason;
        }
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
      usage = mergeUsage(usage, extractAnthropicUsage(record));
    }
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
}

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

function extractOpenAIUsage(payload: unknown):
  | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
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

function buildOpenAIChatRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
): OpenAICompatibleChatRequest {
  const body: OpenAICompatibleChatRequest = {
    model: modelId,
    messages: toOpenAICompatibleMessages(options.prompt),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(options.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stop: options.stopSequences }
      : {}),
    ...(toOpenAICompatibleTools(options.tools)
      ? { tools: toOpenAICompatibleTools(options.tools) }
      : {}),
    ...(options.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.presencePenalty !== undefined ? { presence_penalty: options.presencePenalty } : {}),
    ...(options.frequencyPenalty !== undefined
      ? { frequency_penalty: options.frequencyPenalty }
      : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "openai", providerName));
  return body;
}

function normalizeGoogleFinishReason(
  raw: unknown,
): string | { unified: string; raw: string } | null {
  if (typeof raw !== "string") {
    return null;
  }

  switch (raw) {
    case "STOP":
      return { unified: "stop", raw };
    case "MAX_TOKENS":
      return { unified: "length", raw };
    case "SAFETY":
    case "RECITATION":
      return { unified: "content-filter", raw };
    default:
      return raw.toLowerCase();
  }
}

function extractGoogleUsage(payload: unknown):
  | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usageMetadata);
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.promptTokenCount;
  const outputTokens = usage.candidatesTokenCount;
  const totalTokens = usage.totalTokenCount;

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
    outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
  };
}

function toGoogleContents(
  prompt: RuntimePromptMessage[],
): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GoogleCompatibleContent[];
} {
  const systemParts: string[] = [];
  const contents: GoogleCompatibleContent[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        if (message.content.length > 0) {
          systemParts.push(message.content);
        }
        break;
      case "user":
        contents.push({
          role: "user",
          parts: [{ text: readTextParts(message.content) }],
        });
        break;
      case "assistant":
        contents.push({
          role: "model",
          parts: message.content.map((part) =>
            part.type === "text" ? { text: part.text } : {
              functionCall: {
                id: part.toolCallId,
                name: part.toolName,
                args: part.input,
              },
            }
          ),
        });
        break;
      case "tool":
        contents.push({
          role: "user",
          parts: message.content.map((part) => ({
            functionResponse: {
              id: part.toolCallId,
              name: part.toolName,
              response: {
                result: part.output.value,
              },
            },
          })),
        });
        break;
    }
  }

  return {
    ...(systemParts.length > 0
      ? { systemInstruction: { parts: systemParts.map((text) => ({ text })) } }
      : {}),
    contents,
  };
}

function toGoogleTools(
  tools: RuntimeToolDefinition[] | undefined,
): GoogleCompatibleRequest["tools"] | undefined {
  if (!tools) {
    return undefined;
  }

  const functionDeclarations = tools.flatMap((tool) =>
    tool.type === "function"
      ? [{
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        parameters: tool.inputSchema,
      }]
      : []
  );

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;
}

function normalizeGoogleToolChoice(toolChoice: unknown):
  | GoogleCompatibleRequest["toolConfig"]
  | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "none":
        return { functionCallingConfig: { mode: "NONE" } };
      case "any":
      case "required":
        return { functionCallingConfig: { mode: "ANY" } };
      default:
        return { functionCallingConfig: { mode: "AUTO" } };
    }
  }

  const record = readRecord(toolChoice);
  if (record?.type === "tool" && typeof record.name === "string") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [record.name],
      },
    };
  }

  return undefined;
}

function buildGoogleGenerationConfig(
  options: OpenAICompatibleLanguageOptions,
): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { topP: options.topP } : {}),
    ...(options.topK !== undefined ? { topK: options.topK } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stopSequences: options.stopSequences }
      : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  };

  return Object.keys(config).length > 0 ? config : undefined;
}

function buildGoogleGenerateContentRequest(
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
): GoogleCompatibleRequest {
  const { systemInstruction, contents } = toGoogleContents(options.prompt);
  const body: GoogleCompatibleRequest = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(toGoogleTools(options.tools) ? { tools: toGoogleTools(options.tools) } : {}),
    ...(normalizeGoogleToolChoice(options.toolChoice)
      ? { toolConfig: normalizeGoogleToolChoice(options.toolChoice) }
      : {}),
    ...(buildGoogleGenerationConfig(options)
      ? { generationConfig: buildGoogleGenerationConfig(options) }
      : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "google", providerName));
  return body;
}

function extractFirstGoogleCandidate(payload: unknown): Record<string, unknown> | undefined {
  const record = readRecord(payload);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return undefined;
  }

  return readRecord(candidates[0]);
}

function extractGoogleCandidateParts(payload: unknown): Array<Record<string, unknown>> {
  const candidate = extractFirstGoogleCandidate(payload);
  const content = readRecord(candidate?.content);
  const parts = content?.parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts.flatMap((part) => {
    const record = readRecord(part);
    return record ? [record] : [];
  });
}

function buildGoogleGenerateResult(payload: unknown): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  >;
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
} {
  const parts = extractGoogleCandidateParts(payload);
  const content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  > = [];

  for (const [index, part] of parts.entries()) {
    if (typeof part.text === "string" && part.text.length > 0) {
      content.push({ type: "text", text: part.text });
      continue;
    }

    const functionCall = readRecord(part.functionCall);
    if (typeof functionCall?.name === "string") {
      content.push({
        type: "tool-call",
        toolCallId: typeof functionCall.id === "string" ? functionCall.id : `tool-${index}`,
        toolName: functionCall.name,
        input: stringifyJsonValue(functionCall.args ?? {}),
      });
    }
  }

  return {
    content,
    finishReason: normalizeGoogleFinishReason(extractFirstGoogleCandidate(payload)?.finishReason),
    usage: extractGoogleUsage(payload),
  };
}

async function* streamGoogleCompatibleParts(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const seenToolCalls = new Set<string>();
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }

      usage = extractGoogleUsage(event) ?? usage;
      const candidate = extractFirstGoogleCandidate(event);
      const normalizedFinishReason = normalizeGoogleFinishReason(candidate?.finishReason);
      if (normalizedFinishReason) {
        finishReason = normalizedFinishReason;
      }

      for (const [index, part] of extractGoogleCandidateParts(event).entries()) {
        if (typeof part.text === "string" && part.text.length > 0) {
          yield { type: "text-delta", delta: part.text };
          continue;
        }

        const functionCall = readRecord(part.functionCall);
        if (typeof functionCall?.name !== "string") {
          continue;
        }

        const toolCallId = typeof functionCall.id === "string" ? functionCall.id : `tool-${index}`;
        if (seenToolCalls.has(toolCallId)) {
          continue;
        }

        const serializedInput = stringifyJsonValue(functionCall.args ?? {});
        seenToolCalls.add(toolCallId);
        yield {
          type: "tool-input-start",
          id: toolCallId,
          toolName: functionCall.name,
        };
        yield {
          type: "tool-input-delta",
          id: toolCallId,
          delta: serializedInput,
        };
        yield {
          type: "tool-call",
          toolCallId,
          toolName: functionCall.name,
          input: serializedInput,
        };
      }
    }
  }

  if (buffer.trim().length > 0) {
    const parsed = parseSseChunk(`${buffer}\n\n`);
    for (const event of parsed.events) {
      if (event === "[DONE]") {
        continue;
      }
      usage = extractGoogleUsage(event) ?? usage;
    }
  }

  yield {
    type: "finish",
    finishReason,
    ...(usage ? { usage } : {}),
  };
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
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
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
  let finishReason: string | { unified: string; raw: string } | null = null;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

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
      const choices = Array.isArray(record?.choices) ? record.choices : [];

      for (const choiceValue of choices) {
        const choice = readRecord(choiceValue);
        if (!choice) {
          continue;
        }

        const delta = readRecord(choice.delta);
        const textDelta = extractOpenAIContentText(delta?.content);
        if (textDelta.length > 0) {
          yield { type: "text-delta", delta: textDelta };
        }

        const rawToolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
        for (const rawToolCall of rawToolCalls) {
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
      const body = buildOpenAIChatRequest(modelId, config.name ?? "openai", options, false);
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        init: {
          method: "POST",
          headers: createRequestHeaders({
            apiKeyHeaderName: "authorization",
            apiKey: `Bearer ${config.apiKey}`,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then(buildOpenAIGenerateResult);
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getOpenAIChatCompletionsUrl(config.baseURL);
      const body = buildOpenAIChatRequest(modelId, config.name ?? "openai", options, true);
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "openai",
        init: {
          method: "POST",
          headers: createRequestHeaders({
            apiKeyHeaderName: "authorization",
            apiKey: `Bearer ${config.apiKey}`,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then((responseStream) => ({
        stream: ReadableStream.from(streamOpenAICompatibleParts(responseStream)),
      }));
    },
  };
}

export function createAnthropicModelRuntime(
  config: AnthropicRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "anthropic",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getAnthropicMessagesUrl(config.baseURL);
      const body = buildAnthropicMessagesRequest(
        modelId,
        config.name ?? "anthropic",
        options,
        false,
      );
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "anthropic",
        init: {
          method: "POST",
          headers: createAnthropicRequestHeaders({
            apiKey: config.apiKey,
            authToken: config.authToken,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then(buildAnthropicGenerateResult);
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getAnthropicMessagesUrl(config.baseURL);
      const body = buildAnthropicMessagesRequest(
        modelId,
        config.name ?? "anthropic",
        options,
        true,
      );
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "anthropic",
        init: {
          method: "POST",
          headers: createAnthropicRequestHeaders({
            apiKey: config.apiKey,
            authToken: config.authToken,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then((responseStream) => ({
        stream: ReadableStream.from(streamAnthropicCompatibleParts(responseStream)),
      }));
    },
  };
}

export function createGoogleModelRuntime(
  config: GoogleRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "google",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getGoogleGenerateContentUrl(config.baseURL, modelId);
      const body = buildGoogleGenerateContentRequest(config.name ?? "google", options);
      return requestJson({
        url,
        fetchImpl,
        providerLabel: config.name ?? "google",
        init: {
          method: "POST",
          headers: createRequestHeaders({
            apiKeyHeaderName: "x-goog-api-key",
            apiKey: config.apiKey,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then(buildGoogleGenerateResult);
    },
    doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getGoogleStreamGenerateContentUrl(config.baseURL, modelId);
      const body = buildGoogleGenerateContentRequest(config.name ?? "google", options);
      return requestStream({
        url,
        fetchImpl,
        providerLabel: config.name ?? "google",
        init: {
          method: "POST",
          headers: createRequestHeaders({
            apiKeyHeaderName: "x-goog-api-key",
            apiKey: config.apiKey,
            extraHeaders: options.headers,
          }),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        },
      }).then((responseStream) => ({
        stream: ReadableStream.from(streamGoogleCompatibleParts(responseStream)),
      }));
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
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            input: values,
          }),
          signal: abortSignal,
        },
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

export function createGoogleEmbeddingRuntime(
  config: GoogleRuntimeConfig,
  modelId: string,
): EmbeddingRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    provider: config.name ?? "google",
    modelId,
    supportsParallelCalls: true,
    doEmbed({ values, abortSignal }) {
      if (values.length === 0) {
        return Promise.resolve({
          embeddings: [],
          warnings: [],
          rawResponse: { embeddings: [] },
        });
      }

      const url = getGoogleEmbeddingUrl(config.baseURL, modelId);
      return Promise.all(values.map((value) =>
        requestJson({
          url,
          fetchImpl,
          providerLabel: config.name ?? "google",
          init: {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": config.apiKey,
            },
            body: JSON.stringify({
              content: {
                parts: [{ text: value }],
              },
            }),
            signal: abortSignal,
          },
        })
      )).then((payloads) => ({
        embeddings: payloads.map(extractGoogleEmbedding),
        usage: {
          tokens: payloads.reduce<number>(
            (total, payload) => total + (extractGoogleUsageTokens(payload) ?? 0),
            0,
          ),
        },
        rawResponse: payloads,
        warnings: [],
      }));
    },
  };
}
