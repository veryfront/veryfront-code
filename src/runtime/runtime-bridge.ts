/**
 * Runtime Bridge
 *
 * Centralizes the framework's current runtime edge behind one internal
 * module. Higher-level framework code imports framework-owned runtime
 * types and calls into this bridge at the edge.
 */
import type { TextGenerationRuntimeMessage } from "#veryfront/agent/runtime/text-generation-runtime-message-types.ts";
import { readOwnDataProperty } from "#veryfront/agent/runtime/data-property-descriptor.ts";
import { createRuntimeProviderStreamFailure } from "#veryfront/runtime/provider-stream-error-provenance.ts";
import { snapshotProviderJsonValue } from "#veryfront/provider/runtime-loader/json-snapshot.ts";
import { recordErrorCount } from "#veryfront/observability/metrics/index.ts";
import { serverLogger } from "#veryfront/utils";
import type {
  RuntimeGenerateTextResult,
  RuntimeStreamPart,
  RuntimeStreamResult,
  RuntimeToolCallRepairFunction,
  RuntimeToolSet,
} from "#veryfront/agent/runtime/runtime-tool-types.ts";
import type {
  EmbeddingRuntime,
  ModelRuntime,
  ModelRuntimeGenerateResult,
  RuntimeResponseFormat,
} from "#veryfront/provider/types.ts";
import {
  getModelRuntimeId,
  supportsModelRuntimeStructuredOutput,
} from "#veryfront/provider/runtime-inspection.ts";
import { NOT_SUPPORTED } from "#veryfront/errors";
import type { RuntimeReasoningOption } from "#veryfront/agent/types.ts";
import { resolveOpenAIReasoningConfig } from "#veryfront/provider/shared/openai-reasoning.ts";
import { DurableRunEventPersistenceError } from "#veryfront/agent/conversation/private-run-event.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import type {
  AgentRunModelCallContextEvent,
  ModelCallMessage,
  ModelCallRequest,
  ModelCallTool,
} from "./model-call-context.ts";
import { getActiveRunEventSinks } from "./run-event-sink-context.ts";

const cloneStructuredValue = globalThis.structuredClone;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const logger = serverLogger.component("runtime-bridge");

type GenerateTextOptions = {
  model: ModelRuntime;
  system?: unknown;
  messages: TextGenerationRuntimeMessage[];
  tools?: RuntimeToolSet;
  experimental_repairToolCall?: RuntimeToolCallRepairFunction;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  toolChoice?: unknown;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  reasoning?: RuntimeReasoningOption;
  responseFormat?: RuntimeResponseFormat;
  abortSignal?: AbortSignal;
};

type StreamTextOptions = {
  model: ModelRuntime;
  system?: unknown;
  messages: TextGenerationRuntimeMessage[];
  tools?: RuntimeToolSet;
  experimental_repairToolCall?: RuntimeToolCallRepairFunction;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  toolChoice?: unknown;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  reasoning?: RuntimeReasoningOption;
  responseFormat?: RuntimeResponseFormat;
  includeRawChunks?: boolean;
  abortSignal?: AbortSignal;
};

type EmbedOptions = {
  model: EmbeddingRuntime;
  value: string;
  abortSignal?: AbortSignal;
};

type EmbedManyOptions = {
  model: EmbeddingRuntime;
  values: string[];
  abortSignal?: AbortSignal;
};

type DirectGenerateUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: "gateway" | "missing" | "partial";
  billingMode?: "direct" | "deferred";
  usageCaptureStatus?: "complete" | "partial" | "missing";
};

type DirectGenerateResult = {
  content?: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
    | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
    }
    | Record<string, unknown>
  >;
  finishReason?: string | { unified?: string | null } | null;
  usage?: unknown;
  providerMetadata?: Record<string, unknown>;
};

type DirectStreamResult = {
  stream: ReadableStream<unknown>;
};
type DirectTextOptions = GenerateTextOptions | StreamTextOptions;
type DirectModelMessage =
  | Exclude<ModelCallMessage, { role: "assistant" }>
  | (Extract<ModelCallMessage, { role: "assistant" }> & {
    providerMetadata?: Record<string, unknown>;
  });
type ModelCallRequestSource = Pick<
  GenerateTextOptions,
  | "maxOutputTokens"
  | "temperature"
  | "topP"
  | "topK"
  | "stopSequences"
  | "seed"
  | "presencePenalty"
  | "frequencyPenalty"
  | "reasoning"
>;
type DirectModelOptions = Record<string, unknown> & {
  prompt: DirectModelMessage[];
  tools?: ModelCallTool[];
} & ModelCallRequestSource;

function readSystemProviderOptions(
  system: unknown,
): Record<string, unknown> | undefined {
  if (!system || typeof system !== "object") return undefined;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      system,
      "providerOptions",
    ]) as PropertyDescriptor | undefined;
  } catch {
    throw new TypeError(
      "System message providerOptions must be an own enumerable data property",
    );
  }

  if (descriptor === undefined) return undefined;
  if (!ObjectHasOwn(descriptor, "value") || descriptor.enumerable !== true) {
    throw new TypeError(
      "System message providerOptions must be an own enumerable data property",
    );
  }

  const providerOptions = descriptor.value;
  return providerOptions && typeof providerOptions === "object" &&
      !Array.isArray(providerOptions)
    ? providerOptions as Record<string, unknown>
    : undefined;
}

