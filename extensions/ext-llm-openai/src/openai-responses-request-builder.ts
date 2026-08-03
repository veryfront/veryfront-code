import {
  jsonValuesEqual,
  readProviderOptions,
  stringifyToolArguments,
  stringifyToolResultValue,
  unwrapToolInputSchema,
} from "veryfront/provider/shared";
import type {
  ModelRuntimePromptMessage,
  ModelRuntimeToolDefinition,
} from "veryfront/provider/shared";
import type { OpenAICompatibleLanguageOptions } from "./openai-chat-request-builder.ts";
import {
  rejectsOpenAISamplingParams,
  resolveOpenAIReasoningConfig,
  shouldRequestOpenAIReasoningSummary,
} from "./openai-reasoning-models.ts";
import { defineOpenAIProviderOptions } from "./openai-provider-options.ts";
import {
  isBoundedOpenAIStreamString,
  MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
} from "./openai-stream-metadata.ts";
import {
  normalizeOpenAIWebSearchCall,
  OPENAI_REASONING_ENCRYPTED_CONTENT_INCLUDE,
  OPENAI_WEB_SEARCH_SOURCES_INCLUDE,
  readOpenAIRawResponseOutputItems,
  resolveOpenAIWebSearchDescriptor,
} from "./openai-web-search.ts";
import type { OpenAIWebSearchDescriptor } from "./openai-web-search.ts";

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

type CanonicalProviderCall = {
  id: string;
  name: string;
  input: unknown;
};

type CanonicalProviderResult = {
  id: string;
  name: string;
  result: unknown;
  isError: boolean;
};

function invalidOpenAIProviderHistory(): TypeError {
  return new TypeError(
    "OpenAI raw response metadata did not match canonical provider tool history",
  );
}

function assertUniqueOpenAIToolCallIds(
  calls: readonly { readonly id: string }[],
): void {
  const seen = new Set<string>();
  for (const call of calls) {
    if (seen.has(call.id)) {
      throw invalidOpenAIProviderHistory();
    }
    seen.add(call.id);
  }
}

function assertOrderedOpenAIToolCallsEqual(
  left: readonly CanonicalProviderCall[],
  right: readonly CanonicalProviderCall[],
): void {
  if (left.length !== right.length) {
    throw invalidOpenAIProviderHistory();
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftCall = left[index];
    const rightCall = right[index];
    if (
      !leftCall ||
      !rightCall ||
      leftCall.id !== rightCall.id ||
      leftCall.name !== rightCall.name ||
      !jsonValuesEqual(leftCall.input, rightCall.input, true)
    ) {
      throw invalidOpenAIProviderHistory();
    }
  }
}

