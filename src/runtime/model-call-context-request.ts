import type {
  ModelRuntimeCallOptions,
  RuntimeMetadata,
  RuntimeReasoningOption,
} from "#veryfront/provider/types.ts";
import {
  rejectsOpenAISamplingParams,
  resolveOpenAIReasoningConfig,
} from "#veryfront/provider/shared/openai-reasoning.ts";
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

function readProviderControl(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
  key: string,
): PropertyDescriptor | undefined {
  const provider = resolveModelCallProvider(model);
  let selected: PropertyDescriptor | undefined;
  for (const name of [provider, model.provider ?? provider]) {
    if (!name) continue;
    const bucket = readOwnEnumerableDataDescriptor(options.providerOptions, name)?.value;
    if (Array.isArray(bucket)) continue;
    selected = readOwnEnumerableDataDescriptor(bucket, key) ?? selected;
  }
  return selected;
}

function numberControl(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stopControl(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

/** Project effective request settings without persisting raw provider options. */
export function buildModelCallContextRequest(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequest | undefined {
  const reasoning = resolvePersistedReasoning(model, options);
  return buildModelCallRequest(resolvePersistedControls(model, options, reasoning), reasoning);
}

function resolvePersistedControls(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
  reasoning: RuntimeReasoningOption | undefined,
): ModelCallRequestSource {
  const provider = resolveModelCallProvider(model);
  if (provider === "anthropic") return resolveAnthropicControls(model, options);
  if (provider === "google") return resolveGoogleControls(model, options);
  if (provider !== "openai") {
    return options;
  }
  const providerName = model.provider === "veryfront-cloud" ? "veryfront-cloud" : "openai";
  const providerOptions = readProviderOptions(
    options.providerOptions as Record<string, unknown> | undefined,
    ...(providerName === "openai" ? ["openai-compatible"] : []),
    "openai",
    providerName,
  );
  const dropSampling = reasoning?.enabled === true ||
    (typeof model.modelId === "string" && rejectsOpenAISamplingParams(model.modelId));
  const effective = {
    ...options,
    topK: numberControl(providerOptions.top_k),
    seed: ObjectHasOwn(providerOptions, "seed")
      ? numberControl(providerOptions.seed)
      : options.seed,
    stopSequences: ObjectHasOwn(providerOptions, "stop")
      ? stopControl(providerOptions.stop)
      : options.stopSequences?.length
      ? options.stopSequences
      : undefined,
  };
  for (
    const [field, nativeField] of [
      ["temperature", "temperature"],
      ["topP", "top_p"],
      ["presencePenalty", "presence_penalty"],
      ["frequencyPenalty", "frequency_penalty"],
    ] as const
  ) {
    // Native options merge after neutral filtering in both OpenAI builders.
    const value = ObjectHasOwn(providerOptions, nativeField)
      ? providerOptions[nativeField]
      : dropSampling
      ? undefined
      : options[field];
    effective[field] = typeof value === "number" ? value : undefined;
  }
  return effective;
}

function resolveAnthropicControls(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequestSource {
  const thinking = readProviderControl(model, options, "thinking")?.value;
  // Adaptive native thinking is copied as-is; only enabled budget thinking
  // triggers the Messages builder's neutral sampling filter.
  const thinkingEnabled = options.reasoning?.enabled === true ||
    readOwnEnumerableDataDescriptor(thinking, "type")?.value === "enabled";
  const effective = { ...options };
  for (
    const [field, nativeField] of [
      ["temperature", "temperature"],
      ["topP", "top_p"],
      ["topK", "top_k"],
      ["seed", "seed"],
      ["presencePenalty", "presence_penalty"],
      ["frequencyPenalty", "frequency_penalty"],
    ] as const
  ) {
    const native = readProviderControl(model, options, nativeField);
    effective[field] = native
      ? numberControl(native.value)
      : !thinkingEnabled && (field === "temperature" || field === "topP")
      ? options[field]
      : undefined;
  }
  const stops = readProviderControl(model, options, "stop_sequences");
  effective.stopSequences = stops
    ? stopControl(stops.value)
    : options.stopSequences?.length
    ? options.stopSequences.slice(0, 4)
    : undefined;
  // maxOutputTokens remains the neutral output budget, independent of the
  // provider's combined output/thinking max_tokens allowance.
  return effective;
}

function resolveGoogleControls(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequestSource {
  const native = readProviderControl(model, options, "generationConfig");
  const effective = {
    ...options,
    presencePenalty: undefined as number | undefined,
    frequencyPenalty: undefined as number | undefined,
    stopSequences: options.stopSequences?.length ? options.stopSequences : undefined,
  };
  if (!native) return effective;
  // The builder replaces generationConfig wholesale, rather than merging
  // its fields over the neutral controls.
  for (
    const field of [
      "maxOutputTokens",
      "temperature",
      "topP",
      "topK",
      "seed",
      "presencePenalty",
      "frequencyPenalty",
    ] as const
  ) effective[field] = numberControl(readOwnEnumerableDataDescriptor(native.value, field)?.value);
  effective.stopSequences = stopControl(
    readOwnEnumerableDataDescriptor(native.value, "stopSequences")?.value,
  );
  return effective;
}

function buildModelCallRequest(
  options: ModelCallRequestSource,
  reasoning: RuntimeReasoningOption | undefined,
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
  if (modelProvider === "google") return resolveGoogleReasoning(model, options);
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

  const thinking = readProviderControl(model, options, "thinking")?.value;
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

  const outputConfig = readProviderControl(model, options, "output_config")?.value;
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

function resolveGoogleReasoning(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): RuntimeReasoningOption | undefined {
  const native = readProviderControl(model, options, "generationConfig");
  if (!native) return options.reasoning;
  const thinking = readOwnEnumerableDataDescriptor(native.value, "thinkingConfig")?.value;
  const budget = readOwnEnumerableDataDescriptor(thinking, "thinkingBudget")?.value;
  if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget < -1) return undefined;
  const neutral = options.reasoning;
  const neutralBudget = neutral?.budgetTokens ??
    (neutral?.effort === "low"
      ? 512
      : neutral?.effort === "high"
      ? 8192
      : neutral?.effort === "max"
      ? -1
      : 2048);
  if (
    neutral?.enabled === true && budget === neutralBudget &&
    readOwnEnumerableDataDescriptor(thinking, "includeThoughts")?.value === true
  ) return neutral;
  return budget === -1 ? { enabled: true, effort: "max" } : { enabled: true, budgetTokens: budget };
}