function readSystemContent(system: unknown): string | undefined {
  if (!system || typeof system !== "object") return undefined;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      system,
      "content",
    ]) as PropertyDescriptor | undefined;
  } catch {
    throw new TypeError(
      "System message content must be an own enumerable data property",
    );
  }

  if (descriptor === undefined) return undefined;
  if (!ObjectHasOwn(descriptor, "value") || descriptor.enumerable !== true) {
    throw new TypeError(
      "System message content must be an own enumerable data property",
    );
  }
  return typeof descriptor.value === "string" ? descriptor.value : undefined;
}

function normalizeSystemMessages(system: GenerateTextOptions["system"]): ChatSystemMessage[] {
  if (typeof system === "string") {
    return system.length > 0 ? [{ role: "system", content: system }] : [];
  }

  if (!system || typeof system !== "object") {
    return [];
  }

  const content = readSystemContent(system);
  if (content !== undefined) {
    const providerOptions = readSystemProviderOptions(system);
    return [{
      role: "system",
      content,
      ...(providerOptions ? { providerOptions } : {}),
    }];
  }

  if (Array.isArray(system)) {
    const messages: ChatSystemMessage[] = [];
    for (const entry of system) {
      if (!entry || typeof entry !== "object") continue;
      const entryContent = readSystemContent(entry);
      if (entryContent === undefined) continue;
      const providerOptions = readSystemProviderOptions(entry);
      messages.push({
        role: "system",
        content: entryContent,
        ...(providerOptions ? { providerOptions } : {}),
      });
    }
    return messages;
  }

  return [];
}

function getProviderRequestMessages(
  messages: TextGenerationRuntimeMessage[],
): TextGenerationRuntimeMessage[] {
  const requestMessages = [...messages];

  while (requestMessages.at(-1)?.role === "assistant") {
    requestMessages.pop();
  }

  return requestMessages;
}

function toRuntimePrompt(
  system: readonly ChatSystemMessage[],
  messages: TextGenerationRuntimeMessage[],
): DirectModelMessage[] {
  const prompt: DirectModelMessage[] = system.map((message) => ({
    role: "system",
    content: message.content,
    ...(message.providerOptions === undefined ? {} : { providerOptions: message.providerOptions }),
  }));

  for (const message of messages) {
    switch (message.role) {
      case "system":
        prompt.push({ role: "system", content: message.content });
        break;
      case "user":
        prompt.push({
          role: "user",
          content: typeof message.content === "string"
            ? [{ type: "text", text: message.content }]
            : message.content,
        });
        break;
      case "assistant":
        prompt.push({
          role: "assistant",
          content: message.content.map((part) =>
            part.type === "text" ? { type: "text" as const, text: part.text } : {
              type: "tool-call" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            }
          ),
          ...(message.providerMetadata === undefined
            ? {}
            : { providerMetadata: message.providerMetadata }),
        });
        break;
      case "tool":
        prompt.push({
          role: "tool",
          content: message.content.map((part) => ({
            type: "tool-result" as const,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
          })),
        });
        break;
    }
  }

  return prompt;
}

type PersistedCacheControl = {
  type: "ephemeral";
  ttl?: "5m" | "1h";
};

function readOwnEnumerableDataDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
  } catch {
    return undefined;
  }
  return descriptor?.enumerable === true && ObjectHasOwn(descriptor, "value")
    ? descriptor
    : undefined;
}

function sanitizePersistedCacheControl(value: unknown): PersistedCacheControl | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const type = readOwnEnumerableDataDescriptor(value, "type");
  if (type?.value !== "ephemeral") {
    return undefined;
  }
  const ttl = readOwnEnumerableDataDescriptor(value, "ttl");
  if (ttl && ttl.value !== undefined && ttl.value !== "5m" && ttl.value !== "1h") {
    return undefined;
  }
  return {
    type: "ephemeral",
    ...(ttl?.value === "5m" || ttl?.value === "1h" ? { ttl: ttl.value } : {}),
  };
}

function sanitizePersistedProviderOptions(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  let keys: PropertyKey[];
  try {
    keys = ReflectApply(ReflectOwnKeys, undefined, [value]) as PropertyKey[];
  } catch {
    return undefined;
  }
  const sanitized: Record<string, unknown> = {};
  let retained = false;
  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0) {
      continue;
    }
    const providerBucket = readOwnEnumerableDataDescriptor(value, key)?.value;
    if (!providerBucket || typeof providerBucket !== "object" || Array.isArray(providerBucket)) {
      continue;
    }
    const cacheControl = sanitizePersistedCacheControl(
      readOwnEnumerableDataDescriptor(providerBucket, "cacheControl")?.value,
    );
    if (!cacheControl) {
      continue;
    }
    ReflectApply(ObjectDefineProperty, undefined, [sanitized, key, {
      configurable: true,
      enumerable: true,
      value: { cacheControl },
      writable: true,
    }]);
    retained = true;
  }
  return retained ? sanitized : undefined;
}

function sanitizeModelCallContextMessages(
  messages: readonly DirectModelMessage[],
): ModelCallMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return { role: "assistant", content: message.content };
    }
    if (message.role !== "system") {
      return message;
    }
    const providerOptions = sanitizePersistedProviderOptions(message.providerOptions);
    return {
      role: "system",
      content: message.content,
      ...(providerOptions ? { providerOptions } : {}),
    };
  });
}

