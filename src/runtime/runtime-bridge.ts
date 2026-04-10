/**
 * Runtime Bridge
 *
 * Centralizes the framework's current runtime edge behind one internal
 * module. Higher-level framework code imports framework-owned runtime
 * types and calls into this bridge at the edge.
 */
import type { ModelRuntimeMessage } from "#veryfront/agent/runtime/model-runtime-types.ts";
import type {
  RuntimeGenerateTextResult,
  RuntimeStreamResult,
  RuntimeToolCallRepairFunction,
  RuntimeToolSet,
} from "#veryfront/agent/runtime/runtime-tool-types.ts";
import type {
  EmbeddingRuntime,
  ModelRuntime,
  ModelRuntimeGenerateResult,
} from "#veryfront/provider/types.ts";

type GenerateTextOptions = {
  model: ModelRuntime;
  system?: unknown;
  messages: ModelRuntimeMessage[];
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
  abortSignal?: AbortSignal;
};

type StreamTextOptions = {
  model: ModelRuntime;
  system?: unknown;
  messages: ModelRuntimeMessage[];
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

type DirectGenerateUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
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

function toRuntimePrompt(
  system: string | undefined,
  messages: ModelRuntimeMessage[],
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
          content: [{ type: "text", text: message.content }],
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

function normalizeUsage(usage: unknown): DirectGenerateUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  if ("inputTokens" in usage && typeof usage.inputTokens === "object" && usage.inputTokens) {
    const inputTokens = "total" in usage.inputTokens && typeof usage.inputTokens.total === "number"
      ? usage.inputTokens.total
      : undefined;
    const outputTokens =
      "outputTokens" in usage && typeof usage.outputTokens === "object" && usage.outputTokens &&
        "total" in usage.outputTokens && typeof usage.outputTokens.total === "number"
        ? usage.outputTokens.total
        : undefined;
    return {
      inputTokens,
      outputTokens,
      totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    };
  }

  const flatUsage = usage as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };

  return {
    inputTokens: flatUsage.inputTokens,
    outputTokens: flatUsage.outputTokens,
    totalTokens: flatUsage.totalTokens,
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
    finishReason?: unknown;
  };
  const usage = normalizeUsage(finishPart.usage);

  return {
    type: "finish",
    finishReason: normalizeFinishReason(finishPart.finishReason),
    ...(usage
      ? {
        totalUsage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
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
  return resolveDirectTools(options.tools).then((tools) =>
    options.model.doGenerate({
      prompt: toRuntimePrompt(normalizeSystemPrompt(options.system), options.messages),
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      stopSequences: options.stopSequences,
      ...(tools ? { tools } : {}),
      ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.presencePenalty !== undefined
        ? { presencePenalty: options.presencePenalty }
        : {}),
      ...(options.frequencyPenalty !== undefined
        ? { frequencyPenalty: options.frequencyPenalty }
        : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
      abortSignal: options.abortSignal,
    }).then(buildDirectGenerateResult)
  );
}

export function streamText(options: StreamTextOptions): RuntimeStreamResult {
  const directResultPromise = resolveDirectTools(options.tools).then((tools) =>
    options.model.doStream({
      prompt: toRuntimePrompt(normalizeSystemPrompt(options.system), options.messages),
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      stopSequences: options.stopSequences,
      ...(tools ? { tools } : {}),
      ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.presencePenalty !== undefined
        ? { presencePenalty: options.presencePenalty }
        : {}),
      ...(options.frequencyPenalty !== undefined
        ? { frequencyPenalty: options.frequencyPenalty }
        : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
      ...(options.includeRawChunks !== undefined
        ? { includeRawChunks: options.includeRawChunks }
        : {}),
      abortSignal: options.abortSignal,
    })
  );
  const branchedStreamsPromise = directResultPromise.then(({ stream }) => stream.tee());

  return {
    fullStream: (async function* () {
      const [fullStreamBranch] = await branchedStreamsPromise;
      yield* mapReadableStream(fullStreamBranch);
    })(),
    textStream: (async function* () {
      const [, textStreamBranch] = await branchedStreamsPromise;
      yield* textDeltasFromStream(textStreamBranch);
    })(),
  };
}

export function embed(options: EmbedOptions) {
  return options.model.doEmbed({
    values: [options.value],
    abortSignal: options.abortSignal,
  }).then((result) => ({
    embedding: result.embeddings[0] ?? [],
    embeddings: result.embeddings,
    usage: result.usage,
    rawResponse: result.rawResponse,
    warnings: result.warnings ?? [],
  }));
}

export function embedMany(options: EmbedManyOptions) {
  return options.model.doEmbed({
    values: options.values,
    abortSignal: options.abortSignal,
  }).then((result) => ({
    embeddings: result.embeddings,
    usage: result.usage,
    rawResponse: result.rawResponse,
    warnings: result.warnings ?? [],
  }));
}

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
