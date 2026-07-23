/**
 * Runtime Bridge
 *
 * Centralizes the framework's current runtime edge behind one internal
 * module. Higher-level framework code imports framework-owned runtime
 * types and calls into this bridge at the edge.
 */
import type { TextGenerationRuntimeMessage } from "#veryfront/agent/runtime/text-generation-runtime-message-types.ts";
import type {
  RuntimeGenerateTextResult,
  RuntimeQuarantinedToolResult,
  RuntimeRepairToolCall,
  RuntimeStreamPart,
  RuntimeStreamResult,
  RuntimeToolCallRepairFunction,
  RuntimeToolSet,
} from "#veryfront/agent/runtime/runtime-tool-types.ts";
import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationIssue,
  JsonSchemaValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import {
  createInvalidToolInputError,
  createInvalidToolResultError,
  createMissingToolResultError,
  createNoSuchToolError,
  createToolCallRepairError,
  createToolInputLimitError,
  isInvalidToolInputError,
  isNoSuchToolError,
} from "#veryfront/agent/runtime/runtime-tool-errors.ts";
import { createAbortError, throwIfAborted } from "#veryfront/agent/runtime/error-utils.ts";
import type {
  EmbeddingRuntime,
  ModelRuntime,
  ModelRuntimeGenerateResult,
  RuntimePromptMessage,
} from "#veryfront/provider/types.ts";
import type { RuntimeReasoningOption } from "#veryfront/agent/types.ts";

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
  abortSignal?: AbortSignal;
  quarantineUnpairedToolResults?: boolean;
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
    | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      providerExecuted?: boolean;
      dynamic?: boolean;
      supportsDeferredResults?: boolean;
    }
    | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
      providerExecuted?: boolean;
      dynamic?: boolean;
      supportsDeferredResults?: boolean;
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
type DirectToolDefinition =
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

type DirectTextOptions = GenerateTextOptions | StreamTextOptions;

type RuntimeJsonSchema = {
  jsonSchema: unknown;
  modelJsonSchema?: unknown;
  validate: JsonSchemaValidationFunction;
};

type ResolvedRuntimeTool = {
  kind: "function" | "dynamic" | "provider";
  inputSchema: RuntimeJsonSchema;
  outputSchema?: RuntimeJsonSchema;
  supportsDeferredResults?: boolean;
};

type ResolvedRuntimeTools = {
  directTools: DirectToolDefinition[] | undefined;
  byName: Map<string, ResolvedRuntimeTool>;
};

type ToolCallProcessingContext = {
  abortSignal?: AbortSignal;
  messages: TextGenerationRuntimeMessage[];
  repairToolCall?: RuntimeToolCallRepairFunction;
  resolvedTools: ResolvedRuntimeTools;
  system?: string;
  tools: RuntimeToolSet;
  priorProviderToolCalls: Map<string, RuntimeRepairToolCall>;
  quarantinedToolResults?: RuntimeQuarantinedToolResult[];
};

type ProcessedToolCall = {
  call: RuntimeRepairToolCall;
  rawInput: unknown;
  error?: unknown;
};

const MAX_QUARANTINED_TOOL_RESULTS = 128;
const MAX_QUARANTINED_TOOL_IDENTIFIER_LENGTH = 1_024;

function quarantineUnpairedToolResult(
  context: ToolCallProcessingContext,
  toolCallId: unknown,
  toolName: unknown,
): void {
  const quarantined = context.quarantinedToolResults;
  if (!quarantined || quarantined.length >= MAX_QUARANTINED_TOOL_RESULTS) return;
  if (
    typeof toolCallId !== "string" || toolCallId.length === 0 ||
    typeof toolName !== "string" || toolName.length === 0
  ) {
    return;
  }

  const metadata = {
    toolCallId: toolCallId.slice(0, MAX_QUARANTINED_TOOL_IDENTIFIER_LENGTH),
    toolName: toolName.slice(0, MAX_QUARANTINED_TOOL_IDENTIFIER_LENGTH),
  };
  if (quarantined.some((result) => result.toolCallId === metadata.toolCallId)) return;
  quarantined.push(metadata);
}