function validateOpenAIProviderReplay(
  message: Extract<ModelRuntimePromptMessage, { readonly role: "assistant" }>,
  rawOutputItems: readonly Record<string, unknown>[],
): void {
  const metadataProviderCalls = (message.providerToolCalls ?? []).map((call) => ({
    id: call.toolCallId,
    name: call.toolName,
    input: call.input,
  }));
  const contentProviderCalls: CanonicalProviderCall[] = [];
  const clientCalls: CanonicalProviderCall[] = [];
  const providerResults: CanonicalProviderResult[] = [];
  const contentCallKinds: Array<"provider" | "client"> = [];

  for (const part of message.content) {
    if (part.type === "tool-call") {
      const providerExecuted = part.providerExecuted === true;
      const target = providerExecuted ? contentProviderCalls : clientCalls;
      target.push({
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      });
      contentCallKinds.push(providerExecuted ? "provider" : "client");
      continue;
    }
    if (part.type === "tool-result" && part.providerExecuted === true) {
      providerResults.push({
        id: part.toolCallId,
        name: part.toolName,
        result: part.result,
        isError: part.isError === true,
      });
    }
  }

  assertUniqueOpenAIToolCallIds(metadataProviderCalls);
  assertUniqueOpenAIToolCallIds(contentProviderCalls);
  assertUniqueOpenAIToolCallIds(clientCalls);

  const seenProviderResultIds = new Set<string>();
  for (const result of providerResults) {
    if (seenProviderResultIds.has(result.id)) {
      throw invalidOpenAIProviderHistory();
    }
    seenProviderResultIds.add(result.id);
  }

  // providerToolCalls is the legacy projection of provider-executed content.
  // Coalesce it only after proving both surviving projections are identical
  // occurrence-for-occurrence; duplicates or a different order are ambiguous.
  if (
    metadataProviderCalls.length > 0 &&
    contentProviderCalls.length > 0
  ) {
    assertOrderedOpenAIToolCallsEqual(
      metadataProviderCalls,
      contentProviderCalls,
    );
  }
  const providerCalls = metadataProviderCalls.length > 0
    ? metadataProviderCalls
    : contentProviderCalls;

  const rawProviderCalls: Array<{
    id: string;
    input: unknown;
    result: unknown;
    isError: boolean;
  }> = [];
  const rawClientCalls: CanonicalProviderCall[] = [];
  const rawCallKinds: Array<"provider" | "client"> = [];
  for (const item of rawOutputItems) {
    if (item.type === "web_search_call") {
      const call = normalizeOpenAIWebSearchCall(
        item,
        () => invalidOpenAIProviderHistory(),
      );
      rawProviderCalls.push({
        id: call.id,
        input: call.input,
        result: call.result,
        isError: call.isError,
      });
      rawCallKinds.push("provider");
      continue;
    }
    if (item.type === "function_call") {
      if (
        typeof item.call_id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.arguments !== "string"
      ) {
        throw invalidOpenAIProviderHistory();
      }
      rawClientCalls.push({
        id: item.call_id,
        name: item.name,
        input: item.arguments,
      });
      rawCallKinds.push("client");
    }
  }

  // The provider parser rejects duplicate call ids across both provider- and
  // client-executed tools. Exact replay must enforce the same invariant even
  // for legacy metadata that predates that parser check.
  assertUniqueOpenAIToolCallIds([
    ...rawProviderCalls,
    ...rawClientCalls,
  ]);

  if (providerCalls.length > 0) {
    if (providerCalls.length !== rawProviderCalls.length) {
      throw invalidOpenAIProviderHistory();
    }
    for (let index = 0; index < providerCalls.length; index += 1) {
      const canonical = providerCalls[index];
      const raw = rawProviderCalls[index];
      if (
        !canonical ||
        !raw ||
        canonical.id !== raw.id ||
        !jsonValuesEqual(canonical.input, raw.input, true)
      ) {
        throw invalidOpenAIProviderHistory();
      }
    }
  }

  if (providerResults.length > 0) {
    if (providerResults.length !== rawProviderCalls.length) {
      throw invalidOpenAIProviderHistory();
    }
    for (let index = 0; index < providerResults.length; index += 1) {
      const canonical = providerResults[index];
      const raw = rawProviderCalls[index];
      if (
        !canonical ||
        !raw ||
        canonical.id !== raw.id ||
        canonical.isError !== raw.isError ||
        !jsonValuesEqual(canonical.result, raw.result)
      ) {
        throw invalidOpenAIProviderHistory();
      }
    }
  }

  const historicalProviderName = providerCalls[0]?.name ?? providerResults[0]?.name;
  if (
    historicalProviderName !== undefined &&
    (
      !isBoundedOpenAIStreamString(
        historicalProviderName,
        MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
      ) ||
      providerCalls.some((call) => call.name !== historicalProviderName) ||
      providerResults.some((result) => result.name !== historicalProviderName)
    )
  ) {
    throw invalidOpenAIProviderHistory();
  }

  // Ordinary function calls have an exact provider-native representation.
  // If their canonical projection survived compaction, correlate it in order;
  // otherwise the already-validated raw items remain the legacy source of
  // truth.
  if (clientCalls.length > 0) {
    assertOrderedOpenAIToolCallsEqual(clientCalls, rawClientCalls);
  }

  // providerToolCalls has no position relative to ordinary content calls. When
  // both kinds survive in assistant content, however, their complete
  // interleaving is observable and must match the raw item order. If either
  // content projection was compacted, only its per-kind order can be proven;
  // the exact raw item sequence remains authoritative for transmission.
  if (contentProviderCalls.length > 0 && clientCalls.length > 0) {
    if (
      contentCallKinds.length !== rawCallKinds.length ||
      contentCallKinds.some((kind, index) => kind !== rawCallKinds[index])
    ) {
      throw invalidOpenAIProviderHistory();
    }
  }
}