function normalizeUsage(usage: unknown): DirectGenerateUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  if ("inputTokens" in usage && typeof usage.inputTokens === "object" && usage.inputTokens) {
    const inputTokens = "total" in usage.inputTokens && typeof usage.inputTokens.total === "number"
      ? usage.inputTokens.total
      : undefined;
    const cacheReadInputTokens =
      "cached" in usage.inputTokens && typeof usage.inputTokens.cached === "number"
        ? usage.inputTokens.cached
        : "cacheRead" in usage.inputTokens && typeof usage.inputTokens.cacheRead === "number"
        ? usage.inputTokens.cacheRead
        : undefined;
    const cacheCreationInputTokens =
      "cacheCreation" in usage.inputTokens && typeof usage.inputTokens.cacheCreation === "number"
        ? usage.inputTokens.cacheCreation
        : undefined;
    const outputTokens =
      "outputTokens" in usage && typeof usage.outputTokens === "object" && usage.outputTokens &&
        "total" in usage.outputTokens && typeof usage.outputTokens.total === "number"
        ? usage.outputTokens.total
        : undefined;
    const reasoningTokens =
      "outputTokens" in usage && typeof usage.outputTokens === "object" && usage.outputTokens &&
        "reasoning" in usage.outputTokens && typeof usage.outputTokens.reasoning === "number"
        ? usage.outputTokens.reasoning
        : undefined;
    return {
      inputTokens,
      outputTokens,
      totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
      ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
      ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
      ...(cacheReadInputTokens !== undefined ? { cachedInputTokens: cacheReadInputTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    };
  }

  const flatUsage = usage as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    billableInputTokens?: number;
    billableOutputTokens?: number;
    costUsd?: number;
    providerInputCostUsd?: number;
    providerOutputCostUsd?: number;
    providerCostUsd?: number;
    veryfrontInputChargeUsd?: number;
    veryfrontOutputChargeUsd?: number;
    veryfrontChargeUsd?: number;
    veryfrontBilledUsd?: number;
    costCredits?: number;
    costSource?: unknown;
    billingMode?: unknown;
    usageCaptureStatus?: unknown;
  };
  const costSource = flatUsage.costSource;
  const billingMode = flatUsage.billingMode;
  const usageCaptureStatus = flatUsage.usageCaptureStatus;

  return {
    inputTokens: flatUsage.inputTokens,
    outputTokens: flatUsage.outputTokens,
    totalTokens: flatUsage.totalTokens,
    ...(typeof flatUsage.cacheCreationInputTokens === "number"
      ? { cacheCreationInputTokens: flatUsage.cacheCreationInputTokens }
      : {}),
    ...(typeof flatUsage.cacheReadInputTokens === "number"
      ? { cacheReadInputTokens: flatUsage.cacheReadInputTokens }
      : {}),
    ...(typeof flatUsage.cachedInputTokens === "number"
      ? { cachedInputTokens: flatUsage.cachedInputTokens }
      : typeof flatUsage.cacheReadInputTokens === "number"
      ? { cachedInputTokens: flatUsage.cacheReadInputTokens }
      : {}),
    ...(typeof flatUsage.reasoningTokens === "number"
      ? { reasoningTokens: flatUsage.reasoningTokens }
      : {}),
    ...(typeof flatUsage.billableInputTokens === "number"
      ? { billableInputTokens: flatUsage.billableInputTokens }
      : {}),
    ...(typeof flatUsage.billableOutputTokens === "number"
      ? { billableOutputTokens: flatUsage.billableOutputTokens }
      : {}),
    ...(typeof flatUsage.costUsd === "number" ? { costUsd: flatUsage.costUsd } : {}),
    ...(typeof flatUsage.providerInputCostUsd === "number"
      ? { providerInputCostUsd: flatUsage.providerInputCostUsd }
      : {}),
    ...(typeof flatUsage.providerOutputCostUsd === "number"
      ? { providerOutputCostUsd: flatUsage.providerOutputCostUsd }
      : {}),
    ...(typeof flatUsage.providerCostUsd === "number"
      ? { providerCostUsd: flatUsage.providerCostUsd }
      : {}),
    ...(typeof flatUsage.veryfrontInputChargeUsd === "number"
      ? { veryfrontInputChargeUsd: flatUsage.veryfrontInputChargeUsd }
      : {}),
    ...(typeof flatUsage.veryfrontOutputChargeUsd === "number"
      ? { veryfrontOutputChargeUsd: flatUsage.veryfrontOutputChargeUsd }
      : {}),
    ...(typeof flatUsage.veryfrontChargeUsd === "number"
      ? { veryfrontChargeUsd: flatUsage.veryfrontChargeUsd }
      : {}),
    ...(typeof flatUsage.veryfrontBilledUsd === "number"
      ? { veryfrontBilledUsd: flatUsage.veryfrontBilledUsd }
      : {}),
    ...(typeof flatUsage.costCredits === "number" ? { costCredits: flatUsage.costCredits } : {}),
    ...(costSource === "gateway" || costSource === "missing" || costSource === "partial"
      ? { costSource }
      : {}),
    ...(billingMode === "direct" || billingMode === "deferred" ? { billingMode } : {}),
    ...(usageCaptureStatus === "complete" ||
        usageCaptureStatus === "missing" ||
        usageCaptureStatus === "partial"
      ? { usageCaptureStatus }
      : {}),
  };
}

function normalizeFinishReason(finishReason: unknown): string | null {
  if (typeof finishReason === "string") {
    return finishReason;
  }

  if (finishReason && typeof finishReason === "object" && "unified" in finishReason) {
    return typeof finishReason.unified === "string" ? finishReason.unified : null;
  }

  return null;
}

function shouldGenerateViaStream(model: ModelRuntime): boolean {
  return model._generateViaStream === true;
}

