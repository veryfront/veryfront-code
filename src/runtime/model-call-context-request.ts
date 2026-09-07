import type {
  ModelRuntimeCallOptions,
  RuntimeMetadata,
  RuntimeReasoningOption,
} from "#veryfront/provider/types.ts";
import { resolveOpenAIReasoningConfig } from "#veryfront/provider/shared/openai-reasoning.ts";
import { readProviderOptions } from "#veryfront/provider/runtime-loader.ts";
import {
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import type { ModelCallRequest } from "./model-call-context.ts";

type ModelCallRuntimeMetadata = Pick<RuntimeMetadata, "modelId" | "provider" | "modelProvider">;
type ModelCallRequestSource = Pick<ModelRuntimeCallOptions, keyof ModelCallRequest | "tools"> & {
  providerOptions?: unknown;
};

const ReflectApply = Reflect.apply;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;

function readOwnEnumerableDataDescriptor(
  value: unknown,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  if (value === null || typeof value !== "object") return undefined;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [value, key]) as
      | PropertyDescriptor
      | undefined;
  } catch {
    return undefined;
  }
  return descriptor?.enumerable === true && ObjectHasOwn(descriptor, "value")
    ? descriptor
    : undefined;
}

/** Project effective request settings without persisting raw provider options. */
export function buildModelCallContextRequest(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequest | undefined {
  return buildModelCallRequest(options, resolvePersistedReasoning(model, options));
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

/** Resolve the canonical provider recorded by the existing durable contract. */
export function resolveModelCallProvider(model: ModelCallRuntimeMetadata): string | undefined {
  if (typeof model.modelProvider === "string" && model.modelProvider !== "") {
    return model.modelProvider;
  }
  return model.provider === "veryfront-cloud" ? undefined : model.provider;
}

function resolvePersistedReasoning(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): RuntimeReasoningOption | undefined {
  const modelProvider = resolveModelCallProvider(model);
  if (modelProvider === "openai" && typeof model.modelId === "string") {
    const catalogId = `openai/${model.modelId}`;
    if (
      model.provider === "veryfront-cloud" &&
      resolveVeryfrontCloudOpenAITransport(catalogId) === "chat-completions" &&
      resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(catalogId) === false
    ) {
      // Match the Chat builder's native bucket precedence, including an own
      // tools value that clears the neutral list with [] or undefined.
      const providerOptions = readProviderOptions(
        options.providerOptions as Record<string, unknown> | undefined,
        "openai",
        "veryfront-cloud",
      );
      const tools = ObjectHasOwn(providerOptions, "tools") ? providerOptions.tools : options.tools;
      if (
        Array.isArray(tools) &&
        tools.some((tool) =>
          tool !== null && typeof tool === "object" && "type" in tool && tool.type === "function"
        )
      ) {
        return { enabled: false };
      }
    }
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
