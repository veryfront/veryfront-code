import {
  readProviderOptions,
  toOpenAICompatibleMessages,
  toOpenAICompatibleTools,
  unwrapToolInputSchema,
} from "veryfront/provider/shared";
import type {
  ModelRuntimeCallOptions,
  ModelRuntimeToolDefinition,
  OpenAICompatibleChatRequest,
} from "veryfront/provider/shared";
import {
  rejectsOpenAISamplingParams,
  resolveOpenAIReasoningConfig,
} from "./openai-reasoning-models.ts";
import { defineOpenAIProviderOptions } from "./openai-provider-options.ts";

export interface OpenAICompatibleLanguageOptions extends ModelRuntimeCallOptions {
  serviceTier?: "auto" | "default" | "flex" | "scale";
  parallelToolCalls?: boolean;
}

export type OpenAIChatRequestCapabilities = {
  readonly reasoningWithFunctionTools?: boolean;
};

/** @deprecated Import `ModelRuntimeToolDefinition` from `veryfront/provider` instead. */
export type RuntimeToolDefinition = ModelRuntimeToolDefinition;

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
  capabilities?: OpenAIChatRequestCapabilities,
): OpenAICompatibleChatRequest {
  const tools = toOpenAICompatibleTools(options.tools);
  // Env-BYOK users historically registered options under "openai-compatible";
  // keep merging that bucket at the lowest precedence. max_tokens is normalized
  // per bucket BEFORE merging so a higher-precedence bucket's max_tokens
  // override still beats a lower bucket's max_completion_tokens.
  const bucketNames = [
    ...(providerName === "openai" ? ["openai-compatible"] : []),
    "openai",
    providerName,
  ];
  const providerOpts: Record<string, unknown> = {};
  for (const bucketName of bucketNames) {
    defineOpenAIProviderOptions(
      providerOpts,
      normalizeNativeMaxTokens(readProviderOptions(options.providerOptions, bucketName), modelId),
    );
  }
  const finalTools = Object.hasOwn(providerOpts, "tools") ? providerOpts.tools : tools;
  const resolvedReasoning = resolveOpenAIReasoningConfig(
    modelId,
    providerName,
    options.reasoning,
  );
  const suppressReasoningForFunctionTools = hasOpenAIFunctionTools(finalTools) &&
    capabilities?.reasoningWithFunctionTools === false;
  const reasoning = suppressReasoningForFunctionTools ? undefined : resolvedReasoning;
  const reasoningEnabled = reasoning !== undefined;
  const samplingRejected = rejectsOpenAISamplingParams(modelId);
  const fixedSampling = isFixedSamplingModel(modelId);
  const dropSamplingParams = reasoningEnabled || samplingRejected || fixedSampling;
  const messages = toOpenAICompatibleMessages(options.prompt);

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
    messages,
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
      ? { stop: [...options.stopSequences] }
      : {}),
    ...(tools ? { tools } : {}),
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

  defineOpenAIProviderOptions(body as Record<string, unknown>, providerOpts);
  // Provider-native options may tune request behavior, but they must not
  // replace the runtime-owned transport mode, model, or conversation.
  body.model = modelId;
  body.messages = messages;
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  } else {
    delete body.stream;
    delete body.stream_options;
  }
  if (suppressReasoningForFunctionTools) {
    if (resolvedReasoning !== undefined || body.reasoning_effort !== undefined) {
      warnings.push({
        type: "unsupported-setting",
        provider: "openai",
        setting: "reasoning",
        details: "Veryfront drops reasoning because this Chat Completions transport " +
          "does not support reasoning alongside function tools.",
      });
    }
    delete body.reasoning_effort;
  }
  return body;
}

function hasOpenAIFunctionTools(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  for (const tool of value) {
    if (
      typeof tool === "object" &&
      tool !== null &&
      "type" in tool &&
      tool.type === "function"
    ) {
      return true;
    }
  }
  return false;
}

/** Normalizes max_tokens to max_completion_tokens for native OpenAI models. */
function normalizeNativeMaxTokens(
  bucket: Record<string, unknown>,
  modelId: string,
): Record<string, unknown> {
  if (!isNativeOpenAIModel(modelId) || !("max_tokens" in bucket)) {
    return bucket;
  }

  const normalized = { ...bucket };
  if (!("max_completion_tokens" in normalized)) {
    normalized.max_completion_tokens = normalized.max_tokens;
  }
  delete normalized.max_tokens;
  return normalized;
}