function normalizeSystemPrompt(system: GenerateTextOptions["system"]): string | undefined {
  if (typeof system === "string") {
    return system;
  }

  if (!system || typeof system !== "object") {
    return undefined;
  }

  if ("content" in system && typeof system.content === "string") {
    return system.content;
  }

  if (Array.isArray(system)) {
    const parts = system.flatMap((entry) =>
      entry && typeof entry === "object" && "content" in entry && typeof entry.content === "string"
        ? [entry.content]
        : []
    );

    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  return undefined;
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
  system: string | undefined,
  messages: TextGenerationRuntimeMessage[],
): RuntimePromptMessage[] {
  const prompt: RuntimePromptMessage[] = [];

  if (system && system.length > 0) {
    prompt.push({ role: "system", content: system });
  }

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
          content: message.content.map((part) => {
            if (part.type === "text") {
              return { type: "text" as const, text: part.text };
            }
            if (part.type === "reasoning") {
              return {
                type: "reasoning" as const,
                ...(part.text ? { text: part.text } : {}),
                ...(part.signature ? { signature: part.signature } : {}),
                ...(part.redactedData ? { redactedData: part.redactedData } : {}),
              };
            }
            return {
              type: "tool-call" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            };
          }),
          ...(message.providerToolCalls ? { providerToolCalls: message.providerToolCalls } : {}),
          ...(message.providerMetadata ? { providerMetadata: message.providerMetadata } : {}),
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

function isProviderResultContinuationBoundary(finishReason: string | null | undefined): boolean {
  return finishReason === "tool-calls" || finishReason === "pause_turn";
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

function parseToolCallInputStrict(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  if (input.trim().length === 0) {
    return {};
  }

  return JSON.parse(input);
}

function isRuntimeProviderToolDefinition(
  value: unknown,
): value is {
  type: "provider";
  id: `${string}.${string}`;
  args: Record<string, unknown>;
  inputSchema: () => unknown;
  outputSchema?: () => unknown;
  supportsDeferredResults?: boolean;
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
    !Array.isArray(value.args) &&
    "inputSchema" in value &&
    typeof value.inputSchema === "function";
}

function isRuntimeFunctionToolDefinition(
  value: unknown,
): value is {
  description?: string;
  type?: "function" | "dynamic";
  inputSchema: unknown;
} {
  if (!value || typeof value !== "object" || !("inputSchema" in value)) {
    return false;
  }
  const type = "type" in value ? value.type : undefined;
  return type === undefined || type === "function" || type === "dynamic";
}

async function resolveRuntimeJsonSchema(
  value: unknown,
  toolName: string,
  abortSignal?: AbortSignal,
): Promise<RuntimeJsonSchema> {
  const resolved = await awaitAbortable(value, abortSignal);
  if (
    !resolved || typeof resolved !== "object" || !("jsonSchema" in resolved) ||
    !("validate" in resolved) || typeof resolved.validate !== "function"
  ) {
    throw new TypeError(
      `Runtime tool "${toolName}" input schema must provide jsonSchema and validate`,
    );
  }

  const jsonSchema = await awaitAbortable(resolved.jsonSchema, abortSignal);
  const modelJsonSchema = "modelJsonSchema" in resolved && resolved.modelJsonSchema !== undefined
    ? await awaitAbortable(resolved.modelJsonSchema, abortSignal)
    : undefined;

  return {
    jsonSchema,
    ...(modelJsonSchema === undefined ? {} : { modelJsonSchema }),
    validate: resolved.validate.bind(resolved) as JsonSchemaValidationFunction,
  };
}

async function resolveRuntimeTools(
  tools: RuntimeToolSet | undefined,
  abortSignal?: AbortSignal,
): Promise<ResolvedRuntimeTools> {
  throwIfAborted(abortSignal);
  if (!tools) {
    return { directTools: undefined, byName: new Map() };
  }

  const directTools: DirectToolDefinition[] = [];
  const byName = new Map<string, ResolvedRuntimeTool>();

  for (const [name, definition] of Object.entries(tools)) {
    throwIfAborted(abortSignal);
    if (isRuntimeProviderToolDefinition(definition)) {
      const inputSchema = await resolveRuntimeJsonSchema(
        definition.inputSchema(),
        name,
        abortSignal,
      );
      const outputSchema = typeof definition.outputSchema === "function"
        ? await resolveRuntimeJsonSchema(definition.outputSchema(), name, abortSignal)
        : undefined;
      directTools.push({
        type: "provider",
        name,
        id: definition.id,
        args: definition.args,
      });
      byName.set(name, {
        kind: "provider",
        inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
        ...(definition.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
      });
      continue;
    }

    if (!isRuntimeFunctionToolDefinition(definition)) {
      throw new TypeError(`Runtime tool "${name}" has an unsupported definition`);
    }

    const inputSchema = await resolveRuntimeJsonSchema(definition.inputSchema, name, abortSignal);
    directTools.push({
      type: "function",
      name,
      ...(typeof definition.description === "string"
        ? { description: definition.description }
        : {}),
      inputSchema: inputSchema.modelJsonSchema ?? inputSchema.jsonSchema,
    });
    byName.set(name, {
      kind: definition.type === "dynamic" ? "dynamic" : "function",
      inputSchema,
    });
  }

  throwIfAborted(abortSignal);

  return {
    directTools: directTools.length > 0 ? directTools : undefined,
    byName,
  };
}

function validationFailureCause(errors: readonly JsonSchemaValidationIssue[]): Error {
  const details = errors.map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? `failed ${error.keyword}`}`;
  }).join("; ");
  return Object.assign(
    new Error(details.length > 0 ? details : "JSON Schema validation failed"),
    { errors: [...errors] },
  );
}

function isJsonSchemaValidationResult(
  value: unknown,
): value is JsonSchemaValidationResult {
  if (!value || typeof value !== "object" || !("success" in value)) return false;
  if (value.success === true) return "value" in value;
  return value.success === false && "errors" in value && Array.isArray(value.errors);
}

async function validateProviderToolResult(
  toolCall: RuntimeRepairToolCall,
  result: unknown,
  context: ToolCallProcessingContext,
): Promise<{ result: unknown; isError?: true }> {
  const outputSchema = context.resolvedTools.byName.get(toolCall.toolName)?.outputSchema;
  if (!outputSchema) return { result };

  try {
    const validation = await awaitAbortable(
      outputSchema.validate(result),
      context.abortSignal,
    );
    if (!isJsonSchemaValidationResult(validation)) {
      throw new TypeError(
        `Runtime tool "${toolCall.toolName}" output validator returned an invalid result`,
      );
    }
    if (!validation.success) {
      throw validationFailureCause(validation.errors);
    }
    return { result: validation.value };
  } catch (cause) {
    throwIfAborted(context.abortSignal);
    return {
      result: createInvalidToolResultError({
        cause,
        result,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
      }),
      isError: true,
    };
  }
}

type CanonicalToolMetadata = {
  providerExecuted?: true;
  dynamic?: true;
  supportsDeferredResults?: true;
};

function canonicalToolMetadata(
  tool: ResolvedRuntimeTool | undefined,
  untrusted: { providerExecuted?: boolean; dynamic?: boolean },
): CanonicalToolMetadata {
  if (tool) {
    return {
      ...(tool.kind === "provider" ? { providerExecuted: true as const } : {}),
      ...(tool.kind === "dynamic" ? { dynamic: true as const } : {}),
      ...(tool.supportsDeferredResults === true ? { supportsDeferredResults: true as const } : {}),
    };
  }

  // Unknown calls are accepted only for the narrow provider-owned dynamic
  // shape. A single raw flag is not sufficient to bypass the registered tool
  // inventory or local execution policy.
  return untrusted.providerExecuted === true && untrusted.dynamic === true
    ? { providerExecuted: true, dynamic: true }
    : {};
}

function withResolvedToolMetadata(
  toolCall: RuntimeRepairToolCall,
  tool: ResolvedRuntimeTool | undefined,
): RuntimeRepairToolCall {
  const {
    providerExecuted: untrustedProviderExecuted,
    dynamic: untrustedDynamic,
    supportsDeferredResults: _untrustedSupportsDeferredResults,
    ...call
  } = toolCall;
  return {
    ...call,
    ...canonicalToolMetadata(tool, {
      providerExecuted: untrustedProviderExecuted,
      dynamic: untrustedDynamic,
    }),
  };
}

function isRuntimeRepairToolCall(value: unknown): value is RuntimeRepairToolCall {
  return !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "tool-call" &&
    "toolCallId" in value &&
    typeof value.toolCallId === "string" &&
    "toolName" in value &&
    typeof value.toolName === "string" &&
    "input" in value;
}

async function validateToolCallOnce(
  toolCall: RuntimeRepairToolCall,
  context: ToolCallProcessingContext,
): Promise<ProcessedToolCall> {
  throwIfAborted(context.abortSignal);
  const tool = context.resolvedTools.byName.get(toolCall.toolName);
  const normalizedCall = withResolvedToolMetadata(toolCall, tool);

  if (!tool) {
    if (normalizedCall.providerExecuted === true && normalizedCall.dynamic === true) {
      try {
        return {
          call: { ...normalizedCall, input: parseToolCallInputStrict(normalizedCall.input) },
          rawInput: normalizedCall.input,
        };
      } catch (cause) {
        throw createInvalidToolInputError({
          cause,
          toolInput: normalizedCall.input,
          toolName: normalizedCall.toolName,
        });
      }
    }

    throw createNoSuchToolError({
      toolName: normalizedCall.toolName,
      availableTools: [...context.resolvedTools.byName.keys()],
    });
  }

  let parsedInput: unknown;
  try {
    parsedInput = parseToolCallInputStrict(normalizedCall.input);
  } catch (cause) {
    throw createInvalidToolInputError({
      cause,
      toolInput: normalizedCall.input,
      toolName: normalizedCall.toolName,
    });
  }

  const validation = await awaitAbortable(
    tool.inputSchema.validate(parsedInput),
    context.abortSignal,
  );
  if (!isJsonSchemaValidationResult(validation)) {
    throw new TypeError(
      `Runtime tool "${normalizedCall.toolName}" validator returned an invalid result`,
    );
  }
  if (!validation.success) {
    throw createInvalidToolInputError({
      cause: validationFailureCause(validation.errors),
      toolInput: normalizedCall.input,
      toolName: normalizedCall.toolName,
    });
  }

  return {
    call: { ...normalizedCall, input: validation.value },
    rawInput: normalizedCall.input,
  };
}

function toolNameFromSchemaRequest(args: unknown[]): string {
  const request = args[0];
  if (typeof request === "string" && request.length > 0) return request;
  if (
    request && typeof request === "object" && "toolName" in request &&
    typeof request.toolName === "string" && request.toolName.length > 0
  ) {
    return request.toolName;
  }
  throw new TypeError("inputSchema() requires a toolName");
}

function awaitWithAbort<T>(value: T | PromiseLike<T>, abortSignal?: AbortSignal): Promise<T> {
  if (!abortSignal) return Promise.resolve(value);
  throwIfAborted(abortSignal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError(abortSignal.reason));
    abortSignal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve(value).then(
      (result) => {
        abortSignal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function awaitAbortable<T>(
  value: T | PromiseLike<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  throwIfAborted(abortSignal);
  const result = await awaitWithAbort(value, abortSignal);
  throwIfAborted(abortSignal);
  return result;
}

function invalidToolCallOutcome(
  toolCall: RuntimeRepairToolCall,
  error: unknown,
  context: ToolCallProcessingContext,
): ProcessedToolCall {
  const tool = context.resolvedTools.byName.get(toolCall.toolName);
  return {
    call: {
      ...withResolvedToolMetadata(toolCall, tool),
      input: parseToolCallInput(toolCall.input),
    },
    rawInput: toolCall.input,
    error,
  };
}

async function processToolCall(
  toolCall: RuntimeRepairToolCall,
  context: ToolCallProcessingContext,
): Promise<ProcessedToolCall> {
  let originalError: Parameters<typeof createToolCallRepairError>[0]["originalError"];
  try {
    return await validateToolCallOnce(toolCall, context);
  } catch (error) {
    if (!isInvalidToolInputError(error) && !isNoSuchToolError(error)) throw error;
    originalError = error;
  }

  if (!context.repairToolCall) {
    return invalidToolCallOutcome(toolCall, originalError, context);
  }

  throwIfAborted(context.abortSignal);
  let repaired: unknown;
  try {
    repaired = await awaitWithAbort(
      context.repairToolCall({
        error: originalError,
        inputSchema: async (...args: unknown[]) => {
          throwIfAborted(context.abortSignal);
          const requestedToolName = toolNameFromSchemaRequest(args);
          const requestedTool = context.resolvedTools.byName.get(requestedToolName);
          if (!requestedTool) {
            throw createNoSuchToolError({
              toolName: requestedToolName,
              availableTools: [...context.resolvedTools.byName.keys()],
            });
          }
          throwIfAborted(context.abortSignal);
          return requestedTool.inputSchema.jsonSchema;
        },
        messages: context.messages,
        system: context.system,
        toolCall: withResolvedToolMetadata(
          toolCall,
          context.resolvedTools.byName.get(toolCall.toolName),
        ),
        tools: context.tools,
      }),
      context.abortSignal,
    );
  } catch (cause) {
    throwIfAborted(context.abortSignal);
    return invalidToolCallOutcome(
      toolCall,
      createToolCallRepairError({ cause, originalError }),
      context,
    );
  }
  throwIfAborted(context.abortSignal);

  if (repaired === null) {
    return invalidToolCallOutcome(toolCall, originalError, context);
  }

  if (!isRuntimeRepairToolCall(repaired)) {
    return invalidToolCallOutcome(
      toolCall,
      createToolCallRepairError({
        cause: new TypeError('A repair callback must return a complete "tool-call" or null'),
        originalError,
      }),
      context,
    );
  }

  const invalidRepair = repaired.toolCallId !== toolCall.toolCallId
    ? "A repaired tool call must preserve toolCallId"
    : isInvalidToolInputError(originalError) && repaired.toolName !== toolCall.toolName
    ? "A repaired invalid-input tool call must preserve toolName"
    : null;
  if (invalidRepair) {
    return invalidToolCallOutcome(
      toolCall,
      createToolCallRepairError({ cause: new TypeError(invalidRepair), originalError }),
      context,
    );
  }

  try {
    return await validateToolCallOnce(repaired, context);
  } catch (error) {
    if (!isInvalidToolInputError(error) && !isNoSuchToolError(error)) throw error;
    return invalidToolCallOutcome(repaired, error, context);
  }
}

function buildDirectModelOptions(
  options: DirectTextOptions,
  tools: DirectToolDefinition[] | undefined,
): Record<string, unknown> {
  return {
    prompt: toRuntimePrompt(
      normalizeSystemPrompt(options.system),
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
    ...("includeRawChunks" in options && options.includeRawChunks !== undefined
      ? { includeRawChunks: options.includeRawChunks }
      : {}),
    abortSignal: options.abortSignal,
  };
}

function isDirectToolCallPart(
  part: unknown,
): part is {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
  providerExecuted?: boolean;
  dynamic?: boolean;
  supportsDeferredResults?: boolean;
} {
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
  dynamic?: boolean;
  supportsDeferredResults?: boolean;
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

async function buildDirectGenerateResult(
  result: ModelRuntimeGenerateResult | DirectGenerateResult,
  context: ToolCallProcessingContext,
): Promise<RuntimeGenerateTextResult> {
  const finishReason = normalizeFinishReason(result.finishReason);
  let text = "";
  const toolCalls = new Map<
    string,
    NonNullable<RuntimeGenerateTextResult["toolCalls"]>[number]
  >();
  const toolResults: RuntimeGenerateTextResult["toolResults"] = [];
  const terminalToolCallIds = new Set<string>();
  const providerResultToolCallIds = new Set<string>();
  const directToolResults: unknown[] = [];

  for (const part of result.content ?? []) {
    if (isDirectTextPart(part)) {
      text += part.text;
      continue;
    }

    if (isDirectToolCallPart(part)) {
      if (terminalToolCallIds.has(part.toolCallId) || toolCalls.has(part.toolCallId)) continue;
      const processed = await processToolCall({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
        ...(part.dynamic === true ? { dynamic: true } : {}),
        ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
      }, context);
      toolCalls.set(processed.call.toolCallId, {
        toolCallId: processed.call.toolCallId,
        toolName: processed.call.toolName,
        input: processed.call.input,
        ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
        ...(processed.call.dynamic === true ? { dynamic: true } : {}),
        ...(processed.call.supportsDeferredResults === true
          ? { supportsDeferredResults: true }
          : {}),
      });
      if (processed.error !== undefined) {
        terminalToolCallIds.add(processed.call.toolCallId);
        toolResults.push({
          toolCallId: processed.call.toolCallId,
          toolName: processed.call.toolName,
          result: processed.error,
          isError: true,
          ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(processed.call.dynamic === true ? { dynamic: true } : {}),
          ...(processed.call.supportsDeferredResults === true
            ? { supportsDeferredResults: true }
            : {}),
        });
      }
      continue;
    }

    if (isDirectToolResultPart(part)) {
      directToolResults.push(part);
    }
  }

  for (const part of directToolResults) {
    if (!isDirectToolResultPart(part) || terminalToolCallIds.has(part.toolCallId)) continue;
    const correlatedCall = toolCalls.get(part.toolCallId) ??
      context.priorProviderToolCalls.get(part.toolCallId);
    if (!correlatedCall) {
      quarantineUnpairedToolResult(context, part.toolCallId, part.toolName);
      continue;
    }
    if (correlatedCall.providerExecuted !== true) continue;
    const toolName = correlatedCall.toolName;
    const validated = part.isError === true
      ? { result: part.result, isError: true as const }
      : await validateProviderToolResult(
        {
          type: "tool-call",
          ...correlatedCall,
        },
        part.result,
        context,
      );
    toolResults.push({
      toolCallId: part.toolCallId,
      toolName,
      result: validated.result,
      ...(validated.isError === true ? { isError: true } : {}),
      providerExecuted: true,
      ...(correlatedCall.dynamic === true ? { dynamic: true } : {}),
      ...(correlatedCall.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
    });
    providerResultToolCallIds.add(part.toolCallId);
    terminalToolCallIds.add(part.toolCallId);
  }

  const providerCallsRequiringResult = new Map(context.priorProviderToolCalls);
  for (const toolCall of toolCalls.values()) {
    if (toolCall.providerExecuted === true) {
      providerCallsRequiringResult.set(toolCall.toolCallId, {
        type: "tool-call",
        ...toolCall,
      });
    }
  }

  for (const toolCall of providerCallsRequiringResult.values()) {
    if (
      toolCall.providerExecuted !== true || providerResultToolCallIds.has(toolCall.toolCallId) ||
      terminalToolCallIds.has(toolCall.toolCallId) ||
      toolCall.supportsDeferredResults === true &&
        isProviderResultContinuationBoundary(finishReason)
    ) {
      continue;
    }
    const error = createMissingToolResultError(toolCall);
    toolResults.push({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      result: error,
      isError: true,
      providerExecuted: true,
      ...(toolCall.dynamic === true ? { dynamic: true } : {}),
    });
    terminalToolCallIds.add(toolCall.toolCallId);
  }

  const finalToolCalls = [...toolCalls.values()];

  return {
    text,
    ...(finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : {}),
    ...(toolResults.length > 0 ? { toolResults } : {}),
    ...(context.quarantinedToolResults?.length
      ? { quarantinedToolResults: context.quarantinedToolResults }
      : {}),
    usage: normalizeUsage(result.usage),
    finishReason,
    ...(result.providerMetadata ? { providerMetadata: result.providerMetadata } : {}),
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
  context: ToolCallProcessingContext,
): Promise<RuntimeGenerateTextResult> {
  let text = "";
  let usage: RuntimeGenerateTextResult["usage"];
  let finishReason: string | null = null;
  let providerMetadata: Record<string, unknown> | undefined;
  const toolCalls = new Map<string, NonNullable<RuntimeGenerateTextResult["toolCalls"]>[number]>();
  const toolInputs = new Map<
    string,
    {
      toolCallId: string;
      toolName: string;
      input: string;
      providerExecuted?: boolean;
      dynamic?: boolean;
      supportsDeferredResults?: boolean;
    }
  >();
  const toolResults: NonNullable<RuntimeGenerateTextResult["toolResults"]> = [];
  const terminalToolCallIds = new Set<string>();

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
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(part.dynamic === true ? { dynamic: true } : {}),
          ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
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
            ...(input.providerExecuted === true ? { providerExecuted: true } : {}),
            ...(input.dynamic === true ? { dynamic: true } : {}),
            ...(input.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
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
            ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
            ...(part.dynamic === true ? { dynamic: true } : {}),
            ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
          });
        }
        break;
      }

      case "tool-call":
        toolCalls.set(part.toolCallId, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: parseToolCallInput(part.input),
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(part.dynamic === true ? { dynamic: true } : {}),
          ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
        });
        break;

      case "tool-result": {
        if (terminalToolCallIds.has(part.toolCallId)) break;
        const result = "result" in part ? part.result : "output" in part ? part.output : part.error;
        toolResults.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result,
          ...(part.isError === true || part.error !== undefined ? { isError: true } : {}),
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(part.dynamic === true ? { dynamic: true } : {}),
          ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
        });
        if (part.preliminary !== true) {
          terminalToolCallIds.add(part.toolCallId);
        }
        break;
      }

      case "tool-error":
        if (terminalToolCallIds.has(part.toolCallId)) break;
        if (!toolCalls.has(part.toolCallId)) {
          toolCalls.set(part.toolCallId, {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: parseToolCallInput(part.input),
            ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
            ...(part.dynamic === true ? { dynamic: true } : {}),
            ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
          });
        }
        toolResults.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result: part.error,
          isError: true,
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(part.dynamic === true ? { dynamic: true } : {}),
          ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
        });
        terminalToolCallIds.add(part.toolCallId);
        break;

      case "error":
        if (part.error instanceof Error) {
          throw part.error;
        }
        throw new Error("Model stream failed", { cause: part.error });

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
    ...(context.quarantinedToolResults?.length
      ? { quarantinedToolResults: context.quarantinedToolResults }
      : {}),
    usage,
    finishReason,
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

function normalizeStreamPart(part: unknown): unknown {
  if (!part || typeof part !== "object" || !("type" in part)) {
    return part;
  }

  if (part.type === "text-delta") {
    if ("delta" in part && typeof part.delta === "string") {
      return {
        type: "text-delta",
        text: part.delta,
      };
    }

    return part;
  }

  if (part.type !== "finish") {
    return part;
  }

  const finishPart = part as {
    type: "finish";
    usage?: unknown;
    totalUsage?: unknown;
    finishReason?: unknown;
    providerMetadata?: unknown;
  };
  const usage = normalizeUsage(finishPart.usage) ?? normalizeUsage(finishPart.totalUsage);
  const recomputedTotal = usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : undefined;

  return {
    type: "finish",
    finishReason: normalizeFinishReason(finishPart.finishReason),
    ...(finishPart.providerMetadata && typeof finishPart.providerMetadata === "object" &&
        !Array.isArray(finishPart.providerMetadata)
      ? { providerMetadata: finishPart.providerMetadata as Record<string, unknown> }
      : {}),
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

type PendingStreamToolCall = {
  id: string;
  toolName: string;
  inputChunks: string[];
  inputBytes: number;
  inputDeltaCount: number;
  ended: boolean;
  providerExecuted?: boolean;
  dynamic?: boolean;
  supportsDeferredResults?: boolean;
};

// These limits bound provider-controlled allocations while remaining well
// above practical function-call payloads and provider tool inventories.
const MAX_STREAM_TOOL_CALLS = 128;
const MAX_STREAM_TOOL_INPUT_BYTES = 1_048_576;
const MAX_STREAM_TOOL_INPUT_DELTAS = 4_096;
const STREAM_TOOL_INPUT_ENCODER = new TextEncoder();

function pendingStreamToolInput(toolCall: PendingStreamToolCall): string {
  return toolCall.inputChunks.join("");
}

function streamToolInputByteLength(input: unknown): number {
  return STREAM_TOOL_INPUT_ENCODER.encode(streamToolInputText(input)).byteLength;
}

function streamToolInputText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input === undefined) return "";
  try {
    return JSON.stringify(input) ?? "";
  } catch {
    return String(input);
  }
}

async function* processRuntimeStream(
  stream: ReadableStream<unknown>,
  context: ToolCallProcessingContext,
): AsyncIterable<unknown> {
  const pending = new Map<string, PendingStreamToolCall>();
  const completedToolCalls = new Map<string, RuntimeRepairToolCall>(
    context.priorProviderToolCalls,
  );
  const terminalToolCallIds = new Set<string>();
  const providerResultToolCallIds = new Set<string>();
  const seenToolCallIds = new Set<string>();
  let toolCallLimitExceeded = false;
  let bufferedFinish: Extract<RuntimeStreamPart, { type: "finish" }> | undefined;

  const bufferedLifecycle = (
    toolCall: PendingStreamToolCall,
    includeEnd: boolean,
  ): RuntimeStreamPart[] => [
    {
      type: "tool-input-start",
      id: toolCall.id,
      toolName: toolCall.toolName,
      ...(toolCall.providerExecuted === true ? { providerExecuted: true } : {}),
      ...(toolCall.dynamic === true ? { dynamic: true } : {}),
      ...(toolCall.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
    },
    ...toolCall.inputChunks.map((delta) => ({
      type: "tool-input-delta" as const,
      id: toolCall.id,
      delta,
    })),
    ...(includeEnd ? [{ type: "tool-input-end" as const, id: toolCall.id }] : []),
  ];

  const limitErrorPart = (
    toolCallId: string,
    toolName: string,
    limitKind: "bytes" | "deltas" | "toolCalls",
    limit: number,
    untrusted: { providerExecuted?: boolean; dynamic?: boolean } = {},
  ): RuntimeStreamPart => ({
    type: "tool-error",
    toolCallId,
    toolName,
    error: createToolInputLimitError({ toolCallId, toolName, limitKind, limit }),
    isError: true,
    ...canonicalToolMetadata(context.resolvedTools.byName.get(toolName), untrusted),
  });

  const reserveToolCall = (
    toolCallId: string,
    toolName: string,
    untrusted: { providerExecuted?: boolean; dynamic?: boolean },
  ): { accepted: boolean; error?: RuntimeStreamPart } => {
    if (seenToolCallIds.has(toolCallId)) return { accepted: false };
    if (seenToolCallIds.size >= MAX_STREAM_TOOL_CALLS) {
      if (toolCallLimitExceeded) return { accepted: false };
      toolCallLimitExceeded = true;
      return {
        accepted: false,
        error: limitErrorPart(
          toolCallId,
          toolName,
          "toolCalls",
          MAX_STREAM_TOOL_CALLS,
          untrusted,
        ),
      };
    }
    seenToolCallIds.add(toolCallId);
    return { accepted: true };
  };

  const finalize = async (
    candidate: RuntimeRepairToolCall,
    pendingToolCall?: PendingStreamToolCall,
  ): Promise<RuntimeStreamPart[]> => {
    const processed = await processToolCall(candidate, context);
    pending.delete(candidate.toolCallId);
    const lifecycle: RuntimeStreamPart[] = [];
    if (pendingToolCall) {
      const canonicalInput = streamToolInputText(processed.rawInput);
      const bufferedInput = pendingStreamToolInput(pendingToolCall);
      const deltas = canonicalInput === bufferedInput
        ? pendingToolCall.inputChunks
        : canonicalInput.length > 0
        ? [canonicalInput]
        : [];
      lifecycle.push({
        type: "tool-input-start",
        id: processed.call.toolCallId,
        toolName: processed.call.toolName,
        ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
        ...(processed.call.dynamic === true ? { dynamic: true } : {}),
        ...(processed.call.supportsDeferredResults === true
          ? { supportsDeferredResults: true }
          : {}),
      });
      lifecycle.push(...deltas.map((delta) => ({
        type: "tool-input-delta" as const,
        id: processed.call.toolCallId,
        delta,
      })));
      lifecycle.push({ type: "tool-input-end", id: processed.call.toolCallId });
    }

    if (processed.error !== undefined) {
      terminalToolCallIds.add(processed.call.toolCallId);
      return [...lifecycle, {
        type: "tool-error",
        toolCallId: processed.call.toolCallId,
        toolName: processed.call.toolName,
        input: processed.rawInput,
        error: processed.error,
        isError: true,
        ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
        ...(processed.call.dynamic === true ? { dynamic: true } : {}),
        ...(processed.call.supportsDeferredResults === true
          ? { supportsDeferredResults: true }
          : {}),
      }];
    }

    completedToolCalls.set(processed.call.toolCallId, processed.call);
    return [...lifecycle, {
      type: "tool-call",
      toolCallId: processed.call.toolCallId,
      toolName: processed.call.toolName,
      input: processed.rawInput,
      ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
      ...(processed.call.dynamic === true ? { dynamic: true } : {}),
      ...(processed.call.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
    }];
  };

  const flushEnded = async (exceptId?: string): Promise<RuntimeStreamPart[]> => {
    const parts: RuntimeStreamPart[] = [];
    for (const toolCall of [...pending.values()]) {
      if (!toolCall.ended || toolCall.id === exceptId) continue;
      parts.push(
        ...await finalize({
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.toolName,
          input: pendingStreamToolInput(toolCall),
          ...(toolCall.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(toolCall.dynamic === true ? { dynamic: true } : {}),
          ...(toolCall.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
        }, toolCall),
      );
    }
    return parts;
  };

  const flushIncomplete = (): RuntimeStreamPart[] => {
    const parts: RuntimeStreamPart[] = [];
    for (const toolCall of [...pending.values()]) {
      if (toolCall.ended) continue;
      pending.delete(toolCall.id);
      parts.push(...bufferedLifecycle(toolCall, false));
    }
    return parts;
  };

  const missingProviderResults = (
    finishReason: string | null | undefined,
  ): RuntimeStreamPart[] => {
    const parts: RuntimeStreamPart[] = [];
    for (const toolCall of completedToolCalls.values()) {
      if (
        toolCall.providerExecuted !== true ||
        providerResultToolCallIds.has(toolCall.toolCallId) ||
        terminalToolCallIds.has(toolCall.toolCallId) ||
        toolCall.supportsDeferredResults === true &&
          isProviderResultContinuationBoundary(finishReason)
      ) {
        continue;
      }
      const error = createMissingToolResultError(toolCall);
      terminalToolCallIds.add(toolCall.toolCallId);
      parts.push({
        type: "tool-error",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
        error,
        isError: true,
        providerExecuted: true,
        ...(toolCall.dynamic === true ? { dynamic: true } : {}),
      });
    }
    return parts;
  };

  for await (const rawPart of stream) {
    throwIfAborted(context.abortSignal);
    const normalized = normalizeStreamPart(rawPart);
    if (!normalized || typeof normalized !== "object" || !("type" in normalized)) {
      for (const flushed of await flushEnded()) yield flushed;
      yield normalized;
      continue;
    }

    const part = normalized as RuntimeStreamPart;
    switch (part.type) {
      case "tool-input-start": {
        for (const flushed of await flushEnded()) yield flushed;
        if (
          terminalToolCallIds.has(part.id) || completedToolCalls.has(part.id) ||
          pending.has(part.id)
        ) break;
        const reservation = reserveToolCall(part.id, part.toolName, part);
        if (!reservation.accepted) {
          if (reservation.error) yield reservation.error;
          break;
        }
        const metadata = canonicalToolMetadata(
          context.resolvedTools.byName.get(part.toolName),
          part,
        );
        pending.set(part.id, {
          id: part.id,
          toolName: part.toolName,
          inputChunks: [],
          inputBytes: 0,
          inputDeltaCount: 0,
          ended: false,
          ...metadata,
        });
        break;
      }

      case "tool-input-delta": {
        if (terminalToolCallIds.has(part.id) || completedToolCalls.has(part.id)) break;
        const toolCall = pending.get(part.id);
        if (toolCall) {
          const nextDeltaCount = toolCall.inputDeltaCount + 1;
          const nextInputBytes = toolCall.inputBytes +
            STREAM_TOOL_INPUT_ENCODER.encode(part.delta).byteLength;
          const exceededDeltaLimit = nextDeltaCount > MAX_STREAM_TOOL_INPUT_DELTAS;
          const exceededByteLimit = nextInputBytes > MAX_STREAM_TOOL_INPUT_BYTES;
          if (exceededDeltaLimit || exceededByteLimit) {
            pending.delete(part.id);
            terminalToolCallIds.add(part.id);
            for (const lifecyclePart of bufferedLifecycle(toolCall, false)) yield lifecyclePart;
            yield limitErrorPart(
              toolCall.id,
              toolCall.toolName,
              exceededDeltaLimit ? "deltas" : "bytes",
              exceededDeltaLimit ? MAX_STREAM_TOOL_INPUT_DELTAS : MAX_STREAM_TOOL_INPUT_BYTES,
              toolCall,
            );
            break;
          }
          toolCall.inputChunks.push(part.delta);
          toolCall.inputBytes = nextInputBytes;
          toolCall.inputDeltaCount = nextDeltaCount;
        }
        break;
      }

      case "tool-input-end": {
        if (terminalToolCallIds.has(part.id) || completedToolCalls.has(part.id)) break;
        const toolCall = pending.get(part.id);
        if (toolCall) toolCall.ended = true;
        break;
      }

      case "tool-input-available":
      case "tool-call": {
        const toolCallId = part.type === "tool-call" ? part.toolCallId : part.toolCallId ?? part.id;
        if (!toolCallId) break;
        for (const flushed of await flushEnded(toolCallId)) yield flushed;
        if (terminalToolCallIds.has(toolCallId) || completedToolCalls.has(toolCallId)) break;
        const accumulated = pending.get(toolCallId);
        if (!accumulated) {
          const reservation = reserveToolCall(toolCallId, part.toolName, part);
          if (!reservation.accepted) {
            if (reservation.error) yield reservation.error;
            break;
          }
        }
        const partInput = part.input;
        const accumulatedInput = accumulated ? pendingStreamToolInput(accumulated) : "";
        const input = accumulatedInput &&
            (partInput === undefined ||
              (typeof partInput === "string" && partInput.trim() === "{}"))
          ? accumulatedInput
          : partInput;
        if (streamToolInputByteLength(input) > MAX_STREAM_TOOL_INPUT_BYTES) {
          pending.delete(toolCallId);
          terminalToolCallIds.add(toolCallId);
          if (accumulated) {
            for (const lifecyclePart of bufferedLifecycle(accumulated, false)) yield lifecyclePart;
          }
          yield limitErrorPart(
            toolCallId,
            part.toolName,
            "bytes",
            MAX_STREAM_TOOL_INPUT_BYTES,
            part,
          );
          break;
        }
        const untrustedMetadata = {
          providerExecuted: part.providerExecuted === true ||
            accumulated?.providerExecuted === true,
          dynamic: part.dynamic === true || accumulated?.dynamic === true,
        };
        for (
          const finalized of await finalize({
            type: "tool-call",
            toolCallId,
            toolName: part.toolName,
            input,
            ...untrustedMetadata,
          }, accumulated)
        ) yield finalized;
        break;
      }

      case "tool-result":
      case "tool-error": {
        for (const flushed of await flushEnded()) yield flushed;
        if (terminalToolCallIds.has(part.toolCallId)) break;
        const completedToolCall = completedToolCalls.get(part.toolCallId);
        if (!completedToolCall) {
          quarantineUnpairedToolResult(context, part.toolCallId, part.toolName);
          break;
        }
        if (completedToolCall.providerExecuted !== true) break;
        const toolName = completedToolCall.toolName;
        const isError = part.type === "tool-error" || part.isError === true ||
          part.error !== undefined;
        const isTerminal = isError || part.preliminary !== true;
        const rawResult = "result" in part
          ? part.result
          : "output" in part
          ? part.output
          : part.error;
        const validated = isError || part.preliminary === true
          ? { result: rawResult, ...(isError ? { isError: true as const } : {}) }
          : await validateProviderToolResult(completedToolCall, rawResult, context);
        if (isTerminal) {
          terminalToolCallIds.add(part.toolCallId);
          providerResultToolCallIds.add(part.toolCallId);
        }
        const terminalPart = part as typeof part & {
          result?: unknown;
          output?: unknown;
        };
        const priorProviderCall = context.priorProviderToolCalls.get(part.toolCallId);
        const {
          providerExecuted: _untrustedProviderExecuted,
          dynamic: _untrustedDynamic,
          supportsDeferredResults: _untrustedSupportsDeferredResults,
          toolName: _untrustedToolName,
          result: _rawResult,
          output: _rawOutput,
          error: _rawError,
          input: _untrustedInput,
          isError: _rawIsError,
          ...trustedPart
        } = terminalPart;
        if (validated.isError === true) {
          yield {
            ...trustedPart,
            type: "tool-error",
            toolName,
            error: validated.result,
            isError: true,
            providerExecuted: true,
            ...(priorProviderCall ? { input: priorProviderCall.input } : {}),
            ...(completedToolCall.dynamic === true ? { dynamic: true } : {}),
            ...(completedToolCall.supportsDeferredResults === true
              ? { supportsDeferredResults: true }
              : {}),
          };
        } else {
          yield {
            ...trustedPart,
            type: "tool-result",
            toolName,
            result: validated.result,
            providerExecuted: true,
            ...(priorProviderCall ? { input: priorProviderCall.input } : {}),
            ...(completedToolCall.dynamic === true ? { dynamic: true } : {}),
            ...(completedToolCall.supportsDeferredResults === true
              ? { supportsDeferredResults: true }
              : {}),
          };
        }
        break;
      }

      default:
        for (const flushed of await flushEnded()) yield flushed;
        if (part.type === "finish" || part.type === "error") {
          for (const incomplete of flushIncomplete()) yield incomplete;
        }
        if (part.type === "finish") {
          bufferedFinish = { ...bufferedFinish, ...part, type: "finish" };
          break;
        }
        yield part;
        break;
    }
    throwIfAborted(context.abortSignal);
  }

  for (const flushed of await flushEnded()) yield flushed;
  for (const incomplete of flushIncomplete()) yield incomplete;
  for (const missingResult of missingProviderResults(bufferedFinish?.finishReason)) {
    yield missingResult;
  }
  throwIfAborted(context.abortSignal);
  if (bufferedFinish) {
    yield bufferedFinish;
  }
}

async function* mapReadableStream(stream: ReadableStream<unknown>): AsyncIterable<unknown> {
  for await (const part of stream) {
    yield normalizeStreamPart(part);
  }
}

async function* textDeltasFromStream(stream: ReadableStream<unknown>): AsyncIterable<string> {
  for await (const part of stream) {
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
  }
}

function createToolCallProcessingContext(
  options: DirectTextOptions,
  resolvedTools: ResolvedRuntimeTools,
): ToolCallProcessingContext {
  const priorProviderToolCalls = new Map<string, RuntimeRepairToolCall>();
  for (const message of options.messages) {
    if (message.role !== "assistant") continue;
    for (const toolCall of message.providerToolCalls ?? []) {
      const resolved = resolvedTools.byName.get(toolCall.toolName);
      if (resolved?.kind !== "provider") continue;
      priorProviderToolCalls.set(toolCall.toolCallId, {
        type: "tool-call",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: parseToolCallInput(toolCall.input),
        providerExecuted: true,
        ...(resolved.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
      });
    }
  }

  return {
    abortSignal: options.abortSignal,
    messages: getProviderRequestMessages(options.messages),
    repairToolCall: options.experimental_repairToolCall,
    resolvedTools,
    system: normalizeSystemPrompt(options.system),
    tools: options.tools ?? {},
    priorProviderToolCalls,
    ...("quarantineUnpairedToolResults" in options &&
        options.quarantineUnpairedToolResults === true
      ? { quarantinedToolResults: [] }
      : {}),
  };
}

export function generateText(options: GenerateTextOptions): PromiseLike<RuntimeGenerateTextResult> {
  return resolveRuntimeTools(options.tools, options.abortSignal).then((resolvedTools) => {
    const directOptions = buildDirectModelOptions(options, resolvedTools.directTools);
    const processingContext = createToolCallProcessingContext(options, resolvedTools);
    if (shouldGenerateViaStream(options.model)) {
      return options.model.doStream(directOptions).then(({ stream }) => {
        const processedStream = ReadableStream.from(
          processRuntimeStream(stream, processingContext),
        );
        return buildGenerateResultFromStream(processedStream, processingContext);
      });
    }

    return options.model.doGenerate(directOptions).then((result) =>
      buildDirectGenerateResult(result, processingContext)
    );
  });
}

export function streamText(options: StreamTextOptions): RuntimeStreamResult {
  const directResultPromise = resolveRuntimeTools(options.tools, options.abortSignal).then(
    async (resolvedTools) => {
      const result = await options.model.doStream(
        buildDirectModelOptions(options, resolvedTools.directTools),
      );
      return {
        ...result,
        stream: ReadableStream.from(
          processRuntimeStream(
            result.stream,
            createToolCallProcessingContext(options, resolvedTools),
          ),
        ),
      };
    },
  );
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

function assertEmbeddingCount(expected: number, embeddings: number[][]): void {
  if (embeddings.length === expected) {
    return;
  }

  const label = expected === 1 ? "embedding" : "embeddings";
  throw new Error(
    `Embedding runtime expected ${expected} ${label} but received ${embeddings.length}`,
  );
}

export function embed(options: EmbedOptions) {
  return options.model.doEmbed({
    values: [options.value],
    abortSignal: options.abortSignal,
  }).then((result) => {
    assertEmbeddingCount(1, result.embeddings);
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
  return options.model.doEmbed({
    values: options.values,
    abortSignal: options.abortSignal,
  }).then((result) => {
    assertEmbeddingCount(options.values.length, result.embeddings);
    return {
      embeddings: result.embeddings,
      usage: result.usage,
      rawResponse: result.rawResponse,
      warnings: result.warnings ?? [],
    };
  });
}
/** Compute cosine similarity between two numeric vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
