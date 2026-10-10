import type {
  ModelRuntimeCallOptions,
  RuntimeMetadata,
  RuntimeReasoningOption,
} from "#veryfront/provider/types.ts";
import { unwrapToolInputSchema } from "#veryfront/provider/shared/index.ts";
import { snapshotProviderJsonValue } from "#veryfront/provider/runtime-loader/json-snapshot.ts";
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
import {
  canIdentifyNonPlainBuiltinsWithoutHooks,
  canIdentifyProxyWithoutHooks,
  isNonPlainBuiltinWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import type {
  ModelCallMessage,
  ModelCallRequest,
  ModelCallResponseFormat,
  ModelCallTool,
} from "./model-call-context.ts";

type ModelCallRuntimeMetadata = Pick<
  RuntimeMetadata,
  "modelId" | "provider" | "modelProvider" | "openAITransport"
>;
type ModelCallRequestSource =
  & Pick<ModelRuntimeCallOptions, keyof ModelCallRequest | "tools" | "responseFormat">
  & {
    providerOptions?: unknown;
  };

type SnapshotContainer = Record<PropertyKey, unknown> | readonly unknown[];

const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const ArrayIsArray = Array.isArray;
const MathMin = Math.min;
const NativeWeakSet = WeakSet;
const PreservedResponseFormatSchemas = new NativeWeakSet<SnapshotContainer>();
const NativeDate = Date;
const NativeNumber = Number;
const NativeURL = URL;
const NativeString = String;
const BigIntPrototypeValueOf = BigInt.prototype.valueOf;
const BooleanPrototypeValueOf = Boolean.prototype.valueOf;
const NumberPrototypeValueOf = Number.prototype.valueOf;
const StringPrototypeValueOf = String.prototype.valueOf;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeDelete = WeakSet.prototype.delete;
const WeakSetPrototypeHas = WeakSet.prototype.has;
const DatePrototypeGetTime = Date.prototype.getTime;
const DatePrototypeToISOString = Date.prototype.toISOString;
const URLHrefGetter = Object.getOwnPropertyDescriptor(URL.prototype, "href")?.get;
const NumberIsFinite = Number.isFinite;
const NumberIsInteger = Number.isInteger;
const NumberIsSafeInteger = Number.isSafeInteger;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeIncludes = String.prototype.includes;
const StructuredCloneValue = globalThis.structuredClone;
const NativeArrayPrototype = Array.prototype;
const NativeObjectPrototype = Object.prototype;
const NativeOpenAIChatModelPattern = /^(gpt-|o[134](-|$)|chatgpt-)/;

function regexpTest(pattern: RegExp, value: string): boolean {
  return testPrivateRegExp(pattern, value);
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function objectKeys(value: Record<string, unknown> | ModelCallRequest): string[] {
  return ReflectApply(ObjectKeys, Object, [value]) as string[];
}

function reflectOwnKeys(value: SnapshotContainer): PropertyKey[] {
  return ReflectApply(ReflectOwnKeys, undefined, [value]) as PropertyKey[];
}

function createNullRecord(): Record<string, unknown> {
  return ReflectApply(ObjectCreate, Object, [null]) as Record<string, unknown>;
}

function objectFreeze<TValue extends SnapshotContainer>(value: TValue): TValue {
  return ReflectApply(ObjectFreeze, Object, [value]) as TValue;
}

function defineOwnDataProperty(target: SnapshotContainer, key: PropertyKey, value: unknown): void {
  ReflectApply(ObjectDefineProperty, Object, [target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  }]);
}

function defineHiddenImmutableProperty(
  target: SnapshotContainer,
  key: PropertyKey,
  value: unknown,
): void {
  ReflectApply(ObjectDefineProperty, Object, [target, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  }]);
}

function weakSetAdd(set: WeakSet<SnapshotContainer>, value: SnapshotContainer): void {
  ReflectApply(WeakSetPrototypeAdd, set, [value]);
}

function weakSetDelete(set: WeakSet<SnapshotContainer>, value: SnapshotContainer): void {
  ReflectApply(WeakSetPrototypeDelete, set, [value]);
}

function weakSetHas(set: WeakSet<SnapshotContainer>, value: SnapshotContainer): boolean {
  return ReflectApply(WeakSetPrototypeHas, set, [value]) as boolean;
}

function markPreservedResponseFormatSchema(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    weakSetAdd(PreservedResponseFormatSchemas, value as SnapshotContainer);
  }
  return value;
}

function shouldUnwrapResponseFormatSchema(value: unknown): boolean {
  return value === null || typeof value !== "object" ||
    !weakSetHas(PreservedResponseFormatSchemas, value as SnapshotContainer);
}

function snapshotPreservedResponseFormatSchema(value: unknown): unknown {
  return markPreservedResponseFormatSchema(snapshotProviderOptionValue(
    "responseFormat",
    value,
    { ancestors: new NativeWeakSet<SnapshotContainer>(), nodes: 0 },
    0,
  ));
}

function numberIsFinite(value: number): boolean {
  return ReflectApply(NumberIsFinite, Number, [value]) as boolean;
}

function numberIsInteger(value: number): boolean {
  return ReflectApply(NumberIsInteger, Number, [value]) as boolean;
}

function numberIsSafeInteger(value: number): boolean {
  return ReflectApply(NumberIsSafeInteger, Number, [value]) as boolean;
}

function mathMin(...values: number[]): number {
  return ReflectApply(MathMin, Math, values) as number;
}

function readDateTime(value: unknown): number | undefined {
  try {
    return ReflectApply(DatePrototypeGetTime, value, []) as number;
  } catch {
    return undefined;
  }
}