function parseToolCallInput(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function isRuntimeProviderToolDefinition(
  value: unknown,
): value is {
  type: "provider";
  id: `${string}.${string}`;
  args: Record<string, unknown>;
} {
  return !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "provider" &&
    "id" in value &&
    typeof value.id === "string" &&
    "args" in value &&
    typeof value.args === "object" &&
    value.args !== null &&
    !Array.isArray(value.args);
}

function isRuntimeFunctionToolDefinition(
  value: unknown,
): value is {
  description?: string;
  inputSchema: {
    jsonSchema: unknown;
  };
} {
  return !!value &&
    typeof value === "object" &&
    "inputSchema" in value &&
    !!value.inputSchema &&
    typeof value.inputSchema === "object" &&
    "jsonSchema" in value.inputSchema;
}

async function resolveDirectTools(
  tools: RuntimeToolSet | undefined,
): Promise<ModelCallTool[] | undefined> {
  if (!tools) {
    return undefined;
  }

  const resolvedTools: ModelCallTool[] = [];

  for (const [name, definition] of Object.entries(tools)) {
    if (isRuntimeProviderToolDefinition(definition)) {
      resolvedTools.push({
        type: "provider",
        name,
        id: definition.id,
        args: definition.args,
      });
      continue;
    }

    if (!isRuntimeFunctionToolDefinition(definition)) {
      continue;
    }

    const inputSchema = await Promise.resolve(definition.inputSchema.jsonSchema);
    resolvedTools.push({
      type: "function",
      name,
      ...(typeof definition.description === "string"
        ? { description: definition.description }
        : {}),
      inputSchema,
    });
  }

  return resolvedTools.length > 0 ? resolvedTools : undefined;
}

/**
 * Reject a requested response format the resolved runtime cannot honor.
 *
 * Both generation paths converge on `buildDirectModelOptions`, so this is the
 * one place where a schema would otherwise be handed to a provider that
 * silently ignores it and returns prose.
 */
function assertStructuredOutputSupported(options: DirectTextOptions): void {
  const responseFormat = options.responseFormat;
  if (!responseFormat || responseFormat.type === "text") return;
  if (supportsModelRuntimeStructuredOutput(options.model, responseFormat)) return;
  throw NOT_SUPPORTED.create({
    detail: `Model "${
      getModelRuntimeId(options.model) ?? "unknown"
    }" does not support structured output format "${responseFormat.type}", so it cannot be applied.`,
  });
}

function buildDirectModelOptions(
  options: DirectTextOptions,
  tools: ModelCallTool[] | undefined,
): DirectModelOptions {
  assertStructuredOutputSupported(options);
  return {
    prompt: toRuntimePrompt(
      normalizeSystemMessages(options.system),
      getProviderRequestMessages(options.messages),
    ),
    maxOutputTokens: options.maxOutputTokens,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    topP: options.topP,
    topK: options.topK,
    stopSequences: options.stopSequences,
    ...(tools ? { tools } : {}),
    ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.presencePenalty !== undefined ? { presencePenalty: options.presencePenalty } : {}),
    ...(options.frequencyPenalty !== undefined
      ? { frequencyPenalty: options.frequencyPenalty }
      : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
    ...("includeRawChunks" in options && options.includeRawChunks !== undefined
      ? { includeRawChunks: options.includeRawChunks }
      : {}),
    abortSignal: options.abortSignal,
  };
}

function buildModelCallRequest(
  options: ModelCallRequestSource,
  reasoning = options.reasoning,
): ModelCallRequest | undefined {
  const projectedReasoning = reasoning
    ? {
      ...(reasoning.enabled !== undefined ? { enabled: reasoning.enabled } : {}),
      ...(reasoning.effort !== undefined ? { effort: reasoning.effort } : {}),
      ...(reasoning.budgetTokens !== undefined ? { budgetTokens: reasoning.budgetTokens } : {}),
    }
    : undefined;
  const request: ModelCallRequest = {
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { topP: options.topP } : {}),
    ...(options.topK !== undefined ? { topK: options.topK } : {}),
    ...(options.stopSequences !== undefined ? { stopSequences: [...options.stopSequences] } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.presencePenalty !== undefined ? { presencePenalty: options.presencePenalty } : {}),
    ...(options.frequencyPenalty !== undefined
      ? { frequencyPenalty: options.frequencyPenalty }
      : {}),
    ...(projectedReasoning && Object.keys(projectedReasoning).length > 0
      ? { reasoning: projectedReasoning }
      : {}),
  };
  return Object.keys(request).length > 0 ? request : undefined;
}

function resolveModelProvider(model: ModelRuntime): string | undefined {
  if (typeof model.modelProvider === "string" && model.modelProvider !== "") {
    return model.modelProvider;
  }
  return model.provider === "veryfront-cloud" ? undefined : model.provider;
}

