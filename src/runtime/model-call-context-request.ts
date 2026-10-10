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
import {
  readVeryfrontCloudModelFacts,
  resolveVeryfrontCloudOpenAICallTransport,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
  resolveVeryfrontCloudProviderRouting,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import {
  everyPrivateArray,
  forEachPrivateArray,
  slicePrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import { testPrivateRegExp } from "#veryfront/security/private-regexp.ts";
import type { ModelCallRequest } from "./model-call-context.ts";

type ModelCallRuntimeMetadata = Pick<
  RuntimeMetadata,
  "modelId" | "provider" | "modelProvider" | "openAITransport"
>;
type ModelCallRequestSource =
  & Pick<ModelRuntimeCallOptions, keyof ModelCallRequest | "tools" | "responseFormat">
  & {
    providerOptions?: unknown;
  };

const ReflectApply = Reflect.apply;
const ReflectGet = Reflect.get;
const ObjectDefineProperty = Object.defineProperty;
const ObjectEntries = Object.entries;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const ArrayIsArray = Array.isArray;
const NumberIsInteger = Number.isInteger;
const NumberIsSafeInteger = Number.isSafeInteger;
const StringPrototypeStartsWith = String.prototype.startsWith;
const NativeOpenAIChatModelPattern = /^(gpt-|o[134](-|$)|chatgpt-)/;

function regexpTest(pattern: RegExp, value: string): boolean {
  return testPrivateRegExp(pattern, value);
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}

function objectEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return ReflectApply(ObjectEntries, Object, [value]) as Array<[string, unknown]>;
}

function objectKeys<TValue extends object>(value: TValue): string[] {
  return ReflectApply(ObjectKeys, Object, [value]) as string[];
}

function reflectGet(target: Record<string, unknown>, key: string): unknown {
  return ReflectApply(ReflectGet, Reflect, [target, key]);
}

function defineOwnDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  ReflectApply(ObjectDefineProperty, Object, [target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  }]);
}

function numberIsInteger(value: number): boolean {
  return ReflectApply(NumberIsInteger, Number, [value]) as boolean;
}

function numberIsSafeInteger(value: number): boolean {
  return ReflectApply(NumberIsSafeInteger, Number, [value]) as boolean;
}

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

function readOwnDataDescriptor(
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
  return descriptor && ObjectHasOwn(descriptor, "value") ? descriptor : undefined;
}

function readProviderControl(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
  key: string,
): PropertyDescriptor | undefined {
  const provider = resolveModelCallProvider(model);
  let selected: PropertyDescriptor | undefined;
  // The protocol's bucket first, so a provider-named bucket still takes precedence.
  const bucketNames = [resolveModelCallProtocol(model), provider, model.provider ?? provider];
  forEachPrivateArray(bucketNames, (name) => {
    if (!name) return;
    const bucket = readOwnDataDescriptor(options.providerOptions, name)?.value;
    if (ArrayIsArray(bucket)) return;
    selected = readOwnEnumerableDataDescriptor(bucket, key) ?? selected;
  });
  return selected;
}

function readRequiredProviderDataBucket(
  providerOptions: unknown,
  providerName: string,
): unknown {
  if (providerOptions === null || typeof providerOptions !== "object") return undefined;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      providerOptions,
      providerName,
    ]) as
      | PropertyDescriptor
      | undefined;
  } catch {
    throw new TypeError(`Provider options for "${providerName}" could not be read`);
  }
  if (!descriptor) return undefined;
  if (!ObjectHasOwn(descriptor, "value")) {
    throw new TypeError(`Provider options for "${providerName}" must be a data property`);
  }
  return descriptor.value;
}

function readGoogleProviderControl(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
  key: string,
): PropertyDescriptor | undefined {
  const provider = resolveModelCallProvider(model);
  let selected: PropertyDescriptor | undefined;
  const bucketNames = [resolveModelCallProtocol(model), provider, model.provider ?? provider];
  forEachPrivateArray(bucketNames, (name) => {
    if (!name) return;
    const bucket = readRequiredProviderDataBucket(options.providerOptions, name);
    if (ArrayIsArray(bucket)) return;
    selected = readOwnEnumerableDataDescriptor(bucket, key) ?? selected;
  });
  return selected;
}

