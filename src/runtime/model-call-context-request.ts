import type {
  ModelRuntimeCallOptions,
  RuntimeMetadata,
  RuntimeReasoningOption,
} from "#veryfront/provider/types.ts";
import {
  isOpenAIReasoningModel,
  rejectsOpenAISamplingParams,
  resolveOpenAIReasoningConfig,
} from "#veryfront/provider/shared/openai-reasoning.ts";
import { readProviderOptions } from "#veryfront/provider/runtime-loader.ts";
import {
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import type { ModelCallRequest } from "./model-call-context.ts";

type ModelCallRuntimeMetadata = Pick<RuntimeMetadata, "modelId" | "provider" | "modelProvider">;
type ModelCallRequestSource =
  & Pick<ModelRuntimeCallOptions, keyof ModelCallRequest | "tools" | "responseFormat">
  & {
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

function usesOpenAIBuilder(model: ModelCallRuntimeMetadata): boolean {
  const provider = resolveModelCallProvider(model);
  return provider === "openai" || (model.provider === "veryfront-cloud" &&
    (provider === "mistral" || provider === "moonshotai"));
}

function managedOpenAITransport(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): "chat-completions" | "responses" | undefined {
  // Custom direct runtime transport overrides are not represented by this metadata.
  if (model.provider !== "veryfront-cloud" || !model.modelId) return undefined;
  const catalogId = `${resolveModelCallProvider(model)}/${model.modelId}`;
  return resolveVeryfrontCloudOpenAITransport(catalogId) ??
    ((resolveModelCallProvider(model) === "openai" &&
        resolveVeryfrontCloudModelThinking(catalogId)?.enabled === true) ||
        isOpenAIReasoningModel(model.modelId, "veryfront-cloud") ||
        options.tools?.some((tool) => tool.type === "provider" && tool.id.startsWith("openai."))
      ? "responses"
      : "chat-completions");
}

function openAIProviderOptions(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): Record<string, unknown> {
  const providerName = model.provider === "veryfront-cloud" ? "veryfront-cloud" : "openai";
  return readProviderOptions(
    options.providerOptions as Record<string, unknown> | undefined,
    ...(providerName === "openai" ? ["openai-compatible"] : []),
    "openai",
    providerName,
  );
}

/** Project effective request settings without persisting raw provider options. */
export function buildModelCallContextRequest(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequest | undefined {
  const reasoning = resolvePersistedReasoning(model, options);
  return buildModelCallRequest(resolvePersistedControls(model, options), reasoning);
}

function resolvePersistedControls(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequestSource {
  const provider = resolveModelCallProvider(model);
  if (provider === "anthropic") return resolveAnthropicControls(model, options);
  if (provider === "google") return resolveGoogleControls(model, options);
  if (!usesOpenAIBuilder(model)) {
    return options;
  }
  const providerOptions = openAIProviderOptions(model, options);
  const transport = managedOpenAITransport(model, options);
  // Native reasoning is merged after neutral sampling is filtered.
  const dropSampling = resolveOpenAINeutralReasoning(model, options)?.enabled === true ||
    (typeof model.modelId === "string" && (rejectsOpenAISamplingParams(model.modelId) ||
      (transport !== "responses" && /^kimi-k2\.5/.test(model.modelId))));
  const effective = {
    ...options,
    topK: numberControl(providerOptions.top_k),
    seed: ObjectHasOwn(providerOptions, "seed")
      ? numberControl(providerOptions.seed)
      : transport === "responses"
      ? undefined
      : options.seed,
    stopSequences: ObjectHasOwn(providerOptions, "stop")
      ? stopControl(providerOptions.stop)
      : transport === "responses"
      ? undefined
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
      : dropSampling ||
          (transport === "responses" &&
            (field === "presencePenalty" || field === "frequencyPenalty"))
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
  if (usesOpenAIBuilder(model) && typeof model.modelId === "string") {
    const neutral = resolveOpenAINeutralReasoning(model, options);
    const transport = managedOpenAITransport(model, options);
    if (!transport) return neutral;
    if (suppressOpenAIFunctionToolReasoning(model, options)) return { enabled: false };
    const native = openAIProviderOptions(model, options);
    const field = transport === "responses" ? "reasoning" : "reasoning_effort";
    if (!ObjectHasOwn(native, field)) return neutral;
    const effort = transport === "responses"
      ? readOwnEnumerableDataDescriptor(native.reasoning, "effort")?.value
      : native.reasoning_effort;
    if (effort === "none") return { enabled: false };
    return effort === "low" || effort === "medium" || effort === "high" || effort === "max"
      ? { enabled: true, effort }
      : undefined;
  }

  return resolveNonOpenAIReasoning(model, options);
}

function suppressOpenAIFunctionToolReasoning(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): boolean {
  const catalogId = `openai/${model.modelId}`;
  if (
    model.provider === "veryfront-cloud" &&
    resolveVeryfrontCloudOpenAITransport(catalogId) === "chat-completions" &&
    resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(catalogId) === false
  ) {
    // Match the Chat builder's native bucket precedence, including an own
    // tools value that clears the neutral list with [] or undefined.
    const providerOptions = openAIProviderOptions(model, options);
    const tools = ObjectHasOwn(providerOptions, "tools") ? providerOptions.tools : options.tools;
    if (
      Array.isArray(tools) &&
      tools.some((tool) =>
        tool !== null && typeof tool === "object" && "type" in tool && tool.type === "function"
      )
    ) {
      return true;
    }
  }
  return false;
}

function resolveOpenAINeutralReasoning(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): RuntimeReasoningOption | undefined {
  if (suppressOpenAIFunctionToolReasoning(model, options)) return { enabled: false };
  if (!model.modelId) return options.reasoning;
  const reasoning = resolveOpenAIReasoningConfig(
    model.modelId,
    model.provider === "veryfront-cloud" ? "veryfront-cloud" : "openai",
    options.reasoning,
  );
  return reasoning ? { enabled: true, effort: reasoning.effort } : options.reasoning;
}

function resolveNonOpenAIReasoning(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): RuntimeReasoningOption | undefined {
  const modelProvider = resolveModelCallProvider(model);
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

  // Structured output is pinned again after provider options are merged.
  const outputConfig = options.responseFormat?.type === "json_schema"
    ? undefined
    : readProviderControl(model, options, "output_config")?.value;
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