function resolvePersistedReasoning(
  model: ModelRuntime,
  options: DirectModelOptions,
): RuntimeReasoningOption | undefined {
  const modelProvider = resolveModelProvider(model);
  if (modelProvider === "openai" && typeof model.modelId === "string") {
    const reasoning = resolveOpenAIReasoningConfig(model.modelId, modelProvider, options.reasoning);
    return reasoning ? { enabled: true, effort: reasoning.effort } : options.reasoning;
  }

  // The Anthropic request builder only gives neutral reasoning precedence when
  // it enables thinking; otherwise a raw provider thinking config remains effective.
  if (modelProvider !== "anthropic" || options.reasoning?.enabled === true) {
    return options.reasoning;
  }

  const providerOptions = options.providerOptions;
  if (!providerOptions || typeof providerOptions !== "object" || Array.isArray(providerOptions)) {
    return options.reasoning;
  }
  const anthropic = readOwnEnumerableDataDescriptor(providerOptions, "anthropic")?.value;
  if (!anthropic || typeof anthropic !== "object" || Array.isArray(anthropic)) {
    return options.reasoning;
  }
  const thinking = readOwnEnumerableDataDescriptor(anthropic, "thinking")?.value;
  if (!thinking || typeof thinking !== "object" || Array.isArray(thinking)) {
    return options.reasoning;
  }
  const thinkingType = readOwnEnumerableDataDescriptor(thinking, "type")?.value;
  if (thinkingType === "disabled") {
    return { enabled: false };
  }
  if (thinkingType !== "adaptive" && thinkingType !== "enabled") {
    return options.reasoning;
  }

  if (thinkingType === "enabled") {
    const budgetTokens = readOwnEnumerableDataDescriptor(thinking, "budget_tokens")?.value;
    return {
      enabled: true,
      ...(typeof budgetTokens === "number" && Number.isInteger(budgetTokens) && budgetTokens >= 0
        ? { budgetTokens }
        : {}),
    };
  }

  const outputConfig = readOwnEnumerableDataDescriptor(anthropic, "output_config")?.value;
  const effort = outputConfig && typeof outputConfig === "object" && !Array.isArray(outputConfig)
    ? readOwnEnumerableDataDescriptor(outputConfig, "effort")?.value
    : undefined;
  return {
    enabled: true,
    ...(effort === "low" || effort === "medium" || effort === "high" || effort === "max"
      ? { effort }
      : {}),
  };
}

async function emitModelCallContextEvent(
  options: DirectTextOptions,
  directOptions: DirectModelOptions,
): Promise<void> {
  const sinks = getActiveRunEventSinks();
  if (!sinks.mandatory && !sinks.public) return;
  const request = buildModelCallRequest(
    directOptions,
    resolvePersistedReasoning(options.model, directOptions),
  );

  const event: AgentRunModelCallContextEvent = {
    type: "AGENT_RUN_MODEL_CALL_CONTEXT",
    ...(options.model.modelId
      ? {
        model: {
          id: options.model.modelId,
          ...(resolveModelProvider(options.model)
            ? { modelProvider: resolveModelProvider(options.model) }
            : {}),
        },
      }
      : {}),
    ...(request ? { request } : {}),
    messages: sanitizeModelCallContextMessages(directOptions.prompt),
    ...(directOptions.tools ? { tools: directOptions.tools } : {}),
  };

  const cloneEvent = ():
    | { ok: true; event: AgentRunModelCallContextEvent }
    | { ok: false; error: unknown } => {
    try {
      return { ok: true, event: cloneStructuredValue(event) };
    } catch (error) {
      const failureClass = error instanceof DOMException && error.name === "DataCloneError"
        ? "DataCloneError"
        : "unknown";
      recordErrorCount({
        slug: "model-call-context-clone-failed",
        failure_class: failureClass,
      });
      logger.warn("Model call context event was not persisted because it is not cloneable", {
        failureClass,
      });
      return { ok: false, error };
    }
  };
  const mandatoryClone = sinks.mandatory ? cloneEvent() : undefined;
  if (mandatoryClone?.ok === false) {
    throw new DurableRunEventPersistenceError(
      "Mandatory model call context event is not cloneable",
      { cause: mandatoryClone.error },
    );
  }
  const mandatoryEvent = mandatoryClone?.ok ? mandatoryClone.event : undefined;
  const publicClone = sinks.public && sinks.public !== sinks.mandatory ? cloneEvent() : undefined;
  const publicEvent = publicClone?.ok ? publicClone.event : undefined;
  if (sinks.mandatory && mandatoryEvent) {
    await sinks.mandatory(mandatoryEvent);
  }
  if (sinks.public && sinks.public !== sinks.mandatory && publicEvent) {
    await sinks.public(publicEvent);
  }
}

function isDirectToolCallPart(
  part: unknown,
): part is { type: "tool-call"; toolCallId: string; toolName: string; input: unknown } {
  return !!part &&
    typeof part === "object" &&
    "type" in part &&
    part.type === "tool-call" &&
    "toolCallId" in part &&
    typeof part.toolCallId === "string" &&
    "toolName" in part &&
    typeof part.toolName === "string";
}

function isDirectTextPart(part: unknown): part is { type: "text"; text: string } {
  return !!part &&
    typeof part === "object" &&
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string";
}

function isDirectToolResultPart(
  part: unknown,
): part is {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  providerExecuted?: boolean;
} {
  return !!part &&
    typeof part === "object" &&
    "type" in part &&
    part.type === "tool-result" &&
    "toolCallId" in part &&
    typeof part.toolCallId === "string" &&
    "toolName" in part &&
    typeof part.toolName === "string" &&
    "result" in part;
}

function buildDirectGenerateResult(
  result: ModelRuntimeGenerateResult | DirectGenerateResult,
): RuntimeGenerateTextResult {
  let text = "";
  const toolCalls: RuntimeGenerateTextResult["toolCalls"] = [];
  const toolResults: RuntimeGenerateTextResult["toolResults"] = [];

  for (const part of result.content ?? []) {
    if (isDirectTextPart(part)) {
      text += part.text;
      continue;
    }

    if (isDirectToolCallPart(part)) {
      toolCalls.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: parseToolCallInput(part.input),
      });
    }

    if (isDirectToolResultPart(part)) {
      toolResults.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: part.result,
        ...(part.isError === true ? { isError: true } : {}),
        ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
      });
    }
  }

  return {
    text,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(toolResults.length > 0 ? { toolResults } : {}),
    usage: normalizeUsage(result.usage),
    finishReason: normalizeFinishReason(result.finishReason),
    ...(result.providerMetadata === undefined ? {} : { providerMetadata: result.providerMetadata }),
  };
}