function isBoxedBigInt(value: unknown): boolean {
  try {
    ReflectApply(BigIntPrototypeValueOf, value, []);
    return true;
  } catch {
    return false;
  }
}

function readBoxedBoolean(value: unknown): boolean | undefined {
  try {
    return ReflectApply(BooleanPrototypeValueOf, value, []) as boolean;
  } catch {
    return undefined;
  }
}

function readBoxedNumber(value: unknown): number | undefined {
  try {
    return ReflectApply(NumberPrototypeValueOf, value, []) as number;
  } catch {
    return undefined;
  }
}

function readBoxedString(value: unknown): string | undefined {
  try {
    return ReflectApply(StringPrototypeValueOf, value, []) as string;
  } catch {
    return undefined;
  }
}

function cloneDate(value: unknown): Date | undefined {
  const time = readDateTime(value);
  return time === undefined ? undefined : new NativeDate(time);
}

function readDateJsonValue(value: unknown): { present: boolean; value: string | null } {
  const time = readDateTime(value);
  if (time === undefined) return { present: false, value: null };
  if (!numberIsFinite(time)) return { present: true, value: null };
  return {
    present: true,
    value: ReflectApply(DatePrototypeToISOString, value, []) as string,
  };
}

function readUrlHref(value: unknown): string | undefined {
  if (!URLHrefGetter) return undefined;
  try {
    const href = ReflectApply(URLHrefGetter, value, []) as unknown;
    return typeof href === "string" ? href : undefined;
  } catch {
    return undefined;
  }
}

function objectGetPrototypeOf(value: SnapshotContainer): object | null {
  return ReflectApply(ObjectGetPrototypeOf, Object, [value]) as object | null;
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
  const provider = model.provider ?? resolveModelCallProvider(model);
  let selected: PropertyDescriptor | undefined;
  // The protocol's bucket first, so the dispatched provider bucket still takes precedence.
  const bucketNames = [resolveModelCallProtocol(model), provider];
  forEachPrivateArray(bucketNames, (name) => {
    if (!name) return;
    const bucket = readOwnDataDescriptor(options.providerOptions, name)?.value;
    if (ArrayIsArray(bucket)) return;
    selected = readOwnEnumerableDataDescriptor(bucket, key) ?? selected;
  });
  return selected;
}

function readRequiredProviderDataBucketEntry(
  providerOptions: unknown,
  providerName: string,
): { present: boolean; value: unknown } {
  if (providerOptions === null || typeof providerOptions !== "object") {
    return { present: false, value: undefined };
  }
  const entry = readProviderOptionsBucketEntry(providerOptions as SnapshotContainer, providerName);
  return { present: entry.present, value: entry.value };
}

function readProviderOptionsBucketEntry(
  providerOptions: SnapshotContainer,
  providerName: string,
): { enumerable: boolean; present: boolean; value: unknown } {
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
  if (!descriptor) return { enumerable: false, present: false, value: undefined };
  if (!ObjectHasOwn(descriptor, "value")) {
    throw new TypeError(`Provider options for "${providerName}" must be a data property`);
  }
  return { enumerable: descriptor.enumerable === true, present: true, value: descriptor.value };
}

function readRequiredProviderDataBucket(
  providerOptions: unknown,
  providerName: string,
): unknown {
  return readRequiredProviderDataBucketEntry(providerOptions, providerName).value;
}

function readRequiredProviderOptionEntry(
  providerName: string,
  bucket: SnapshotContainer,
  key: PropertyKey,
  requireEnumerable = true,
): { present: boolean; value: unknown } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [bucket, key]) as
      | PropertyDescriptor
      | undefined;
  } catch {
    throw new TypeError(`Provider options for "${providerName}" could not be enumerated`);
  }
  if (!descriptor || (requireEnumerable && descriptor.enumerable !== true)) {
    return { present: false, value: undefined };
  }
  if (!ObjectHasOwn(descriptor, "value")) {
    throw new TypeError(`Provider options for "${providerName}" must contain data properties`);
  }
  return { present: true, value: descriptor.value };
}

function readRequiredProviderOption(
  providerName: string,
  bucket: SnapshotContainer,
  key: string,
): unknown {
  return readRequiredProviderOptionEntry(providerName, bucket, key).value;
}