function numberControl(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function ownNumberControl(
  value: Record<string, unknown>,
  key: string,
): { present: boolean; value: number | undefined } {
  if (!ObjectHasOwn(value, key)) return { present: false, value: undefined };
  return { present: true, value: numberControl(value[key]) };
}

function stopControl(value: unknown): string[] | undefined {
  return ArrayIsArray(value) && everyPrivateArray(value, (item) => typeof item === "string")
    ? slicePrivateArray(value)
    : undefined;
}

function isNativeOpenAIChatModel(modelId: string | undefined): boolean {
  return typeof modelId === "string" && regexpTest(NativeOpenAIChatModelPattern, modelId);
}

function hasOpenAITransportMetadata(model: ModelCallRuntimeMetadata): boolean {
  return model.openAITransport === "auto" ||
    model.openAITransport === "chat-completions" ||
    model.openAITransport === "responses";
}

function usesOpenAIBuilder(model: ModelCallRuntimeMetadata): boolean {
  const provider = resolveModelCallProvider(model);
  if (provider === "openai" || hasOpenAITransportMetadata(model)) return true;
  if (model.provider !== "veryfront-cloud" || provider === undefined) return false;
  // A model built by this package records the facts it was built with.
  const built = readVeryfrontCloudModelFacts(model);
  return (built?.surface ?? resolveVeryfrontCloudProviderRouting(provider).surface) === "openai";
}

function requestUsesOpenAIHostedTool(options: ModelCallRequestSource): boolean {
  return ArrayIsArray(options.tools) &&
    somePrivateArray(
      options.tools,
      (tool) => tool.type === "provider" && stringStartsWith(tool.id, "openai."),
    );
}

function managedOpenAITransport(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): "chat-completions" | "responses" | undefined {
  if (model.provider !== "veryfront-cloud" || !model.modelId) return undefined;
  const provider = resolveModelCallProvider(model);
  if (provider === undefined) return undefined;
  // The model itself is built from this same plan, so the transport recorded
  // against the call is the one the request is built with. A provider that is
  // not native to the OpenAI surface never reaches the Responses transport,
  // whatever its model IDs look like.
  const usesHostedTool = requestUsesOpenAIHostedTool(options);
  const built = readVeryfrontCloudModelFacts(model);
  if (built) {
    if (built.transportPlan.pinned) return built.transportPlan.transport;
    return usesHostedTool ? "responses" : "chat-completions";
  }
  return resolveVeryfrontCloudOpenAICallTransport(provider, model.modelId, usesHostedTool);
}

function directOpenAITransport(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): "chat-completions" | "responses" | undefined {
  if (typeof model.modelId !== "string") return undefined;
  if (model.openAITransport === "chat-completions" || model.openAITransport === "responses") {
    return model.openAITransport;
  }
  if (model.openAITransport !== "auto" || !usesOpenAIBuilder(model)) return undefined;
  return isOpenAIReasoningModel(model.modelId, openAIProviderName(model)) ||
      requestUsesOpenAIHostedTool(options)
    ? "responses"
    : "chat-completions";
}

function resolveOpenAIContextTransport(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): "chat-completions" | "responses" | undefined {
  return managedOpenAITransport(model, options) ?? directOpenAITransport(model, options);
}

function openAIProviderName(model: ModelCallRuntimeMetadata): string {
  if (model.provider === "veryfront-cloud") return "veryfront-cloud";
  return resolveModelCallProvider(model) ?? "openai";
}

function isProviderOptionsBucket(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !ArrayIsArray(value);
}

function readModelCallProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
  providerNames: readonly string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (!providerOptions) return output;

  forEachPrivateArray(providerNames, (providerName) => {
    let ownsKey: boolean;
    let value: unknown;
    try {
      ownsKey = ObjectHasOwn(providerOptions, providerName);
      if (!ownsKey) return;
      value = reflectGet(providerOptions, providerName);
    } catch {
      throw new TypeError(`Provider options for "${providerName}" could not be read`);
    }
    if (!isProviderOptionsBucket(value)) return;

    let entries: Array<[string, unknown]>;
    try {
      entries = objectEntries(value);
    } catch {
      throw new TypeError(`Provider options for "${providerName}" could not be enumerated`);
    }
    forEachPrivateArray(entries, (entry) => {
      defineOwnDataProperty(output, entry[0], entry[1]);
    });
  });

  return output;
}