function toOpenAIResponsesInput(
  prompt: readonly ModelRuntimePromptMessage[],
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
        const rawOutputItems = readOpenAIRawResponseOutputItems(message.providerMetadata);
        if (rawOutputItems) {
          validateOpenAIProviderReplay(message, rawOutputItems);
          input.push(...rawOutputItems);
          break;
        }
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
          if (part.type === "tool-result") {
            throw new TypeError(
              "OpenAI provider-executed assistant tool results require exact raw replay metadata",
            );
          }
          if (part.providerExecuted === true) {
            throw new TypeError(
              "OpenAI provider-executed assistant tool calls require exact raw replay metadata",
            );
          }
          if (messageContent.length > 0) {
            input.push({ role: "assistant", content: [...messageContent] });
            messageContent.length = 0;
          }
          input.push({
            type: "function_call",
            call_id: part.toolCallId,
            name: part.toolName,
            arguments: stringifyToolArguments(part.input),
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
            output: stringifyToolResultValue(part.output.value),
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
  parts: Extract<ModelRuntimePromptMessage, { readonly role: "user" }>["content"],
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
  tools: readonly ModelRuntimeToolDefinition[] | undefined,
  webSearch: OpenAIWebSearchDescriptor | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools) return undefined;
  const normalized: Array<Record<string, unknown>> = [];
  let addedWebSearch = false;
  for (const tool of tools) {
    if (tool.type === "function") {
      normalized.push({
        type: "function",
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        // Responses otherwise attempts to normalize omitted strictness into
        // strict mode, which turns every declared property into a required
        // argument. Runtime and remote tool schemas use normal JSON Schema
        // optional properties, so preserve that contract explicitly.
        strict: false,
        parameters: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }
    if (!tool.id.startsWith("openai.")) continue;
    if (webSearch && !addedWebSearch) {
      normalized.push(webSearch.requestTool);
      addedWebSearch = true;
    }
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

  const webSearch = resolveOpenAIWebSearchDescriptor(options.tools);
  const { instructions, input } = toOpenAIResponsesInput(options.prompt);
  const responsesTools = toOpenAIResponsesTools(options.tools, webSearch);

  const body: OpenAIResponsesRequest = {
    model: modelId,
    input,
    // Stay stateless and preserve the complete provider history explicitly below.
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
  defineOpenAIProviderOptions(
    body as Record<string, unknown>,
    readProviderOptions(
      options.providerOptions,
      ...(providerName === "openai" ? ["openai-compatible"] : []),
      "openai",
      providerName,
    ),
  );
  // Keep provider-native tuning extensible without allowing raw options to
  // replace the runtime-owned transport, prompt, model, or privacy contract.
  body.model = modelId;
  body.input = input;
  body.store = false;
  if (instructions !== undefined) {
    body.instructions = instructions;
  } else {
    delete body.instructions;
  }
  if (stream) {
    body.stream = true;
  } else {
    delete body.stream;
  }
  const requiredIncludes = [
    ...(reasoning ? [OPENAI_REASONING_ENCRYPTED_CONTENT_INCLUDE] : []),
    ...(webSearch ? [OPENAI_WEB_SEARCH_SOURCES_INCLUDE] : []),
  ];
  if (requiredIncludes.length > 0) {
    const providerIncludes = Array.isArray(body.include)
      ? body.include.filter((value): value is string => typeof value === "string")
      : [];
    body.include = [
      ...new Set([
        ...providerIncludes,
        ...requiredIncludes,
      ]),
    ];
  }
  if (Object.hasOwn(body, "background")) {
    delete body.background;
    warnings.push({
      type: "unsupported-setting",
      provider: "openai",
      setting: "background",
      details:
        "Background Responses are asynchronous and cannot satisfy the runtime's immediate result contract; the value was dropped.",
    });
  }
  return body;
}