function readGoogleProviderControl(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
  key: string,
): PropertyDescriptor | undefined {
  const provider = model.provider ?? resolveModelCallProvider(model);
  let selected: PropertyDescriptor | undefined;
  const bucketNames = [resolveModelCallProtocol(model), provider];
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

function openAIProviderBucketNames(model: ModelCallRuntimeMetadata): readonly string[] {
  const providerName = openAIProviderName(model);
  return providerName === "openai" ? ["openai-compatible", "openai"] : ["openai", providerName];
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
    const value = readRequiredProviderDataBucket(providerOptions, providerName);
    if (!isProviderOptionsBucket(value)) return;

    let keys: string[];
    try {
      keys = objectKeys(value);
    } catch {
      throw new TypeError(`Provider options for "${providerName}" could not be enumerated`);
    }
    forEachPrivateArray(keys, (key) => {
      defineOwnDataProperty(output, key, readRequiredProviderOption(providerName, value, key));
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
  const providerOptions = options.providerOptions as Record<string, unknown> | undefined;
  return readModelCallProviderOptions(providerOptions, openAIProviderBucketNames(model));
}

function openAIChatProviderOptions(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): Record<string, unknown> {
  const providerOptionsSource = options.providerOptions as Record<string, unknown> | undefined;
  const bucketNames = openAIProviderBucketNames(model);
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

function readNativeOpenAIJsonSchemaResponseFormat(
  value: unknown,
): ModelCallResponseFormat | undefined {
  if (!isProviderOptionsBucket(value)) return undefined;
  const name = readOwnEnumerableDataDescriptor(value, "name")?.value;
  if (typeof name !== "string") return undefined;
  const schema = readOwnEnumerableDataDescriptor(value, "schema")?.value;
  if (schema === undefined) return undefined;
  const description = readOwnEnumerableDataDescriptor(value, "description")?.value;
  const strict = readOwnEnumerableDataDescriptor(value, "strict")?.value;
  return {
    type: "json_schema",
    name,
    schema: snapshotPreservedResponseFormatSchema(schema),
    ...(typeof description === "string" ? { description } : {}),
    ...(typeof strict === "boolean" ? { strict } : {}),
  };
}

function readNativeOpenAIResponseFormat(value: unknown): ModelCallResponseFormat | undefined {
  if (!isProviderOptionsBucket(value)) return undefined;
  const type = readOwnEnumerableDataDescriptor(value, "type")?.value;
  if (type === "text") return { type: "text" };
  if (type === "json_object") return { type: "json" };
  if (type !== "json_schema") return undefined;
  return readNativeOpenAIJsonSchemaResponseFormat(
    readOwnEnumerableDataDescriptor(value, "json_schema")?.value ?? value,
  );
}

function resolveOpenAIResponseFormat(
  options: ModelCallRequestSource,
  providerOptions: Record<string, unknown>,
  transport: "chat-completions" | "responses" | undefined,
): ModelCallResponseFormat | undefined {
  if (transport === "chat-completions" && ObjectHasOwn(providerOptions, "response_format")) {
    return readNativeOpenAIResponseFormat(providerOptions.response_format);
  }
  if (transport === "responses" && ObjectHasOwn(providerOptions, "text")) {
    const text = providerOptions.text;
    if (!isProviderOptionsBucket(text) || !ObjectHasOwn(text, "format")) return undefined;
    return readNativeOpenAIResponseFormat(text.format);
  }
  return snapshotOpenAICaptureResponseFormat(options.responseFormat, {
    responsesJsonSchemaStrictDefault: transport === "responses",
  });
}

const MaxProviderOptionSnapshotDepth = 64;
const MaxProviderOptionSnapshotNodes = 65_536;

type ProviderOptionSnapshotState = {
  ancestors: WeakSet<SnapshotContainer>;
  nodes: number;
};

function snapshotProviderOptionNode(
  providerName: string,
  state: ProviderOptionSnapshotState,
): void {
  if (state.nodes >= MaxProviderOptionSnapshotNodes) {
    throw new TypeError(`Provider options for "${providerName}" exceeded the snapshot node limit`);
  }
  state.nodes += 1;
}

function readRequiredArrayLength(providerName: string, value: SnapshotContainer): number {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [value, "length"]) as
      | PropertyDescriptor
      | undefined;
  } catch {
    throw new TypeError(`Provider options for "${providerName}" could not be enumerated`);
  }
  if (!descriptor || !ObjectHasOwn(descriptor, "value") || !numberIsSafeInteger(descriptor.value)) {
    throw new TypeError(`Provider options for "${providerName}" contained an invalid array`);
  }
  const length = descriptor.value as number;
  if (length > MaxProviderOptionSnapshotNodes - 1) {
    throw new TypeError(`Provider options for "${providerName}" exceeded the snapshot node limit`);
  }
  return length;
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (key === "") return false;
  const index = NativeNumber(key);
  return numberIsInteger(index) && index >= 0 && index < length && NativeString(index) === key;
}

function snapshotProviderOptionValue(
  providerName: string,
  value: unknown,
  state: ProviderOptionSnapshotState,
  depth: number,
): unknown {
  snapshotProviderOptionNode(providerName, state);
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (numberIsFinite(value)) return value;
      break;
    case "object":
      break;
    default:
      break;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Provider options for "${providerName}" must contain JSON-safe values`);
  }
  if (isBoxedBigInt(value)) {
    throw new TypeError(`Provider options for "${providerName}" must contain JSON-safe values`);
  }
  const boxedBoolean = readBoxedBoolean(value);
  if (boxedBoolean !== undefined) return boxedBoolean;
  const boxedNumber = readBoxedNumber(value);
  if (boxedNumber !== undefined) {
    if (numberIsFinite(boxedNumber)) return boxedNumber;
    throw new TypeError(`Provider options for "${providerName}" must contain JSON-safe values`);
  }
  const boxedString = readBoxedString(value);
  if (boxedString !== undefined) return boxedString;
  const dateJson = readDateJsonValue(value);
  if (dateJson.present) return dateJson.value;
  const urlHref = readUrlHref(value);
  if (urlHref !== undefined) return urlHref;
  const container = value as SnapshotContainer;
  if (depth >= MaxProviderOptionSnapshotDepth) {
    throw new TypeError(`Provider options for "${providerName}" exceeded the snapshot depth limit`);
  }
  if (weakSetHas(state.ancestors, container)) {
    throw new TypeError(`Provider options for "${providerName}" must not contain cycles`);
  }

  weakSetAdd(state.ancestors, container);
  try {
    let keys: PropertyKey[];
    try {
      keys = reflectOwnKeys(container);
    } catch {
      throw new TypeError(`Provider options for "${providerName}" could not be enumerated`);
    }

    if (ArrayIsArray(container)) {
      const output: unknown[] = [];
      const length = readRequiredArrayLength(providerName, container);
      output.length = length;
      forEachPrivateArray(keys, (key) => {
        if (typeof key !== "string" || key === "length") return;
        if (!isArrayIndexKey(key, length)) return;
        const entry = readRequiredProviderOptionEntry(providerName, container, key, false);
        if (entry.present) {
          defineOwnDataProperty(
            output,
            key,
            snapshotProviderOptionValue(providerName, entry.value, state, depth + 1),
          );
        }
      });
      defineHiddenImmutableProperty(output, "toJSON", undefined);
      return objectFreeze(output);
    }

    const output = createNullRecord();
    forEachPrivateArray(keys, (key) => {
      if (typeof key !== "string") {
        throw new TypeError(`Provider options for "${providerName}" must not contain symbol keys`);
      }
      const entry = readRequiredProviderOptionEntry(providerName, container, key);
      if (entry.present) {
        defineOwnDataProperty(
          output,
          key,
          snapshotProviderOptionValue(providerName, entry.value, state, depth + 1),
        );
      }
    });
    return objectFreeze(output);
  } finally {
    weakSetDelete(state.ancestors, container);
  }
}

function snapshotProviderBucket(providerName: string, bucket: unknown): unknown {
  return snapshotProviderOptionValue(
    providerName,
    bucket,
    { ancestors: new NativeWeakSet<SnapshotContainer>(), nodes: 0 },
    0,
  );
}

const MaxModelCallInputSnapshotDepth = 64;
const MaxModelCallInputSnapshotNodes = 65_536;

type ModelCallInputSnapshotState = {
  ancestors: WeakSet<SnapshotContainer>;
  nodes: number;
  urlRepresentation: "instance" | "href";
  valuesAreOwned: boolean;
};

type ModelCallInputPath =
  | "semantic"
  | "promptArray"
  | "promptMessage"
  | "messageContentArray"
  | "messageContentPart"
  | "toolOutput"
  | "opaque"
  | "providerToolCallsArray"
  | "providerToolCall"
  | "toolsArray"
  | "toolDefinition";

function snapshotModelCallInputNode(label: string, state: ModelCallInputSnapshotState): void {
  if (state.nodes >= MaxModelCallInputSnapshotNodes) {
    throw new TypeError(`Model call ${label} exceeded the snapshot node limit`);
  }
  state.nodes += 1;
}

function readRequiredModelCallInputArrayLength(label: string, value: SnapshotContainer): number {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [value, "length"]) as
      | PropertyDescriptor
      | undefined;
  } catch {
    throw new TypeError(`Model call ${label} could not be enumerated`);
  }
  if (!descriptor || !ObjectHasOwn(descriptor, "value") || !numberIsSafeInteger(descriptor.value)) {
    throw new TypeError(`Model call ${label} contained an invalid array`);
  }
  const length = descriptor.value as number;
  if (length > MaxModelCallInputSnapshotNodes - 1) {
    throw new TypeError(`Model call ${label} exceeded the snapshot node limit`);
  }
  return length;
}

function readRequiredModelCallInputEntry(
  label: string,
  container: SnapshotContainer,
  key: PropertyKey,
): { present: boolean; descriptor: PropertyDescriptor | undefined } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [container, key]) as
      | PropertyDescriptor
      | undefined;
  } catch {
    throw new TypeError(`Model call ${label} could not be enumerated`);
  }
  if (!descriptor) return { present: false, descriptor: undefined };
  if (!ObjectHasOwn(descriptor, "value")) {
    throw new TypeError(`Model call ${label} must contain data properties`);
  }
  return { present: true, descriptor };
}

function defineSnapshotDataProperty(
  target: SnapshotContainer,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  value: unknown,
): void {
  ReflectApply(ObjectDefineProperty, Object, [target, key, {
    value,
    writable: descriptor.writable === true,
    enumerable: descriptor.enumerable === true,
    configurable: descriptor.configurable === true,
  }]);
}

function isJsonSnapshotArraySerializationGuardDescriptor(
  descriptor: PropertyDescriptor | undefined,
): boolean {
  return descriptor !== undefined &&
    descriptor.value === undefined &&
    descriptor.configurable === false &&
    descriptor.enumerable === false &&
    descriptor.writable === false;
}

function hasJsonSnapshotArraySerializationGuard(value: SnapshotContainer): boolean {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [value, "toJSON"]) as
      | PropertyDescriptor
      | undefined;
  } catch {
    throw new TypeError("Model call input could not be enumerated");
  }
  return isJsonSnapshotArraySerializationGuardDescriptor(descriptor);
}

function shouldSkipModelCallInputProperty(
  label: string,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  validatedJsonSnapshotArrayGuard: boolean,
): boolean {
  if (
    validatedJsonSnapshotArrayGuard &&
    key === "toJSON" &&
    isJsonSnapshotArraySerializationGuardDescriptor(descriptor)
  ) {
    return true;
  }
  if (key === "toJSON" && typeof descriptor.value === "function") {
    throw new TypeError(`Model call ${label} must contain data properties`);
  }
  return false;
}

function assertInspectableModelCallInput(
  label: string,
  value: unknown,
  valuesAreOwned: boolean,
): void {
  if (value === null || typeof value !== "object") return;
  if (!valuesAreOwned && isProxyWithoutHooks(value)) {
    throw new TypeError(`Model call ${label} could not be inspected`);
  }
  if (!valuesAreOwned && !canIdentifyNonPlainBuiltinsWithoutHooks) {
    throw new TypeError(`Model call ${label} could not be inspected`);
  }
  if (!valuesAreOwned && isNonPlainBuiltinWithoutHooks(value)) {
    throw new TypeError(`Model call ${label} could not be inspected`);
  }
}

function assertSupportedModelCallInputPrototype(
  label: string,
  value: SnapshotContainer,
): void {
  const prototype = objectGetPrototypeOf(value);
  if (ArrayIsArray(value)) {
    if (prototype === NativeArrayPrototype) return;
  } else if (prototype === NativeObjectPrototype || prototype === null) {
    return;
  }
  throw new TypeError(`Model call ${label} could not be inspected`);
}

function validateJsonSnapshotArrayGuard(
  label: string,
  value: SnapshotContainer,
  state: ModelCallInputSnapshotState,
  depth: number,
): boolean {
  if (!hasJsonSnapshotArraySerializationGuard(value)) return false;
  try {
    snapshotProviderJsonValue(value, {
      maxDepth: MaxModelCallInputSnapshotDepth - depth,
      maxNodes: MaxModelCallInputSnapshotNodes - state.nodes + 1,
      sortObjectKeys: false,
    });
    return true;
  } catch {
    throw new TypeError(`Model call ${label} could not be inspected`);
  }
}

function structuredCloneModelCallInput(label: string, value: unknown): unknown {
  if (typeof StructuredCloneValue !== "function") {
    throw new TypeError(`Model call ${label} could not be inspected`);
  }
  try {
    return ReflectApply(StructuredCloneValue, globalThis, [value]) as unknown;
  } catch {
    throw new TypeError(`Model call ${label} could not be inspected`);
  }
}

function readModelCallInputString(container: SnapshotContainer, key: string): string | undefined {
  const descriptor = readRequiredModelCallInputEntry("input", container, key).descriptor;
  return typeof descriptor?.value === "string" ? descriptor.value : undefined;
}

function childModelCallInputPath(
  path: ModelCallInputPath,
  container: SnapshotContainer,
  key: PropertyKey,
): { path: ModelCallInputPath; semanticRoot: boolean } {
  if (path === "semantic" || path === "opaque") return { path, semanticRoot: false };
  if (path === "promptArray" && typeof key === "string" && key !== "length") {
    return { path: "promptMessage", semanticRoot: false };
  }
  if (path === "messageContentArray" && typeof key === "string" && key !== "length") {
    return { path: "messageContentPart", semanticRoot: false };
  }
  if (path === "providerToolCallsArray" && typeof key === "string" && key !== "length") {
    return { path: "providerToolCall", semanticRoot: false };
  }
  if (path === "toolsArray" && typeof key === "string" && key !== "length") {
    return { path: "toolDefinition", semanticRoot: false };
  }
  if (path === "promptMessage") {
    const role = readModelCallInputString(container, "role");
    if (key === "content" && (role === "user" || role === "assistant" || role === "tool")) {
      return { path: "messageContentArray", semanticRoot: false };
    }
    if (key === "providerToolCalls") return { path: "providerToolCallsArray", semanticRoot: false };
    if (role === "system" && key === "providerOptions") return { path, semanticRoot: true };
  }
  if (path === "messageContentPart") {
    const type = readModelCallInputString(container, "type");
    if (type === "tool-call" && key === "input") return { path, semanticRoot: true };
    if (type === "tool-result" && key === "result") return { path, semanticRoot: true };
    if (type === "tool-result" && key === "output") {
      return { path: "toolOutput", semanticRoot: false };
    }
  }
  if (path === "toolOutput" && key === "value") return { path, semanticRoot: true };
  if (path === "providerToolCall" && key === "input") return { path, semanticRoot: true };
  if (path === "promptMessage" && key === "providerMetadata") return { path, semanticRoot: true };
  if (path === "toolDefinition") {
    const type = readModelCallInputString(container, "type");
    if (type === "function" && key === "inputSchema") return { path, semanticRoot: true };
    if (type === "provider" && key === "args") return { path, semanticRoot: true };
  }
  return { path: "opaque", semanticRoot: false };
}

function snapshotModelCallSemanticInput(
  label: string,
  value: unknown,
  state: ModelCallInputSnapshotState,
): unknown {
  return snapshotModelCallInputValue(
    label,
    value,
    {
      ancestors: state.ancestors,
      nodes: 0,
      urlRepresentation: state.urlRepresentation,
      valuesAreOwned: state.valuesAreOwned,
    },
    0,
    "semantic",
  );
}

function snapshotModelCallInputChild(
  label: string,
  value: unknown,
  state: ModelCallInputSnapshotState,
  depth: number,
  path: ModelCallInputPath,
  container: SnapshotContainer,
  key: PropertyKey,
): unknown {
  const child = childModelCallInputPath(path, container, key);
  return child.semanticRoot
    ? snapshotModelCallSemanticInput(label, value, state)
    : snapshotModelCallInputValue(label, value, state, depth + 1, child.path);
}

function snapshotModelCallInputValue(
  label: string,
  value: unknown,
  state: ModelCallInputSnapshotState,
  depth: number,
  path: ModelCallInputPath,
): unknown {
  snapshotModelCallInputNode(label, state);
  if (depth > MaxModelCallInputSnapshotDepth) {
    throw new TypeError(`Model call ${label} exceeded the snapshot depth limit`);
  }
  if (value === null || typeof value !== "object") return value;
  const date = cloneDate(value);
  if (date) return date;
  const urlHref = readUrlHref(value);
  if (urlHref !== undefined) {
    return state.urlRepresentation === "href" ? urlHref : new NativeURL(urlHref);
  }
  assertInspectableModelCallInput(label, value, state.valuesAreOwned);
  const container = value as SnapshotContainer;
  assertSupportedModelCallInputPrototype(label, container);
  if (weakSetHas(state.ancestors, container)) {
    throw new TypeError(`Model call ${label} must not contain cycles`);
  }

  weakSetAdd(state.ancestors, container);
  try {
    let arrayLength: number | undefined;
    if (ArrayIsArray(container)) {
      arrayLength = readRequiredModelCallInputArrayLength(label, container);
    }
    let keys: PropertyKey[];
    try {
      keys = reflectOwnKeys(container);
    } catch {
      throw new TypeError(`Model call ${label} could not be enumerated`);
    }

    if (ArrayIsArray(container)) {
      const validatedJsonSnapshotArrayGuard = validateJsonSnapshotArrayGuard(
        label,
        container,
        state,
        depth,
      );
      const output: unknown[] = [];
      const length = arrayLength ?? 0;
      output.length = length;
      forEachPrivateArray(keys, (key) => {
        if (key === "length") return;
        const entry = readRequiredModelCallInputEntry(label, container, key);
        if (!entry.present || !entry.descriptor) return;
        if (
          shouldSkipModelCallInputProperty(
            label,
            key,
            entry.descriptor,
            validatedJsonSnapshotArrayGuard,
          )
        ) return;
        const nested = snapshotModelCallInputChild(
          label,
          entry.descriptor.value,
          state,
          depth,
          path,
          container,
          key,
        );
        defineSnapshotDataProperty(output, key, entry.descriptor, nested);
      });
      return objectFreeze(output);
    }

    const output = createNullRecord();
    forEachPrivateArray(keys, (key) => {
      const entry = readRequiredModelCallInputEntry(label, container, key);
      if (!entry.present || !entry.descriptor) return;
      if (shouldSkipModelCallInputProperty(label, key, entry.descriptor, false)) return;
      const nested = snapshotModelCallInputChild(
        label,
        entry.descriptor.value,
        state,
        depth,
        path,
        container,
        key,
      );
      defineSnapshotDataProperty(output, key, entry.descriptor, nested);
    });
    return objectFreeze(output);
  } finally {
    weakSetDelete(state.ancestors, container);
  }
}

function snapshotModelCallInput(
  label: string,
  value: unknown,
  urlRepresentation: "instance" | "href" = "instance",
): unknown {
  const valuesAreOwned = !canIdentifyProxyWithoutHooks;
  const source = valuesAreOwned ? structuredCloneModelCallInput(label, value) : value;
  return snapshotModelCallInputValue(
    label,
    source,
    {
      ancestors: new NativeWeakSet<SnapshotContainer>(),
      nodes: 0,
      urlRepresentation,
      valuesAreOwned,
    },
    0,
    label === "tools" ? "toolsArray" : "promptArray",
  );
}

function snapshotModelCallMutableArray(
  label: "prompt" | "tools",
  value: ModelCallMessage[] | ModelCallTool[],
  urlRepresentation: "instance" | "href",
): ModelCallMessage[] | ModelCallTool[] {
  const snapshot = snapshotModelCallInput(label, value, urlRepresentation);
  if (!ArrayIsArray(snapshot)) {
    throw new TypeError(`Model call ${label} could not be inspected`);
  }
  return snapshot as ModelCallMessage[] | ModelCallTool[];
}

export function snapshotModelCallContextMessages(
  value: ModelCallMessage[],
): ModelCallMessage[] {
  return snapshotModelCallMutableArray("prompt", value, "href") as ModelCallMessage[];
}

export function snapshotModelCallContextTools(
  value: ModelCallTool[],
): ModelCallTool[] {
  return snapshotModelCallMutableArray("tools", value, "href") as ModelCallTool[];
}

function snapshotNeutralReasoning(reasoning: RuntimeReasoningOption): RuntimeReasoningOption {
  const enabled = reasoning.enabled;
  const effort = reasoning.effort;
  const budgetTokens = reasoning.budgetTokens;
  const output: RuntimeReasoningOption = {
    ...(enabled === undefined && !ObjectHasOwn(reasoning, "enabled") ? {} : { enabled }),
    ...(effort === undefined && !ObjectHasOwn(reasoning, "effort") ? {} : { effort }),
    ...(budgetTokens === undefined && !ObjectHasOwn(reasoning, "budgetTokens")
      ? {}
      : { budgetTokens }),
  };
  forEachPrivateArray(ReflectOwnKeys(reasoning), (key) => {
    if (key === "enabled" || key === "effort" || key === "budgetTokens") return;
    const descriptor = ObjectGetOwnPropertyDescriptor(reasoning, key);
    if (descriptor) ObjectDefineProperty(output, key, descriptor);
  });
  ReflectApply(ObjectFreeze, Object, [output]);
  return output;
}

export function snapshotModelCallProviderOptions<TOptions extends ModelRuntimeCallOptions>(
  model: ModelCallRuntimeMetadata,
  options: TOptions,
): TOptions {
  const responseFormat = snapshotResponseFormat(options.responseFormat);
  const hasResponseFormat = options.responseFormat !== undefined;
  const protocol = resolveModelCallProtocol(model);
  const neutralOptions = {
    ...options,
    prompt: snapshotModelCallInput("prompt", options.prompt),
    ...(options.tools === undefined && !ObjectHasOwn(options, "tools")
      ? {}
      : { tools: snapshotModelCallInput("tools", options.tools) }),
    ...(hasResponseFormat ? { responseFormat } : {}),
    ...(options.stopSequences === undefined
      ? {}
      : { stopSequences: objectFreeze(slicePrivateArray(options.stopSequences)) }),
    ...(options.reasoning === undefined
      ? {}
      : { reasoning: snapshotNeutralReasoning(options.reasoning) }),
  };
  if (!usesOpenAIBuilder(model) && protocol !== "google" && protocol !== "anthropic") {
    return neutralOptions;
  }

  const providerOptions = options.providerOptions;
  if (providerOptions === undefined) return neutralOptions;

  const output: Record<string, unknown> = {};
  const consumedBuckets: Record<string, unknown> = {};
  const bucketNames = protocol === "google" || protocol === "anthropic"
    ? [protocol, model.provider ?? resolveModelCallProvider(model)]
    : openAIProviderBucketNames(model);
  forEachPrivateArray(bucketNames, (providerName) => {
    if (!providerName || ObjectHasOwn(consumedBuckets, providerName)) return;
    defineOwnDataProperty(consumedBuckets, providerName, true);
    const bucket = readRequiredProviderDataBucketEntry(providerOptions, providerName);
    if (bucket.present) {
      defineOwnDataProperty(
        output,
        providerName,
        snapshotProviderBucket(providerName, bucket.value),
      );
    }
  });
  let keys: PropertyKey[];
  try {
    keys = reflectOwnKeys(providerOptions);
  } catch {
    throw new TypeError("Provider options could not be enumerated");
  }
  forEachPrivateArray(keys, (key) => {
    if (typeof key !== "string" || ObjectHasOwn(consumedBuckets, key)) return;
    // Unselected buckets remain available to admission checks without evaluating
    // their getters or rejecting values ignored by this provider's builder.
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
        providerOptions,
        key,
      ]) as
        | PropertyDescriptor
        | undefined;
    } catch {
      throw new TypeError("Provider options could not be enumerated");
    }
    if (descriptor) ReflectApply(ObjectDefineProperty, Object, [output, key, descriptor]);
  });

  return { ...neutralOptions, providerOptions: output } as TOptions;
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
    responseFormat: resolveOpenAIResponseFormat(options, providerOptions, transport),
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

function getAnthropicModelMaxOutputTokens(modelId: string | undefined): {
  maxOutputTokens: number;
  isKnownModel: boolean;
} {
  if (!modelId) return { maxOutputTokens: 4096, isKnownModel: false };
  if (
    stringIncludes(modelId, "claude-opus-4-8") ||
    stringIncludes(modelId, "claude-opus-4-7") ||
    stringIncludes(modelId, "claude-opus-4-6")
  ) {
    return { maxOutputTokens: 128_000, isKnownModel: true };
  }
  if (stringIncludes(modelId, "claude-sonnet-4-6")) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (
    stringIncludes(modelId, "claude-sonnet-4-5") ||
    stringIncludes(modelId, "claude-opus-4-5") ||
    stringIncludes(modelId, "claude-haiku-4-5")
  ) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (stringIncludes(modelId, "claude-opus-4-1")) {
    return { maxOutputTokens: 32_000, isKnownModel: true };
  }
  if (stringIncludes(modelId, "claude-sonnet-4-")) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (stringIncludes(modelId, "claude-opus-4-")) {
    return { maxOutputTokens: 32_000, isKnownModel: true };
  }
  if (stringIncludes(modelId, "claude-3-haiku")) {
    return { maxOutputTokens: 4096, isKnownModel: true };
  }
  return { maxOutputTokens: 4096, isKnownModel: false };
}

function resolveAnthropicNeutralThinkingBudget(
  reasoning: RuntimeReasoningOption | undefined,
): number | undefined {
  if (!reasoning || reasoning.enabled !== true) return undefined;
  if (reasoning.budgetTokens !== undefined) {
    return numberIsSafeInteger(reasoning.budgetTokens) && reasoning.budgetTokens >= 1024
      ? reasoning.budgetTokens
      : undefined;
  }
  switch (reasoning.effort) {
    case "low":
      return 1024;
    case "high":
      return 16_384;
    case "max":
      return 32_768;
    case "medium":
    default:
      return 4096;
  }
}

function resolveAnthropicProviderThinkingBudget(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
):
  | number
  | undefined {
  const thinking = readProviderControl(model, options, "thinking")?.value;
  if (!thinking || typeof thinking !== "object" || ArrayIsArray(thinking)) return undefined;
  if (readOwnEnumerableDataDescriptor(thinking, "type")?.value !== "enabled") return undefined;
  const budgetTokens = readOwnEnumerableDataDescriptor(thinking, "budget_tokens")?.value;
  return typeof budgetTokens === "number" && numberIsSafeInteger(budgetTokens) &&
      budgetTokens >= 1024
    ? budgetTokens
    : undefined;
}

function resolveAnthropicBaseMaxOutputTokens(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): number {
  const { maxOutputTokens: modelMax, isKnownModel } = getAnthropicModelMaxOutputTokens(
    model.modelId,
  );
  const requested = options.maxOutputTokens ?? modelMax;
  return isKnownModel && requested > modelMax ? modelMax : requested;
}

function resolveAnthropicMaxOutputTokens(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): number | undefined {
  const native = readProviderControl(model, options, "max_tokens");
  if (native) return numberControl(native.value);

  const baseMaxTokens = resolveAnthropicBaseMaxOutputTokens(model, options);
  const thinkingBudget = resolveAnthropicNeutralThinkingBudget(options.reasoning) ??
    resolveAnthropicProviderThinkingBudget(model, options);
  if (thinkingBudget === undefined) return baseMaxTokens;
  return mathMin(
    baseMaxTokens + thinkingBudget,
    getAnthropicModelMaxOutputTokens(model.modelId).maxOutputTokens,
  );
}

function readNativeAnthropicResponseFormat(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequestSource["responseFormat"] | undefined {
  const outputConfig = readProviderControl(model, options, "output_config")?.value;
  if (!isProviderOptionsBucket(outputConfig)) return undefined;
  const format = readOwnEnumerableDataDescriptor(outputConfig, "format")?.value;
  if (!isProviderOptionsBucket(format)) return undefined;
  const type = readOwnEnumerableDataDescriptor(format, "type")?.value;
  if (type === "text") return { type: "text" };
  if (type !== "json_schema") return undefined;
  const schema = readOwnEnumerableDataDescriptor(format, "schema")?.value;
  if (schema === undefined) return undefined;
  const name = readOwnEnumerableDataDescriptor(format, "name")?.value;
  const description = readOwnEnumerableDataDescriptor(format, "description")?.value;
  const strict = readOwnEnumerableDataDescriptor(format, "strict")?.value;
  return {
    type: "json_schema",
    name: typeof name === "string" && name.length > 0 ? name : "response",
    schema: snapshotPreservedResponseFormatSchema(schema),
    ...(typeof description === "string" ? { description } : {}),
    ...(typeof strict === "boolean" ? { strict } : {}),
  };
}

function resolveAnthropicResponseFormat(
  model: ModelCallRuntimeMetadata,
  options: ModelCallRequestSource,
): ModelCallRequestSource["responseFormat"] | undefined {
  if (options.responseFormat?.type === "json_schema") return options.responseFormat;
  return readNativeAnthropicResponseFormat(model, options) ??
    (options.responseFormat?.type === "json" ? undefined : options.responseFormat);
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
  const effective = {
    ...options,
    responseFormat: resolveAnthropicResponseFormat(model, options),
  };
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

function readNativeGoogleResponseFormat(
  generationConfig: unknown,
  options: { forceJsonMimeType?: boolean } = {},
): ModelCallRequestSource["responseFormat"] | undefined {
  if (!isProviderOptionsBucket(generationConfig)) return undefined;
  const responseMimeType = readOwnEnumerableDataDescriptor(
    generationConfig,
    "responseMimeType",
  )?.value;
  const responseJsonSchema = readOwnEnumerableDataDescriptor(
    generationConfig,
    "responseJsonSchema",
  )?.value;
  const hasResponseJsonSchema = responseJsonSchema !== undefined;
  const responseSchema = readOwnEnumerableDataDescriptor(generationConfig, "responseSchema")?.value;
  const hasResponseSchema = responseSchema !== undefined;
  const hasNativeJsonSchema = hasResponseJsonSchema || hasResponseSchema;

  if (hasResponseSchema) {
    throw new TypeError(
      "Google generationConfig.responseSchema cannot be captured as JSON Schema",
    );
  }
  const effectiveResponseMimeType = options.forceJsonMimeType
    ? "application/json"
    : responseMimeType;
  if (
    hasNativeJsonSchema && effectiveResponseMimeType !== undefined &&
    effectiveResponseMimeType !== "application/json"
  ) {
    throw new TypeError(
      "Google generationConfig JSON schema requires responseMimeType application/json",
    );
  }
  if (hasResponseJsonSchema) {
    return {
      type: "json_schema",
      name: "response",
      schema: snapshotPreservedResponseFormatSchema(responseJsonSchema),
    };
  }
  if (effectiveResponseMimeType === "application/json") return { type: "json" };
  if (effectiveResponseMimeType === "text/plain") return { type: "text" };
  return undefined;
}

function resolveGoogleResponseFormat(
  nativeGenerationConfig: PropertyDescriptor | undefined,
  options: ModelCallRequestSource,
): ModelCallRequestSource["responseFormat"] | undefined {
  if (options.responseFormat?.type === "json_schema") return options.responseFormat;
  const native = readNativeGoogleResponseFormat(nativeGenerationConfig?.value, {
    forceJsonMimeType: options.responseFormat?.type === "json",
  });
  if (options.responseFormat?.type === "json") {
    return native?.type === "json_schema" ? native : { type: "json" };
  }
  return native ?? options.responseFormat;
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
    responseFormat: resolveGoogleResponseFormat(native, options),
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

function snapshotResponseFormat(
  responseFormat: ModelCallRequestSource["responseFormat"],
  options: { responsesJsonSchemaStrictDefault?: boolean } = {},
): ModelCallResponseFormat | undefined {
  if (responseFormat === undefined) return undefined;
  if (responseFormat.type === "text" || responseFormat.type === "json") {
    return { type: responseFormat.type };
  }
  return {
    type: "json_schema",
    name: responseFormat.name,
    schema: snapshotProviderOptionValue(
      "responseFormat",
      shouldUnwrapResponseFormatSchema(responseFormat.schema)
        ? unwrapToolInputSchema(responseFormat.schema)
        : responseFormat.schema,
      { ancestors: new NativeWeakSet<SnapshotContainer>(), nodes: 0 },
      0,
    ),
    ...(responseFormat.description === undefined
      ? {}
      : { description: responseFormat.description }),
    ...(responseFormat.strict === undefined
      ? options.responsesJsonSchemaStrictDefault ? { strict: false } : {}
      : { strict: responseFormat.strict }),
  };
}

function snapshotOpenAICaptureResponseFormat(
  responseFormat: ModelCallRequestSource["responseFormat"],
  options: { responsesJsonSchemaStrictDefault?: boolean } = {},
): ModelCallResponseFormat | undefined {
  const snapshot = snapshotResponseFormat(responseFormat, options);
  if (snapshot?.type === "json_schema") {
    markPreservedResponseFormatSchema(snapshot.schema);
  }
  return snapshot;
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
    ...(options.responseFormat !== undefined
      ? { responseFormat: snapshotResponseFormat(options.responseFormat) }
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