function normalizeOpenAIProviderOptionsForChat(
  providerOptions: Record<string, unknown>,
  modelId: string | undefined,
): Record<string, unknown> {
  if (!isNativeOpenAIChatModel(modelId) || !ObjectHasOwn(providerOptions, "max_tokens")) {
    return providerOptions;
  }
  const normalized: Record<string, unknown> = {};
  forEachPrivateArray(objectKeys(providerOptions), (key) => {
    if (key !== "max_tokens") defineOwnDataProperty(normalized, key, providerOptions[key]);
  });
  if (!ObjectHasOwn(normalized, "max_completion_tokens")) {
    defineOwnDataProperty(normalized, "max_completion_tokens", providerOptions.max_tokens);
  }
  return normalized;
}

function openAIProviderOptions(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): Record<string, unknown> {
  const providerName = openAIProviderName(model);
  const providerOptions = options.providerOptions as Record<string, unknown> | undefined;
  const bucketNames = providerName === "openai"
    ? ["openai-compatible", "openai", providerName]
    : ["openai", providerName];
  return readModelCallProviderOptions(providerOptions, bucketNames);
}

function openAIChatProviderOptions(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): Record<string, unknown> {
  const providerName = openAIProviderName(model);
  const providerOptionsSource = options.providerOptions as Record<string, unknown> | undefined;
  const bucketNames = providerName === "openai"
    ? ["openai-compatible", "openai", providerName]
    : ["openai", providerName];
  const providerOptions: Record<string, unknown> = {};
  forEachPrivateArray(bucketNames, (bucketName) => {
    const normalized = normalizeOpenAIProviderOptionsForChat(
      readModelCallProviderOptions(providerOptionsSource, [bucketName]),
      model.modelId,
    );
    forEachPrivateArray(objectKeys(normalized), (key) => {
      defineOwnDataProperty(providerOptions, key, normalized[key]);
    });
  });
  return providerOptions;
}

function resolveOpenAIChatMaxOutputTokens(
  model: ModelCallRuntimeMetadata,
  providerOptions: Record<string, unknown>,
): { present: boolean; value: number | undefined } {
  const keys = isNativeOpenAIChatModel(model.modelId)
    ? ["max_completion_tokens", "max_tokens"]
    : ["max_tokens"];
  let selected: { present: boolean; value: number | undefined } | undefined;
  forEachPrivateArray(keys, (key) => {
    if (selected) return;
    const native = ownNumberControl(providerOptions, key);
    if (native.present) selected = native;
  });
  return selected ?? { present: false, value: undefined };
}

