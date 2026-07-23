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
  RuntimeStreamPart,
  RuntimeStreamResult,
  RuntimeToolCallRepairFunction,
  RuntimeToolSet,
} from "#veryfront/agent/runtime/runtime-tool-types.ts";
import type {
  EmbeddingRuntime,
  ModelRuntime,
  ModelRuntimeGenerateResult,
} from "#veryfront/provider/types.ts";
import type { RuntimeReasoningOption } from "#veryfront/agent/types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

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

type RuntimePromptMessage =
  | { role: "system"; content: string }
  | {
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image" | "file"; mediaType: string; url: string; filename?: string }
    >;
  }
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
          content: message.content.map((part) =>
            part.type === "text" ? { type: "text" as const, text: part.text } : {
              type: "tool-call" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            }
          ),
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

function readUsageNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeUsage(usage: unknown): DirectGenerateUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const usageRecord = usage as Record<string, unknown>;

  if (usageRecord.inputTokens && typeof usageRecord.inputTokens === "object") {
    const inputUsage = usageRecord.inputTokens as Record<string, unknown>;
    const outputUsage = usageRecord.outputTokens && typeof usageRecord.outputTokens === "object"
      ? usageRecord.outputTokens as Record<string, unknown>
      : undefined;
    const inputTokens = readUsageNumber(inputUsage.total);
    const cacheReadInputTokens = readUsageNumber(inputUsage.cached) ??
      readUsageNumber(inputUsage.cacheRead);
    const cacheCreationInputTokens = readUsageNumber(inputUsage.cacheCreation);
    const outputTokens = readUsageNumber(outputUsage?.total);
    const reasoningTokens = readUsageNumber(outputUsage?.reasoning);
    const normalizedUsage: DirectGenerateUsage = {
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(inputTokens !== undefined || outputTokens !== undefined
        ? { totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) }
        : {}),
      ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
      ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
      ...(cacheReadInputTokens !== undefined ? { cachedInputTokens: cacheReadInputTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    };

    return Object.keys(normalizedUsage).length > 0 ? normalizedUsage : undefined;
  }

  const inputTokens = readUsageNumber(usageRecord.inputTokens);
  const outputTokens = readUsageNumber(usageRecord.outputTokens);
  const totalTokens = readUsageNumber(usageRecord.totalTokens);
  const cacheCreationInputTokens = readUsageNumber(usageRecord.cacheCreationInputTokens);
  const cacheReadInputTokens = readUsageNumber(usageRecord.cacheReadInputTokens);
  const cachedInputTokens = readUsageNumber(usageRecord.cachedInputTokens) ?? cacheReadInputTokens;
  const reasoningTokens = readUsageNumber(usageRecord.reasoningTokens);
  const billableInputTokens = readUsageNumber(usageRecord.billableInputTokens);
  const billableOutputTokens = readUsageNumber(usageRecord.billableOutputTokens);
  const costUsd = readUsageNumber(usageRecord.costUsd);
  const providerInputCostUsd = readUsageNumber(usageRecord.providerInputCostUsd);
  const providerOutputCostUsd = readUsageNumber(usageRecord.providerOutputCostUsd);
  const providerCostUsd = readUsageNumber(usageRecord.providerCostUsd);
  const veryfrontInputChargeUsd = readUsageNumber(usageRecord.veryfrontInputChargeUsd);
  const veryfrontOutputChargeUsd = readUsageNumber(usageRecord.veryfrontOutputChargeUsd);
  const veryfrontChargeUsd = readUsageNumber(usageRecord.veryfrontChargeUsd);
  const veryfrontBilledUsd = readUsageNumber(usageRecord.veryfrontBilledUsd);
  const costCredits = readUsageNumber(usageRecord.costCredits);
  const costSource = usageRecord.costSource;
  const billingMode = usageRecord.billingMode;
  const usageCaptureStatus = usageRecord.usageCaptureStatus;

  const normalizedUsage: DirectGenerateUsage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(billableInputTokens !== undefined ? { billableInputTokens } : {}),
    ...(billableOutputTokens !== undefined ? { billableOutputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(providerInputCostUsd !== undefined ? { providerInputCostUsd } : {}),
    ...(providerOutputCostUsd !== undefined ? { providerOutputCostUsd } : {}),
    ...(providerCostUsd !== undefined ? { providerCostUsd } : {}),
    ...(veryfrontInputChargeUsd !== undefined ? { veryfrontInputChargeUsd } : {}),
    ...(veryfrontOutputChargeUsd !== undefined ? { veryfrontOutputChargeUsd } : {}),
    ...(veryfrontChargeUsd !== undefined ? { veryfrontChargeUsd } : {}),
    ...(veryfrontBilledUsd !== undefined ? { veryfrontBilledUsd } : {}),
    ...(costCredits !== undefined ? { costCredits } : {}),
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

  return Object.keys(normalizedUsage).length > 0 ? normalizedUsage : undefined;
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
): Promise<DirectToolDefinition[] | undefined> {
  if (!tools) {
    return undefined;
  }

  const resolvedTools: DirectToolDefinition[] = [];

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
      });
    }
  }

  return {
    text,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(toolResults.length > 0 ? { toolResults } : {}),
    usage: normalizeUsage(result.usage),
    finishReason: normalizeFinishReason(result.finishReason),
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
        const result = Object.hasOwn(part, "result")
          ? part.result
          : Object.hasOwn(part, "output")
          ? part.output
          : part.error;
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
  };
  const usage = normalizeUsage(finishPart.usage) ?? normalizeUsage(finishPart.totalUsage);
  const recomputedTotal = usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : undefined;

  return {
    type: "finish",
    finishReason: normalizeFinishReason(finishPart.finishReason),
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

export function generateText(options: GenerateTextOptions): PromiseLike<RuntimeGenerateTextResult> {
  return resolveDirectTools(options.tools).then((tools) => {
    const directOptions = buildDirectModelOptions(options, tools);
    if (shouldGenerateViaStream(options.model)) {
      return options.model.doStream(directOptions).then(({ stream }) =>
        buildGenerateResultFromStream(stream)
      );
    }

    return options.model.doGenerate(directOptions).then(buildDirectGenerateResult);
  });
}

export function streamText(options: StreamTextOptions): RuntimeStreamResult {
  const directResultPromise = resolveDirectTools(options.tools).then((tools) =>
    options.model.doStream(buildDirectModelOptions(options, tools))
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

function assertValidEmbeddingResponse(
  embeddings: unknown,
  expectedCount: number,
): asserts embeddings is number[][] {
  if (!Array.isArray(embeddings)) {
    throw INVALID_ARGUMENT.create({
      detail: "Embedding response must contain an embeddings array",
    });
  }

  if (embeddings.length !== expectedCount) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Embedding response count must match input count: expected ${expectedCount}, received ${embeddings.length}`,
    });
  }

  for (const [index, vector] of embeddings.entries()) {
    if (
      !Array.isArray(vector) ||
      !vector.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      throw INVALID_ARGUMENT.create({
        detail: `Embedding response vector ${index} must contain only finite numbers`,
      });
    }
  }
}

export function embed(options: EmbedOptions) {
  return options.model.doEmbed({
    values: [options.value],
    abortSignal: options.abortSignal,
  }).then((result) => {
    assertValidEmbeddingResponse(result.embeddings, 1);

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
    assertValidEmbeddingResponse(result.embeddings, options.values.length);

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
  if (a.length !== b.length) {
    throw INVALID_ARGUMENT.create({ detail: "Vectors must have the same length" });
  }

  if (a.length === 0) {
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
