import {
  readProviderOptions,
  toOpenAICompatibleMessages,
  toOpenAICompatibleTools,
  unwrapToolInputSchema,
} from "veryfront/provider/shared";
import type { OpenAICompatibleChatRequest, RuntimePromptMessage } from "veryfront/provider/shared";
import {
  type OpenAIProviderReasoningOption,
  rejectsOpenAISamplingParams,
  resolveOpenAIReasoningConfig,
} from "./openai-reasoning-models.ts";

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
  reasoning?: OpenAIProviderReasoningOption;
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

function isNativeOpenAIModel(modelId: string): boolean {
  return /^(gpt-|o[134](-|$)|chatgpt-)/.test(modelId);
}

function isFixedSamplingModel(modelId: string): boolean {
  return /^kimi-k2\.5/.test(modelId);
}

export function buildOpenAIChatRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): OpenAICompatibleChatRequest {
  const reasoning = resolveOpenAIReasoningConfig(modelId, providerName, options.reasoning);
  const reasoningEnabled = reasoning !== undefined;
  const samplingRejected = rejectsOpenAISamplingParams(modelId);
  const fixedSampling = isFixedSamplingModel(modelId);
  const dropSamplingParams = reasoningEnabled || samplingRejected || fixedSampling;

  // OpenAI Chat Completions has no top_k surface.
  if (options.topK !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "openai",
      setting: "topK",
      details: "OpenAI Chat Completions does not expose top_k; the value was dropped.",
    });
  }

  // Reasoning models and models with fixed sampling params
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
            : samplingRejected
            ? `Dropped because this model rejects ${openaiName}.`
            : `Dropped because reasoning was active for this request and OpenAI rejects ${openaiName} with reasoning.`,
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
    ...(reasoning !== undefined ? { reasoning_effort: reasoning.effort } : {}),
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

  // Normalize max_tokens to max_completion_tokens for native OpenAI models.
  if (isNativeOpenAIModel(modelId) && "max_tokens" in providerOpts) {
    if (!("max_completion_tokens" in providerOpts)) {
      providerOpts.max_completion_tokens = providerOpts.max_tokens;
    }
    delete providerOpts.max_tokens;
  }

  Object.assign(body, providerOpts);
  return body;
}