function resolveOpenAIMaxOutputTokens(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
  responsesProviderOptions: Record<string, unknown>,
  transport: "chat-completions" | "responses" | undefined,
): number | undefined {
  const responsesMaxOutputTokens = ownNumberControl(responsesProviderOptions, "max_output_tokens");
  if (transport === "responses") {
    return responsesMaxOutputTokens.present
      ? responsesMaxOutputTokens.value
      : options.maxOutputTokens;
  }

  const chatMaxOutputTokens = resolveOpenAIChatMaxOutputTokens(
    model,
    openAIChatProviderOptions(model, options),
  );
  if (transport === "chat-completions") {
    return chatMaxOutputTokens.present ? chatMaxOutputTokens.value : options.maxOutputTokens;
  }
  if (responsesMaxOutputTokens.present && !chatMaxOutputTokens.present) {
    return responsesMaxOutputTokens.value;
  }
  if (chatMaxOutputTokens.present && !responsesMaxOutputTokens.present) {
    return chatMaxOutputTokens.value;
  }
  return options.maxOutputTokens;
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
  const protocol = resolveModelCallProtocol(model);
  if (protocol === "anthropic") return resolveAnthropicControls(model, options);
  if (protocol === "google") return resolveGoogleControls(model, options);
  if (!usesOpenAIBuilder(model)) {
    return options;
  }
  const providerOptions = openAIProviderOptions(model, options);
  const transport = resolveOpenAIContextTransport(model, options);
  // Native reasoning is merged after neutral sampling is filtered.
  const dropSampling = resolveOpenAINeutralReasoning(model, options)?.enabled === true ||
    (typeof model.modelId === "string" && (rejectsOpenAISamplingParams(model.modelId) ||
      (transport !== "responses" && regexpTest(/^kimi-k2\.5/, model.modelId))));
  const effective = {
    ...options,
    maxOutputTokens: resolveOpenAIMaxOutputTokens(model, options, providerOptions, transport),
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
  forEachPrivateArray(
    [
      ["temperature", "temperature"],
      ["topP", "top_p"],
      ["presencePenalty", "presence_penalty"],
      ["frequencyPenalty", "frequency_penalty"],
    ] as const,
    (fieldPair) => {
      const field = fieldPair[0];
      const nativeField = fieldPair[1];
      // Native options merge after neutral filtering in both OpenAI builders.
      const value = ObjectHasOwn(providerOptions, nativeField)
        ? providerOptions[nativeField]
        : dropSampling ||
            (transport === "responses" &&
              (field === "presencePenalty" || field === "frequencyPenalty"))
        ? undefined
        : options[field];
      effective[field] = typeof value === "number" ? value : undefined;
    },
  );
  return effective;
}

function resolveAnthropicMaxOutputTokens(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): number | undefined {
  const native = readProviderControl(model, options, "max_tokens");
  return native ? numberControl(native.value) : options.maxOutputTokens;
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
  forEachPrivateArray(
    [
      ["temperature", "temperature"],
      ["topP", "top_p"],
      ["topK", "top_k"],
      ["seed", "seed"],
      ["presencePenalty", "presence_penalty"],
      ["frequencyPenalty", "frequency_penalty"],
    ] as const,
    (entry) => {
      const field = entry[0];
      const nativeField = entry[1];
      const native = readProviderControl(model, options, nativeField);
      effective[field] = native
        ? numberControl(native.value)
        : !thinkingEnabled && (field === "temperature" || field === "topP")
        ? options[field]
        : undefined;
    },
  );
  const stops = readProviderControl(model, options, "stop_sequences");
  effective.stopSequences = stops
    ? stopControl(stops.value)
    : options.stopSequences?.length
    ? slicePrivateArray(options.stopSequences, 0, 4)
    : undefined;
  // Native Anthropic options merge after the neutral request body, so a raw
  // max_tokens override is the effective output limit recorded for replay.
  effective.maxOutputTokens = resolveAnthropicMaxOutputTokens(model, options);
  return effective;
}

function resolveGoogleControls(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequestSource {
  const native = readGoogleProviderControl(model, options, "generationConfig");
  const effective = {
    ...options,
    presencePenalty: undefined as number | undefined,
    frequencyPenalty: undefined as number | undefined,
    stopSequences: options.stopSequences?.length ? options.stopSequences : undefined,
  };
  if (!native) return effective;
  // The builder replaces generationConfig wholesale, rather than merging
  // its fields over the neutral controls.
  forEachPrivateArray(
    [
      "maxOutputTokens",
      "temperature",
      "topP",
      "topK",
      "seed",
      "presencePenalty",
      "frequencyPenalty",
    ] as const,
    (field) => {
      effective[field] = numberControl(readOwnEnumerableDataDescriptor(native.value, field)?.value);
    },
  );
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
    ...(options.stopSequences !== undefined
      ? { stopSequences: slicePrivateArray(options.stopSequences) }
      : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.presencePenalty !== undefined ? { presencePenalty: options.presencePenalty } : {}),
    ...(options.frequencyPenalty !== undefined
      ? { frequencyPenalty: options.frequencyPenalty }
      : {}),
    ...(projectedReasoning && objectKeys(projectedReasoning).length > 0
      ? { reasoning: projectedReasoning }
      : {}),
  };
  return objectKeys(request).length > 0 ? request : undefined;
}

/** Resolve the canonical provider recorded by the existing durable contract. */
/**
 * The wire protocol a model's request is built for. A Veryfront Cloud model
 * speaks the surface it settled on, so a newly served provider on the Anthropic
 * or Google surface records the same native controls as `anthropic/*` or
 * `google/*`. Other models are identified by their provider name.
 */
function resolveModelCallProtocol(model: ModelCallRuntimeMetadata): string | undefined {
  const surface = readVeryfrontCloudModelFacts(model)?.surface;
  if (surface === "anthropic" || surface === "google") return surface;
  return resolveModelCallProvider(model);
}

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
  if (resolveModelCallProtocol(model) === "google") return resolveGoogleReasoning(model, options);
  if (usesOpenAIBuilder(model) && typeof model.modelId === "string") {
    const neutral = resolveOpenAINeutralReasoning(model, options);
    const transport = resolveOpenAIContextTransport(model, options);
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
  // The capability is recorded for OpenAI's own models. Another provider on the
  // same wire surface builds its request without it, so the recorded context
  // must not apply it either.
  if (resolveModelCallProvider(model) !== "openai" || model.provider !== "veryfront-cloud") {
    return false;
  }
  const catalogId = `openai/${model.modelId}`;
  const built = readVeryfrontCloudModelFacts(model);
  const openAITransport = built
    ? built.openAITransport
    : resolveVeryfrontCloudOpenAITransport(catalogId);
  const reasoningWithFunctionTools = built
    ? built.openAIChatReasoningWithFunctionTools
    : resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(catalogId);
  if (
    model.provider === "veryfront-cloud" &&
    openAITransport === "chat-completions" &&
    reasoningWithFunctionTools === false
  ) {
    // Match the Chat builder's native bucket precedence, including an own
    // tools value that clears the neutral list with [] or undefined.
    const providerOptions = openAIProviderOptions(model, options);
    const tools = ObjectHasOwn(providerOptions, "tools") ? providerOptions.tools : options.tools;
    if (
      ArrayIsArray(tools) &&
      somePrivateArray(
        tools,
        (tool) =>
          tool !== null && typeof tool === "object" && "type" in tool && tool.type === "function",
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
    openAIProviderName(model),
    options.reasoning,
  );
  return reasoning ? { enabled: true, effort: reasoning.effort } : options.reasoning;
}

function resolveNonOpenAIReasoning(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): RuntimeReasoningOption | undefined {
  // The Anthropic request builder only gives neutral reasoning precedence when
  // it enables thinking; otherwise a raw provider thinking config remains effective.
  if (resolveModelCallProtocol(model) !== "anthropic" || options.reasoning?.enabled === true) {
    return options.reasoning;
  }

  const thinking = readProviderControl(model, options, "thinking")?.value;
  if (!thinking || typeof thinking !== "object" || ArrayIsArray(thinking)) {
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
      ...(typeof budgetTokens === "number" && numberIsInteger(budgetTokens) && budgetTokens >= 0
        ? { budgetTokens }
        : {}),
    };
  }

  // Structured output is pinned again after provider options are merged.
  const outputConfig = options.responseFormat?.type === "json_schema"
    ? undefined
    : readProviderControl(model, options, "output_config")?.value;
  const effort = outputConfig && typeof outputConfig === "object" && !ArrayIsArray(outputConfig)
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
  const native = readGoogleProviderControl(model, options, "generationConfig");
  if (!native) return options.reasoning;
  const thinking = readOwnEnumerableDataDescriptor(native.value, "thinkingConfig")?.value;
  const budget = readOwnEnumerableDataDescriptor(thinking, "thinkingBudget")?.value;
  if (typeof budget !== "number" || !numberIsSafeInteger(budget) || budget < -1) return undefined;
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