function streamUsageToGenerateUsage(
  totalUsage: Extract<RuntimeStreamPart, { type: "finish" }>["totalUsage"],
): RuntimeGenerateTextResult["usage"] {
  if (!totalUsage) {
    return undefined;
  }

  const inputTokens = totalUsage.inputTokens;
  const outputTokens = totalUsage.outputTokens;
  const totalTokens = totalUsage.totalTokens ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);

  return {
    inputTokens,
    outputTokens,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(totalUsage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: totalUsage.cacheCreationInputTokens }
      : {}),
    ...(totalUsage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: totalUsage.cacheReadInputTokens }
      : {}),
    ...(totalUsage.cachedInputTokens !== undefined
      ? { cachedInputTokens: totalUsage.cachedInputTokens }
      : {}),
    ...(totalUsage.reasoningTokens !== undefined
      ? { reasoningTokens: totalUsage.reasoningTokens }
      : {}),
    ...(totalUsage.billableInputTokens !== undefined
      ? { billableInputTokens: totalUsage.billableInputTokens }
      : {}),
    ...(totalUsage.billableOutputTokens !== undefined
      ? { billableOutputTokens: totalUsage.billableOutputTokens }
      : {}),
    ...(totalUsage.costUsd !== undefined ? { costUsd: totalUsage.costUsd } : {}),
    ...(totalUsage.providerInputCostUsd !== undefined
      ? { providerInputCostUsd: totalUsage.providerInputCostUsd }
      : {}),
    ...(totalUsage.providerOutputCostUsd !== undefined
      ? { providerOutputCostUsd: totalUsage.providerOutputCostUsd }
      : {}),
    ...(totalUsage.providerCostUsd !== undefined
      ? { providerCostUsd: totalUsage.providerCostUsd }
      : {}),
    ...(totalUsage.veryfrontInputChargeUsd !== undefined
      ? { veryfrontInputChargeUsd: totalUsage.veryfrontInputChargeUsd }
      : {}),
    ...(totalUsage.veryfrontOutputChargeUsd !== undefined
      ? { veryfrontOutputChargeUsd: totalUsage.veryfrontOutputChargeUsd }
      : {}),
    ...(totalUsage.veryfrontChargeUsd !== undefined
      ? { veryfrontChargeUsd: totalUsage.veryfrontChargeUsd }
      : {}),
    ...(totalUsage.veryfrontBilledUsd !== undefined
      ? { veryfrontBilledUsd: totalUsage.veryfrontBilledUsd }
      : {}),
    ...(totalUsage.costCredits !== undefined ? { costCredits: totalUsage.costCredits } : {}),
    ...(totalUsage.costSource !== undefined ? { costSource: totalUsage.costSource } : {}),
    ...(totalUsage.billingMode !== undefined ? { billingMode: totalUsage.billingMode } : {}),
    ...(totalUsage.usageCaptureStatus !== undefined
      ? { usageCaptureStatus: totalUsage.usageCaptureStatus }
      : {}),
  };
}

async function buildGenerateResultFromStream(
  stream: ReadableStream<unknown>,
): Promise<RuntimeGenerateTextResult> {
  let text = "";
  let usage: RuntimeGenerateTextResult["usage"];
  let finishReason: string | null = null;
  let providerMetadata: Record<string, unknown> | undefined;
  const toolCalls = new Map<string, NonNullable<RuntimeGenerateTextResult["toolCalls"]>[number]>();
  const toolInputs = new Map<string, { toolCallId: string; toolName: string; input: string }>();
  const toolResults: NonNullable<RuntimeGenerateTextResult["toolResults"]> = [];

  for await (const rawPart of mapReadableStream(stream)) {
    if (!rawPart || typeof rawPart !== "object" || !("type" in rawPart)) {
      continue;
    }

    const part = rawPart as RuntimeStreamPart;

    switch (part.type) {
      case "text-delta":
        text += part.text;
        break;

      case "tool-input-start":
        toolInputs.set(part.id, {
          toolCallId: part.id,
          toolName: part.toolName,
          input: "",
        });
        break;

      case "tool-input-delta": {
        const input = toolInputs.get(part.id);
        if (input) {
          input.input += part.delta;
        }
        break;
      }

      case "tool-input-end": {
        const input = toolInputs.get(part.id);
        if (input) {
          toolCalls.set(input.toolCallId, {
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            input: parseToolCallInput(input.input),
          });
        }
        break;
      }

      case "tool-input-available": {
        const toolCallId = part.toolCallId ?? part.id;
        if (toolCallId) {
          toolCalls.set(toolCallId, {
            toolCallId,
            toolName: part.toolName,
            input: parseToolCallInput(part.input),
          });
        }
        break;
      }

      case "tool-call":
        toolCalls.set(part.toolCallId, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: parseToolCallInput(part.input),
        });
        break;

      case "tool-result": {
        const result = part.result ?? part.output ?? part.error;
        toolResults.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result,
          ...(part.isError === true || part.error !== undefined ? { isError: true } : {}),
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
        });
        break;
      }

      case "tool-error":
        toolResults.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result: part.error,
          isError: true,
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
        });
        break;

      case "finish":
        finishReason = part.finishReason ?? null;
        usage = streamUsageToGenerateUsage(part.totalUsage);
        providerMetadata = part.providerMetadata;
        break;
    }
  }

  const finalToolCalls = [...toolCalls.values()];

  return {
    text,
    ...(finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : {}),
    ...(toolResults.length > 0 ? { toolResults } : {}),
    usage,
    finishReason,
    ...(providerMetadata === undefined ? {} : { providerMetadata }),
  };
}

function materializeProviderJsonField(value: unknown): unknown {
  return value === undefined ? undefined : cloneStructuredValue(snapshotProviderJsonValue(value, {
    dropUndefinedMembers: true,
  }));
}

function materializeRuntimeStreamPart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const label = "Provider stream part";
  const read = (key: string, required = false) => readOwnDataProperty(part, key, label, required);
  const optional = (key: string, value = read(key)) => value === undefined ? {} : { [key]: value };
  const type = read("type", true);
  if (typeof type !== "string") return { type };

  if (type.startsWith("data-")) {
    return { type, data: materializeProviderJsonField(read("data")) };
  }

  switch (type) {
    case "text-delta": {
      const delta = read("delta");
      return { type, text: typeof delta === "string" ? delta : read("text") };
    }
    case "reasoning-start":
      return { type, id: read("id") };
    case "reasoning-delta":
      return { type, id: read("id"), delta: read("delta") };
    case "reasoning-end":
      return {
        type,
        id: read("id"),
        ...optional("signature"),
        ...optional("redactedData"),
      };
    case "tool-input-start":
      return {
        type,
        id: read("id"),
        toolName: read("toolName"),
        ...optional("providerExecuted"),
        ...optional("dynamic"),
      };
    case "tool-input-delta":
      return { type, id: read("id"), delta: read("delta") };
    case "tool-input-end":
      return { type, id: read("id") };
    case "tool-input-available":
    case "tool-call":
      return {
        type,
        ...optional("toolCallId"),
        ...optional("id"),
        toolName: read("toolName"),
        input: materializeProviderJsonField(read("input")),
        ...optional("providerExecuted"),
        ...optional("dynamic"),
      };
    case "tool-result":
      return {
        type,
        toolCallId: read("toolCallId"),
        toolName: read("toolName"),
        ...optional("output", materializeProviderJsonField(read("output"))),
        ...optional("result", materializeProviderJsonField(read("result"))),
        ...optional("error"),
        ...optional("input", materializeProviderJsonField(read("input"))),
        ...optional("providerExecuted"),
        ...optional("dynamic"),
        ...optional("preliminary"),
        ...optional("isError"),
      };
    case "tool-error":
      return {
        type,
        toolCallId: read("toolCallId"),
        toolName: read("toolName"),
        ...optional("error"),
        ...optional("input", materializeProviderJsonField(read("input"))),
        ...optional("providerExecuted"),
        ...optional("dynamic"),
        ...optional("preliminary"),
        ...optional("isError"),
      };
    case "error":
      return { type, error: read("error") };
    case "finish":
      break;
    default:
      return { type };
  }

  const usage = normalizeUsage(materializeProviderJsonField(read("usage"))) ??
    normalizeUsage(materializeProviderJsonField(read("totalUsage")));
  const providerMetadata = materializeProviderJsonField(read("providerMetadata"));
  const recomputedTotal = usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : undefined;

  return {
    type: "finish",
    finishReason: normalizeFinishReason(read("finishReason")),
    ...(providerMetadata === undefined ? {} : { providerMetadata }),
    ...(usage
      ? {
        totalUsage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(usage.totalTokens !== undefined && usage.totalTokens !== recomputedTotal
            ? { totalTokens: usage.totalTokens }
            : {}),
          ...(usage.cacheCreationInputTokens !== undefined
            ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
            : {}),
          ...(usage.cacheReadInputTokens !== undefined
            ? { cacheReadInputTokens: usage.cacheReadInputTokens }
            : {}),
          ...(usage.cachedInputTokens !== undefined
            ? { cachedInputTokens: usage.cachedInputTokens }
            : {}),
          ...(usage.reasoningTokens !== undefined
            ? { reasoningTokens: usage.reasoningTokens }
            : {}),
          ...(usage.billableInputTokens !== undefined
            ? { billableInputTokens: usage.billableInputTokens }
            : {}),
          ...(usage.billableOutputTokens !== undefined
            ? { billableOutputTokens: usage.billableOutputTokens }
            : {}),
          ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
          ...(usage.providerInputCostUsd !== undefined
            ? { providerInputCostUsd: usage.providerInputCostUsd }
            : {}),
          ...(usage.providerOutputCostUsd !== undefined
            ? { providerOutputCostUsd: usage.providerOutputCostUsd }
            : {}),
          ...(usage.providerCostUsd !== undefined
            ? { providerCostUsd: usage.providerCostUsd }
            : {}),
          ...(usage.veryfrontInputChargeUsd !== undefined
            ? { veryfrontInputChargeUsd: usage.veryfrontInputChargeUsd }
            : {}),
          ...(usage.veryfrontOutputChargeUsd !== undefined
            ? { veryfrontOutputChargeUsd: usage.veryfrontOutputChargeUsd }
            : {}),
          ...(usage.veryfrontChargeUsd !== undefined
            ? { veryfrontChargeUsd: usage.veryfrontChargeUsd }
            : {}),
          ...(usage.veryfrontBilledUsd !== undefined
            ? { veryfrontBilledUsd: usage.veryfrontBilledUsd }
            : {}),
          ...(usage.costCredits !== undefined ? { costCredits: usage.costCredits } : {}),
          ...(usage.costSource !== undefined ? { costSource: usage.costSource } : {}),
          ...(usage.billingMode !== undefined ? { billingMode: usage.billingMode } : {}),
          ...(usage.usageCaptureStatus !== undefined
            ? { usageCaptureStatus: usage.usageCaptureStatus }
            : {}),
        },
      }
      : {}),
  };
}

async function* mapReadableStream(stream: ReadableStream<unknown>): AsyncIterable<unknown> {
  for await (const part of stream) {
    try {
      const materializedPart = materializeRuntimeStreamPart(part);
      if (
        typeof materializedPart === "object" && materializedPart !== null &&
        (materializedPart as { type?: unknown }).type === "error"
      ) {
        throw createRuntimeProviderStreamFailure(
          (materializedPart as { error?: unknown }).error,
        );
      }
      yield materializedPart;
    } catch (error) {
      throw createRuntimeProviderStreamFailure(error);
    }
  }
}

async function* textDeltasFromStream(stream: ReadableStream<unknown>): AsyncIterable<string> {
  for await (const part of stream) {
    try {
      if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text-delta") {
        continue;
      }

      if ("text" in part && typeof part.text === "string") {
        yield part.text;
        continue;
      }

      if ("delta" in part && typeof part.delta === "string") {
        yield part.delta;
      }
    } catch (error) {
      throw createRuntimeProviderStreamFailure(error);
    }
  }
}

export function generateText(options: GenerateTextOptions): PromiseLike<RuntimeGenerateTextResult> {
  return resolveDirectTools(options.tools).then(async (tools) => {
    const directOptions = buildDirectModelOptions(options, tools);
    await emitModelCallContextEvent(options, directOptions);
    if (shouldGenerateViaStream(options.model)) {
      return options.model.doStream(directOptions).then(({ stream }) =>
        buildGenerateResultFromStream(stream)
      );
    }

    return options.model.doGenerate(directOptions).then(buildDirectGenerateResult);
  });
}

export function streamText(options: StreamTextOptions): RuntimeStreamResult {
  const directResultPromise = resolveDirectTools(options.tools).then(async (tools) => {
    const directOptions = buildDirectModelOptions(options, tools);
    await emitModelCallContextEvent(options, directOptions);
    return options.model.doStream(directOptions);
  });
  // Guard against an unhandled rejection when a branch is consumed lazily (or a
  // branch is never consumed at all) and doStream rejects.
  directResultPromise.catch(() => {});

  const hasStarted: Record<"full" | "text", boolean> = { full: false, text: false };
  let mode: "full" | "text" | "dual" | null = null;
  let branches: [ReadableStream<unknown>, ReadableStream<unknown>] | null = null;

  const acquire = async (branch: "full" | "text"): Promise<ReadableStream<unknown>> => {
    hasStarted[branch] = true;
    const { stream } = await directResultPromise;

    if (mode === null) {
      if (hasStarted.full && hasStarted.text) {
        branches = stream.tee();
        mode = "dual";
      } else {
        // A single consumer reads the source directly, preserving backpressure
        // and allowing early cancellation without an unread tee branch.
        mode = branch;
      }
    }

    if (mode === "dual" && branches !== null) {
      return branch === "full" ? branches[0] : branches[1];
    }
    if (mode === branch) return stream;

    throw new Error("fullStream and textStream must start consumption concurrently");
  };

  return {
    fullStream: (async function* () {
      yield* mapReadableStream(await acquire("full"));
    })(),
    textStream: (async function* () {
      yield* textDeltasFromStream(await acquire("text"));
    })(),
  };
}

export function embed(options: EmbedOptions) {
  return options.model.doEmbed({
    values: [options.value],
    abortSignal: options.abortSignal,
  }).then((result) => {
    assertValidEmbeddingVectors(result.embeddings, 1);
    return {
      embedding: result.embeddings[0]!,
      embeddings: result.embeddings,
      usage: result.usage,
      rawResponse: result.rawResponse,
      warnings: result.warnings ?? [],
    };
  });
}

export function embedMany(options: EmbedManyOptions) {
  const values = [...options.values];
  const expectedCount = values.length;
  return options.model.doEmbed({
    values,
    abortSignal: options.abortSignal,
  }).then((result) => {
    assertValidEmbeddingVectors(result.embeddings, expectedCount);
    return {
      embeddings: result.embeddings,
      usage: result.usage,
      rawResponse: result.rawResponse,
      warnings: result.warnings ?? [],
    };
  });
}

function assertValidEmbeddingVectors(
  value: unknown,
  expectedCount: number,
): asserts value is number[][] {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new TypeError("Embedding runtime returned invalid vectors");
  }
  let dimension: number | undefined;
  for (const vector of value) {
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new TypeError("Embedding runtime returned invalid vectors");
    }
    if (dimension === undefined) dimension = vector.length;
    else if (vector.length !== dimension) {
      throw new TypeError("Embedding runtime returned invalid vectors");
    }
    for (const component of vector) {
      if (typeof component !== "number" || !Number.isFinite(component)) {
        throw new TypeError("Embedding runtime returned invalid vectors");
      }
    }
  }
}

/** Compute cosine similarity between two numeric vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let scaleA = 0;
  let scaleB = 0;

  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0;
    scaleA = Math.max(scaleA, Math.abs(av));
    scaleB = Math.max(scaleB, Math.abs(bv));
  }
  if (scaleA === 0 || scaleB === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = (a[i] ?? 0) / scaleA;
    const bv = (b[i] ?? 0) / scaleB;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(similarity) ? Math.max(-1, Math.min(1, similarity)) : 0;
}
