import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
  jsonValuesEqual,
  readProviderOptions,
  readRecord,
  snapshotProviderJsonValue,
  stringifyToolResultValue,
  unwrapToolInputSchema,
} from "veryfront/provider/shared";
import type {
  ModelRuntimeCallOptions,
  ModelRuntimePromptMessage,
  ModelRuntimeToolDefinition,
  RuntimeReasoningOption,
} from "veryfront/provider/shared";
import {
  type AnthropicMcpRequestConfiguration,
  assertAnthropicMcpRequestContract,
  normalizeAnthropicMcpServers,
  normalizeAnthropicMcpToolsetArgs,
} from "./anthropic-mcp-request.ts";
import {
  type AnthropicProviderToolNameRegistry,
  type AnthropicProviderToolUse,
  type AnthropicServerToolResult,
  isAnthropicProviderToolResultBlockType,
  MAX_ANTHROPIC_RAW_ASSISTANT_BLOCKS,
  MAX_ANTHROPIC_RAW_ASSISTANT_MESSAGES,
  parseAnthropicProviderToolUse,
  parseAnthropicServerToolResult,
  snapshotAnthropicRawAssistantMetadata,
  validateAnthropicRawAssistantMessages,
} from "./anthropic-native-content.ts";

type ProviderCacheTtl = boolean | "5m" | "1h";

const apply = Reflect.apply;
const NativeArray = Array;
const ArrayIsArray = Array.isArray;
const booleanValueOf = Boolean.prototype.valueOf;
const NativeSet = Set;
const numberValueOf = Number.prototype.valueOf;
const objectAssign = Object.assign;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectKeys = Object.keys;
const reflectDeleteProperty = Reflect.deleteProperty;
const reflectOwnKeys = Reflect.ownKeys;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setHas = Set.prototype.has;
const stringValueOf = String.prototype.valueOf;

function hasSetValue<T>(set: Set<T>, value: T): boolean {
  return apply(setHas, set, [value]) as boolean;
}

function addSetValue<T>(set: Set<T>, value: T): void {
  apply(setAdd, set, [value]);
}

function deleteSetValue<T>(set: Set<T>, value: T): void {
  apply(setDelete, set, [value]);
}

function defineOwnEnumerableDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  apply(objectDefineProperty, Object, [target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  }]);
}

function boxedPrimitiveKind(value: object): "boolean" | "number" | "string" | undefined {
  try {
    apply(booleanValueOf, value, []);
    return "boolean";
  } catch {
    // Continue with the other intrinsic brand checks.
  }
  try {
    apply(numberValueOf, value, []);
    return "number";
  } catch {
    // Continue with the other intrinsic brand checks.
  }
  try {
    apply(stringValueOf, value, []);
    return "string";
  } catch {
    return undefined;
  }
}

function isBoxedPrimitive(value: object): boolean {
  return boxedPrimitiveKind(value) !== undefined;
}

function isBoxedString(value: object): boolean {
  return boxedPrimitiveKind(value) === "string";
}

type ProviderCacheControlOption = {
  system?: ProviderCacheTtl;
  tools?: ProviderCacheTtl;
};

export interface OpenAICompatibleLanguageOptions extends ModelRuntimeCallOptions {
  cacheControl?: ProviderCacheControlOption;
  anthropicContainer?: unknown;
  mcpServers?: readonly Record<string, unknown>[];
}

/** @deprecated Import `ModelRuntimeToolDefinition` from `veryfront/provider/shared` instead. */
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

type AnthropicCompatibleMessage = {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
};

type AnthropicCompatibleRequest = {
  model: string;
  messages: AnthropicCompatibleMessage[];
  max_tokens: number;
  stream?: boolean;
  system?: string | Array<Record<string, unknown>>;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  output_config?: { format: Record<string, unknown> };
  [key: string]: unknown;
};

function normalizeAnthropicToolChoice(toolChoice: unknown): unknown {
  if (typeof toolChoice === "string") {
    return { type: toolChoice };
  }

  return toolChoice;
}

function toSnakeCaseRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`),
      value,
    ]),
  );
}

function pushAnthropicUserContent(
  messages: AnthropicCompatibleMessage[],
  content: Array<Record<string, unknown>>,
): void {
  if (content.length === 0) {
    return;
  }

  const lastMessage = messages.at(-1);
  if (lastMessage?.role === "user") {
    lastMessage.content.push(...content);
    return;
  }

  messages.push({
    role: "user",
    content,
  });
}

function readOwnAnthropicMetadataProperty(
  value: object,
  key: "anthropic" | "rawAssistantMessages",
  malformedMessage: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = objectGetOwnPropertyDescriptor(value, key);
  } catch {
    throw new TypeError(malformedMessage);
  }
  if (descriptor === undefined) return undefined;
  if (!objectHasOwn(descriptor, "value") || descriptor.enumerable !== true) {
    throw new TypeError(malformedMessage);
  }
  return descriptor.value;
}

function readAnthropicRawAssistantMessagesValue(
  message: Extract<ModelRuntimePromptMessage, { readonly role: "assistant" }>,
): unknown[] | undefined {
  const metadata = message.providerMetadata;
  if (metadata === undefined) return undefined;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Anthropic provider metadata must be an object");
  }
  const anthropic = readOwnAnthropicMetadataProperty(
    metadata,
    "anthropic",
    "Anthropic provider metadata namespace must be an enumerable data property",
  );
  if (anthropic === undefined) return undefined;
  if (anthropic === null || typeof anthropic !== "object" || Array.isArray(anthropic)) {
    throw new TypeError("Anthropic provider metadata namespace must be an object");
  }
  const rawAssistantMessages = readOwnAnthropicMetadataProperty(
    anthropic,
    "rawAssistantMessages",
    "Anthropic raw assistant messages must be an enumerable data property",
  );
  if (rawAssistantMessages === undefined) return undefined;
  const snapshot = snapshotAnthropicRawAssistantMetadata(rawAssistantMessages);
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    throw new TypeError("Anthropic raw assistant messages must be a non-empty array");
  }
  return snapshot;
}

type CanonicalProviderCall = {
  id: string;
  name: string;
  input: unknown;
};

type CanonicalProviderResult = {
  id: string;
  name: string;
  result: unknown;
  isError: boolean;
};

type AnthropicToolEventKind =
  | "client-call"
  | "provider-call"
  | "provider-result";

type AnthropicToolEvent = {
  kind: AnthropicToolEventKind;
  id: string;
};

type ValidatedAnthropicReplay = {
  messages: Array<Array<Record<string, unknown>>>;
  nextProviderToolNamesById: AnthropicProviderToolNameRegistry;
  nextCanonicalProviderToolNamesById: AnthropicProviderToolNameRegistry;
};

const MAX_ANTHROPIC_OUTSTANDING_PROVIDER_TOOL_CALLS = MAX_ANTHROPIC_RAW_ASSISTANT_BLOCKS;

function assertBoundedAnthropicProviderToolState(
  providerToolNamesById: ReadonlyMap<string, string>,
): void {
  if (
    providerToolNamesById.size >
      MAX_ANTHROPIC_OUTSTANDING_PROVIDER_TOOL_CALLS
  ) {
    throw new TypeError(
      `Anthropic provider tool correlation exceeded ${MAX_ANTHROPIC_OUTSTANDING_PROVIDER_TOOL_CALLS} outstanding calls`,
    );
  }
}

function invalidAnthropicClientCallHistory(): TypeError {
  return new TypeError(
    "Anthropic raw client tool call does not match canonical client-executed content",
  );
}

function invalidAnthropicProviderCallHistory(): TypeError {
  return new TypeError(
    "Anthropic raw provider tool call does not match canonical provider-executed content",
  );
}

function invalidAnthropicProviderResultHistory(): TypeError {
  return new TypeError(
    "Anthropic raw provider tool result does not match canonical provider-executed content",
  );
}

function invalidAnthropicToolEventOrder(): TypeError {
  return new TypeError(
    "Anthropic raw tool event order does not match canonical assistant content",
  );
}

function anthropicCallsEqual(
  left: CanonicalProviderCall,
  right: CanonicalProviderCall,
): boolean {
  return left.id === right.id &&
    left.name === right.name &&
    jsonValuesEqual(left.input, right.input, true);
}

function orderedAnthropicCallsEqual(
  left: readonly CanonicalProviderCall[],
  right: readonly CanonicalProviderCall[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftCall = left[index];
    const rightCall = right[index];
    if (!leftCall || !rightCall || !anthropicCallsEqual(leftCall, rightCall)) {
      return false;
    }
  }
  return true;
}

function rejectDuplicateAnthropicCallIds(
  calls: readonly CanonicalProviderCall[],
  invalid: () => TypeError,
): void {
  const ids = new Set<string>();
  for (const call of calls) {
    if (ids.has(call.id)) throw invalid();
    ids.add(call.id);
  }
}

function survivingAnthropicToolEvents(
  events: readonly AnthropicToolEvent[],
  activeKinds: ReadonlySet<AnthropicToolEventKind>,
): AnthropicToolEvent[] {
  const surviving: AnthropicToolEvent[] = [];
  for (const event of events) {
    if (activeKinds.has(event.kind)) surviving.push(event);
  }
  return surviving;
}

function orderedAnthropicToolEventsEqual(
  left: readonly AnthropicToolEvent[],
  right: readonly AnthropicToolEvent[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEvent = left[index];
    const rightEvent = right[index];
    if (
      !leftEvent ||
      !rightEvent ||
      leftEvent.kind !== rightEvent.kind ||
      leftEvent.id !== rightEvent.id
    ) {
      return false;
    }
  }
  return true;
}

type AnthropicServerToolResultErrorFields = {
  code: string;
  toolCallId: string;
  toolName: string;
  detail?: string;
};

const ANTHROPIC_SERVER_TOOL_RESULT_ERROR_FIELDS = new Set([
  "name",
  "provider",
  "code",
  "toolCallId",
  "toolName",
  "detail",
]);

function readOwnEnumerableDataProperty(
  value: object,
  key: string,
): { present: boolean; value?: unknown } | undefined {
  try {
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { present: false };
    if (!objectHasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      return undefined;
    }
    return { present: true, value: descriptor.value };
  } catch {
    return undefined;
  }
}

function readAnthropicServerToolResultErrorFields(
  value: unknown,
): AnthropicServerToolResultErrorFields | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  try {
    if (
      objectKeys(value).some((key) => !ANTHROPIC_SERVER_TOOL_RESULT_ERROR_FIELDS.has(key))
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const name = readOwnEnumerableDataProperty(value, "name");
  const provider = readOwnEnumerableDataProperty(value, "provider");
  const code = readOwnEnumerableDataProperty(value, "code");
  const toolCallId = readOwnEnumerableDataProperty(value, "toolCallId");
  const toolName = readOwnEnumerableDataProperty(value, "toolName");
  const detail = readOwnEnumerableDataProperty(value, "detail");
  if (
    name?.present !== true ||
    name.value !== "AnthropicServerToolResultError" ||
    provider?.present !== true ||
    provider.value !== "anthropic" ||
    code?.present !== true ||
    typeof code.value !== "string" ||
    code.value.length === 0 ||
    toolCallId?.present !== true ||
    typeof toolCallId.value !== "string" ||
    toolCallId.value.length === 0 ||
    toolName?.present !== true ||
    typeof toolName.value !== "string" ||
    toolName.value.length === 0 ||
    detail === undefined ||
    (detail.present && detail.value !== undefined && typeof detail.value !== "string")
  ) {
    return undefined;
  }
  return {
    code: code.value,
    toolCallId: toolCallId.value,
    toolName: toolName.value,
    ...(typeof detail.value === "string" ? { detail: detail.value } : {}),
  };
}

function anthropicProviderResultsEqual(left: unknown, right: unknown): boolean {
  const leftError = readAnthropicServerToolResultErrorFields(left);
  const rightError = readAnthropicServerToolResultErrorFields(right);
  if (leftError || rightError) {
    return leftError !== undefined &&
      rightError !== undefined &&
      leftError.code === rightError.code &&
      leftError.toolCallId === rightError.toolCallId &&
      leftError.toolName === rightError.toolName &&
      leftError.detail === rightError.detail;
  }
  return jsonValuesEqual(left, right);
}

function validateAnthropicProviderReplay(
  message: Extract<ModelRuntimePromptMessage, { readonly role: "assistant" }>,
  rawAssistantMessages: unknown,
  currentProviderToolNamesById: AnthropicProviderToolNameRegistry,
  currentCanonicalProviderToolNamesById: AnthropicProviderToolNameRegistry,
): ValidatedAnthropicReplay {
  const nextProviderToolNamesById = new Map(currentProviderToolNamesById);
  const messages = validateAnthropicRawAssistantMessages(
    rawAssistantMessages,
    nextProviderToolNamesById,
  );
  assertBoundedAnthropicProviderToolState(nextProviderToolNamesById);
  const replayProviderToolNamesById = new Map(currentProviderToolNamesById);
  const rawClientCalls: CanonicalProviderCall[] = [];
  const rawProviderCalls: AnthropicProviderToolUse[] = [];
  const rawProviderResults: AnthropicServerToolResult[] = [];
  const rawToolEvents: AnthropicToolEvent[] = [];
  const rawToolCallIds = new Set(currentProviderToolNamesById.keys());

  for (const content of messages) {
    for (const block of content) {
      if (block.type === "tool_use") {
        const input = block.input === undefined ? {} : readRecord(block.input);
        if (
          typeof block.id !== "string" ||
          block.id.length === 0 ||
          typeof block.name !== "string" ||
          block.name.length === 0 ||
          !input ||
          rawToolCallIds.has(block.id)
        ) {
          throw invalidAnthropicClientCallHistory();
        }
        rawToolCallIds.add(block.id);
        rawClientCalls.push({
          id: block.id,
          name: block.name,
          input,
        });
        rawToolEvents.push({ kind: "client-call", id: block.id });
        continue;
      }
      const call = parseAnthropicProviderToolUse(block);
      if (call) {
        if (rawToolCallIds.has(call.toolCallId)) {
          throw invalidAnthropicProviderCallHistory();
        }
        rawToolCallIds.add(call.toolCallId);
        rawProviderCalls.push(call);
        rawToolEvents.push({ kind: "provider-call", id: call.toolCallId });
        replayProviderToolNamesById.set(call.toolCallId, call.toolName);
        continue;
      }
      if (
        typeof block.type !== "string" ||
        !isAnthropicProviderToolResultBlockType(block.type)
      ) {
        continue;
      }
      const result = parseAnthropicServerToolResult(
        block,
        replayProviderToolNamesById,
      );
      if (!result) {
        throw invalidAnthropicProviderResultHistory();
      }
      rawProviderResults.push(result);
      rawToolEvents.push({ kind: "provider-result", id: result.toolCallId });
      replayProviderToolNamesById.delete(result.toolCallId);
    }
  }

  const providerToolCallProjection = (message.providerToolCalls ?? []).map((call) => ({
    id: call.toolCallId,
    name: call.toolName,
    input: call.input,
  }));
  const contentToolCallProjection: CanonicalProviderCall[] = [];
  const canonicalClientCalls: CanonicalProviderCall[] = [];
  const canonicalResults: CanonicalProviderResult[] = [];
  const contentToolEvents: AnthropicToolEvent[] = [];
  const contentCallIds = new Set<string>();
  const canonicalResultIds = new Set<string>();

  rejectDuplicateAnthropicCallIds(
    providerToolCallProjection,
    invalidAnthropicProviderCallHistory,
  );
  const providerToolCallIds = new Set(
    providerToolCallProjection.map((call) => call.id),
  );
  for (const part of message.content) {
    if (part.type === "tool-call") {
      const call = {
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      };
      if (contentCallIds.has(call.id)) {
        throw part.providerExecuted === true
          ? invalidAnthropicProviderCallHistory()
          : invalidAnthropicClientCallHistory();
      }
      contentCallIds.add(call.id);
      if (part.providerExecuted === true) {
        contentToolCallProjection.push(call);
        contentToolEvents.push({ kind: "provider-call", id: call.id });
      } else {
        canonicalClientCalls.push(call);
        contentToolEvents.push({ kind: "client-call", id: call.id });
      }
      continue;
    }
    if (part.type !== "tool-result") {
      continue;
    }
    const result: CanonicalProviderResult = {
      id: part.toolCallId,
      name: part.toolName,
      result: part.result,
      isError: part.isError === true,
    };
    if (canonicalResultIds.has(result.id)) {
      throw invalidAnthropicProviderResultHistory();
    }
    canonicalResultIds.add(result.id);
    canonicalResults.push(result);
    contentToolEvents.push({ kind: "provider-result", id: result.id });
  }

  for (const clientCall of canonicalClientCalls) {
    if (providerToolCallIds.has(clientCall.id)) {
      throw invalidAnthropicClientCallHistory();
    }
  }

  if (
    providerToolCallProjection.length > 0 &&
    contentToolCallProjection.length > 0 &&
    !orderedAnthropicCallsEqual(
      providerToolCallProjection,
      contentToolCallProjection,
    )
  ) {
    throw invalidAnthropicProviderCallHistory();
  }
  const canonicalProviderCalls = providerToolCallProjection.length > 0
    ? providerToolCallProjection
    : contentToolCallProjection;

  // Provider-native tool_use blocks have an exact canonical representation.
  // Correlate every surviving client projection by occurrence. When that
  // projection is absent (for example, after compaction), retain structurally
  // validated raw-only history for compatibility.
  if (
    canonicalClientCalls.length > 0 &&
    !orderedAnthropicCallsEqual(rawClientCalls, canonicalClientCalls)
  ) {
    throw invalidAnthropicClientCallHistory();
  }

  // Old persisted history can retain provider-native raw content after its
  // canonical provider-tool projection has been compacted. It remains safe to
  // replay after structural validation only when no provider semantics survive.
  if (
    canonicalProviderCalls.length > 0 ||
    canonicalResults.length > 0
  ) {
    if (
      rawProviderCalls.length !== canonicalProviderCalls.length ||
      rawProviderResults.length !== canonicalResults.length
    ) {
      if (rawProviderCalls.length !== canonicalProviderCalls.length) {
        throw invalidAnthropicProviderCallHistory();
      }
      throw invalidAnthropicProviderResultHistory();
    }

    for (let index = 0; index < canonicalProviderCalls.length; index += 1) {
      const raw = rawProviderCalls[index];
      const canonical = canonicalProviderCalls[index];
      if (
        !raw ||
        !canonical ||
        raw.toolCallId !== canonical.id ||
        raw.toolName !== canonical.name ||
        !jsonValuesEqual(raw.input, canonical.input, true)
      ) {
        throw invalidAnthropicProviderCallHistory();
      }
    }

    for (let index = 0; index < canonicalResults.length; index += 1) {
      const raw = rawProviderResults[index];
      const canonical = canonicalResults[index];
      if (
        !raw ||
        !canonical ||
        raw.toolCallId !== canonical.id ||
        raw.toolName !== canonical.name ||
        (raw.isError === true) !== canonical.isError ||
        !anthropicProviderResultsEqual(raw.result, canonical.result)
      ) {
        throw invalidAnthropicProviderResultHistory();
      }
    }
  }

  // providerToolCalls is a message-level projection without positions relative
  // to assistant content. For each event kind that survives in content, filter
  // compacted kinds from the raw sequence and prove the complete observable
  // interleaving, including provider results.
  const activeContentEventKinds = new Set<AnthropicToolEventKind>();
  if (canonicalClientCalls.length > 0) {
    activeContentEventKinds.add("client-call");
  }
  if (contentToolCallProjection.length > 0) {
    activeContentEventKinds.add("provider-call");
  }
  if (canonicalResults.length > 0) {
    activeContentEventKinds.add("provider-result");
  }
  if (
    !orderedAnthropicToolEventsEqual(
      survivingAnthropicToolEvents(rawToolEvents, activeContentEventKinds),
      survivingAnthropicToolEvents(contentToolEvents, activeContentEventKinds),
    )
  ) {
    throw invalidAnthropicToolEventOrder();
  }

  const nextCanonicalProviderToolNamesById = new Map(
    currentCanonicalProviderToolNamesById,
  );
  for (const call of canonicalProviderCalls) {
    if (nextCanonicalProviderToolNamesById.has(call.id)) {
      throw invalidAnthropicProviderCallHistory();
    }
    nextCanonicalProviderToolNamesById.set(call.id, call.name);
  }
  for (const result of canonicalResults) {
    if (nextCanonicalProviderToolNamesById.get(result.id) !== result.name) {
      throw invalidAnthropicProviderResultHistory();
    }
    nextCanonicalProviderToolNamesById.delete(result.id);
  }
  assertBoundedAnthropicProviderToolState(
    nextCanonicalProviderToolNamesById,
  );

  return {
    messages,
    nextProviderToolNamesById,
    nextCanonicalProviderToolNamesById,
  };
}

function requiresExactAnthropicProviderReplay(
  message: Extract<ModelRuntimePromptMessage, { readonly role: "assistant" }>,
): boolean {
  return message.content.some((part) =>
    part.type === "tool-result" ||
    part.type === "tool-call" && part.providerExecuted === true
  );
}

function shouldCompactAnthropicToolRound(
  message: Extract<ModelRuntimePromptMessage, { readonly role: "assistant" }>,
  index: number,
  lastHistoricalAssistantTextIndex: number,
): boolean {
  return index < lastHistoricalAssistantTextIndex &&
    message.content.some((part) => part.type === "tool-call");
}

function connectAnthropicReplayIndices(
  dependencies: Map<number, Set<number>>,
  left: number,
  right: number,
): void {
  if (left === right) return;
  const leftDependencies = dependencies.get(left) ?? new Set<number>();
  leftDependencies.add(right);
  dependencies.set(left, leftDependencies);
  const rightDependencies = dependencies.get(right) ?? new Set<number>();
  rightDependencies.add(left);
  dependencies.set(right, rightDependencies);
}

function planAnthropicRawAssistantReplay(
  prompt: readonly ModelRuntimePromptMessage[],
  rawAssistantMessagesByIndex: ReadonlyMap<number, unknown[]>,
  lastUserIndex: number,
  lastHistoricalAssistantTextIndex: number,
): Set<number> {
  const replayIndices = new Set<number>();
  const dependencies = new Map<number, Set<number>>();
  const pendingProviderCallIndexById = new Map<string, number>();

  for (const [index, message] of prompt.entries()) {
    if (message.role === "system" || message.role === "user") {
      pendingProviderCallIndexById.clear();
      continue;
    }
    if (message.role !== "assistant") continue;

    const rawAssistantMessages = rawAssistantMessagesByIndex.get(index);
    if (!rawAssistantMessages) continue;
    const shouldCompactCompletedToolRound = shouldCompactAnthropicToolRound(
      message,
      index,
      lastHistoricalAssistantTextIndex,
    );
    if (
      requiresExactAnthropicProviderReplay(message) ||
      !shouldCompactCompletedToolRound && index >= lastUserIndex
    ) {
      replayIndices.add(index);
    }

    let remainingBlockCount = MAX_ANTHROPIC_RAW_ASSISTANT_BLOCKS;
    const rawMessageCount = Math.min(
      rawAssistantMessages.length,
      MAX_ANTHROPIC_RAW_ASSISTANT_MESSAGES,
    );
    for (let rawMessageIndex = 0; rawMessageIndex < rawMessageCount; rawMessageIndex++) {
      const rawContent = rawAssistantMessages[rawMessageIndex];
      if (!Array.isArray(rawContent)) continue;
      const rawBlockCount = Math.min(rawContent.length, remainingBlockCount);
      remainingBlockCount -= rawBlockCount;
      for (let rawBlockIndex = 0; rawBlockIndex < rawBlockCount; rawBlockIndex++) {
        const value = rawContent[rawBlockIndex];
        const block = readRecord(value);
        if (!block || typeof block.type !== "string") continue;
        if (
          (block.type === "server_tool_use" || block.type === "mcp_tool_use") &&
          typeof block.id === "string" &&
          block.id.length > 0
        ) {
          pendingProviderCallIndexById.set(block.id, index);
          continue;
        }
        if (
          !isAnthropicProviderToolResultBlockType(block.type) ||
          typeof block.tool_use_id !== "string" ||
          block.tool_use_id.length === 0
        ) {
          continue;
        }
        const providerCallIndex = pendingProviderCallIndexById.get(block.tool_use_id);
        if (providerCallIndex !== undefined) {
          connectAnthropicReplayIndices(dependencies, providerCallIndex, index);
          pendingProviderCallIndexById.delete(block.tool_use_id);
        }
      }
      if (remainingBlockCount === 0) break;
    }
  }

  const pendingReplayIndices = [...replayIndices];
  for (let cursor = 0; cursor < pendingReplayIndices.length; cursor++) {
    const index = pendingReplayIndices[cursor];
    if (index === undefined) continue;
    for (const dependency of dependencies.get(index) ?? []) {
      if (replayIndices.has(dependency)) continue;
      replayIndices.add(dependency);
      pendingReplayIndices.push(dependency);
    }
  }

  return replayIndices;
}

function toAnthropicUserContent(
  parts: Extract<ModelRuntimePromptMessage, { readonly role: "user" }>["content"],
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) {
        content.push({ type: "text", text: part.text });
      }
      continue;
    }

    if (part.type === "image" || part.mediaType.startsWith("image/")) {
      content.push({
        type: "image",
        source: {
          type: "url",
          url: part.url,
        },
      });
    }
  }

  return content;
}

function resolveAnthropicCacheControlBlock(
  ttl: ProviderCacheTtl | undefined,
): { type: "ephemeral"; ttl?: "1h" } | undefined {
  if (ttl === undefined || ttl === false) {
    return undefined;
  }
  if (ttl === "1h") {
    return { type: "ephemeral", ttl: "1h" };
  }
  return { type: "ephemeral" };
}

function resolveAnthropicSystemMessageCacheControl(
  message: Extract<ModelRuntimePromptMessage, { readonly role: "system" }>,
  providerName: string,
): { type: "ephemeral"; ttl?: "1h" } | undefined {
  const providerOptions = readOwnEnumerableDataProperty(message, "providerOptions");
  if (!providerOptions) {
    throw new TypeError(
      "Anthropic system message providerOptions must be an own enumerable data property",
    );
  }
  if (!providerOptions.present || providerOptions.value === undefined) {
    return undefined;
  }
  if (
    !providerOptions.value || typeof providerOptions.value !== "object" ||
    Array.isArray(providerOptions.value)
  ) {
    throw new TypeError("Anthropic system message providerOptions must be an object");
  }

  let rawCacheControl: unknown;
  let hasCacheControl = false;
  for (const key of ["anthropic", providerName]) {
    const providerBucket = readOwnEnumerableDataProperty(providerOptions.value, key);
    if (!providerBucket) {
      throw new TypeError(
        "Anthropic system message provider bucket must be an own enumerable data property",
      );
    }
    if (
      !providerBucket.present || !providerBucket.value ||
      typeof providerBucket.value !== "object" || Array.isArray(providerBucket.value)
    ) {
      continue;
    }
    const cacheControl = readOwnEnumerableDataProperty(providerBucket.value, "cacheControl");
    if (!cacheControl) {
      throw new TypeError(
        "Anthropic system message cacheControl must be an own enumerable data property",
      );
    }
    if (cacheControl.present && cacheControl.value !== undefined) {
      hasCacheControl = true;
      rawCacheControl = cacheControl.value;
    }
  }
  if (!hasCacheControl || rawCacheControl === undefined) {
    return undefined;
  }
  if (!rawCacheControl || typeof rawCacheControl !== "object" || Array.isArray(rawCacheControl)) {
    throw new TypeError("Anthropic system message cacheControl must be an object");
  }
  let unsupportedFields: string[];
  try {
    const keys = objectKeys(rawCacheControl);
    unsupportedFields = [];
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (key !== "type" && key !== "ttl") {
        unsupportedFields.push(key);
      }
    }
  } catch {
    throw new TypeError("Anthropic system message cacheControl could not be inspected");
  }
  if (unsupportedFields.length > 0) {
    throw new TypeError("Anthropic system message cacheControl contains unsupported fields");
  }
  const type = readOwnEnumerableDataProperty(rawCacheControl, "type");
  const ttl = readOwnEnumerableDataProperty(rawCacheControl, "ttl");
  if (!type || !ttl) {
    throw new TypeError(
      "Anthropic system message cacheControl must contain only enumerable data properties",
    );
  }
  if (!type.present || type.value !== "ephemeral") {
    throw new TypeError('Anthropic system message cacheControl.type must be "ephemeral"');
  }
  if (
    ttl.present && ttl.value !== undefined && ttl.value !== "5m" &&
    ttl.value !== "1h"
  ) {
    throw new TypeError('Anthropic system message cacheControl.ttl must be "5m" or "1h"');
  }
  return ttl.value === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

function createValidatedAnthropicProviderToolCorrelationState(
  canonicalProviderToolNamesById: ReadonlyMap<string, string>,
  rawProviderToolNamesById: ReadonlyMap<string, string>,
): AnthropicProviderToolNameRegistry {
  assertBoundedAnthropicProviderToolState(canonicalProviderToolNamesById);
  assertBoundedAnthropicProviderToolState(rawProviderToolNamesById);
  const correlated = new Map<string, string>();
  for (const [toolCallId, toolName] of canonicalProviderToolNamesById) {
    if (rawProviderToolNamesById.get(toolCallId) === toolName) {
      correlated.set(toolCallId, toolName);
    }
  }
  return correlated;
}

function toAnthropicMessages(
  prompt: readonly ModelRuntimePromptMessage[],
  systemCacheControl?: { type: "ephemeral"; ttl?: "1h" },
  providerName = "anthropic",
): {
  system?: string | Array<Record<string, unknown>>;
  messages: AnthropicCompatibleMessage[];
  providerToolNamesById: AnthropicProviderToolNameRegistry;
} {
  const systemParts: Array<{
    text: string;
    cacheControl?: { type: "ephemeral"; ttl?: "1h" };
  }> = [];
  const messages: AnthropicCompatibleMessage[] = [];
  const lastUserIndex = prompt.findLastIndex((message) => message.role === "user");
  const lastHistoricalAssistantTextIndex = prompt.findLastIndex((message, index) =>
    index < lastUserIndex &&
    message.role === "assistant" &&
    message.content.some((part) => part.type === "text" && part.text.length > 0)
  );
  const rawAssistantMessagesByIndex = new Map<number, unknown[]>();
  for (const [index, message] of prompt.entries()) {
    if (message.role !== "assistant") continue;
    const rawAssistantMessages = readAnthropicRawAssistantMessagesValue(message);
    if (rawAssistantMessages) {
      rawAssistantMessagesByIndex.set(index, rawAssistantMessages);
    }
  }
  const rawReplayIndices = planAnthropicRawAssistantReplay(
    prompt,
    rawAssistantMessagesByIndex,
    lastUserIndex,
    lastHistoricalAssistantTextIndex,
  );
  let skippingHistoricalToolResults = false;
  let pendingToolUseIds = new Set<string>();
  let rawProviderToolNamesById: AnthropicProviderToolNameRegistry = new Map();
  let canonicalProviderToolNamesById: AnthropicProviderToolNameRegistry = new Map();

  for (const [index, message] of prompt.entries()) {
    switch (message.role) {
      case "system":
        skippingHistoricalToolResults = false;
        pendingToolUseIds = new Set();
        rawProviderToolNamesById = new Map();
        canonicalProviderToolNamesById = new Map();
        if (message.content.length > 0) {
          const cacheControl = resolveAnthropicSystemMessageCacheControl(message, providerName);
          systemParts.push({
            text: message.content,
            ...(cacheControl === undefined ? {} : { cacheControl }),
          });
        }
        break;
      case "user":
        skippingHistoricalToolResults = false;
        pendingToolUseIds = new Set();
        rawProviderToolNamesById = new Map();
        canonicalProviderToolNamesById = new Map();
        pushAnthropicUserContent(messages, toAnthropicUserContent(message.content));
        break;
      case "assistant": {
        skippingHistoricalToolResults = false;
        const shouldCompactCompletedToolRound = shouldCompactAnthropicToolRound(
          message,
          index,
          lastHistoricalAssistantTextIndex,
        );
        const rawAssistantMessages = rawAssistantMessagesByIndex.get(index);
        if (rawAssistantMessages && rawReplayIndices.has(index)) {
          const replay = validateAnthropicProviderReplay(
            message,
            rawAssistantMessages,
            rawProviderToolNamesById,
            canonicalProviderToolNamesById,
          );
          rawProviderToolNamesById = replay.nextProviderToolNamesById;
          canonicalProviderToolNamesById = replay.nextCanonicalProviderToolNamesById;
          pendingToolUseIds = new Set();
          for (const rawContent of replay.messages) {
            messages.push({ role: "assistant", content: rawContent });
            for (const block of rawContent) {
              if (block.type === "tool_use" && typeof block.id === "string") {
                pendingToolUseIds.add(block.id);
              }
            }
          }
          break;
        }
        const assistantContent = shouldCompactCompletedToolRound
          ? message.content.filter((part) => part.type === "text" && part.text.length > 0)
          : message.content;

        if (assistantContent.length === 0) {
          skippingHistoricalToolResults = shouldCompactCompletedToolRound;
          pendingToolUseIds = new Set();
          break;
        }

        pendingToolUseIds = new Set(
          assistantContent.flatMap((part) => part.type === "tool-call" ? [part.toolCallId] : []),
        );
        messages.push({
          role: "assistant",
          content: assistantContent.map((part) => {
            if (part.type === "text") {
              return { type: "text", text: part.text };
            }
            if (part.type === "reasoning") {
              if (typeof part.redactedData === "string") {
                return {
                  type: "redacted_thinking",
                  data: part.redactedData,
                };
              }
              return {
                type: "thinking",
                thinking: part.text ?? "",
                ...(typeof part.signature === "string" ? { signature: part.signature } : {}),
              };
            }
            if (part.type === "tool-result") {
              throw new TypeError(
                "Anthropic provider-executed assistant tool results require exact raw replay metadata",
              );
            }
            if (part.providerExecuted === true) {
              throw new TypeError(
                "Anthropic provider-executed assistant tool calls require exact raw replay metadata",
              );
            }
            return {
              type: "tool_use",
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            };
          }),
        });
        skippingHistoricalToolResults = shouldCompactCompletedToolRound;
        break;
      }
      case "tool": {
        if (skippingHistoricalToolResults) {
          break;
        }
        const matchingToolResults = message.content.filter((part) =>
          pendingToolUseIds.has(part.toolCallId)
        );
        if (matchingToolResults.length === 0) {
          break;
        }
        pushAnthropicUserContent(
          messages,
          matchingToolResults.map((part) => ({
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: stringifyToolResultValue(part.output.value),
          })),
        );
        for (const part of matchingToolResults) {
          pendingToolUseIds.delete(part.toolCallId);
        }
        break;
      }
    }
  }

  if (systemParts.length === 0) {
    return {
      messages,
      providerToolNamesById: createValidatedAnthropicProviderToolCorrelationState(
        canonicalProviderToolNamesById,
        rawProviderToolNamesById,
      ),
    };
  }

  if (systemParts.some((part) => part.cacheControl !== undefined)) {
    const system = systemParts.map((part) => ({
      type: "text",
      text: part.text,
      ...(part.cacheControl === undefined ? {} : { cache_control: part.cacheControl }),
    }));
    const lastSystemBlock = system.at(-1);
    if (systemCacheControl && lastSystemBlock) {
      lastSystemBlock.cache_control = systemCacheControl;
    }
    return {
      system,
      messages,
      providerToolNamesById: createValidatedAnthropicProviderToolCorrelationState(
        canonicalProviderToolNamesById,
        rawProviderToolNamesById,
      ),
    };
  }

  const joined = systemParts.map((part) => part.text).join("\n\n");
  if (systemCacheControl) {
    return {
      system: [{
        type: "text",
        text: joined,
        cache_control: systemCacheControl,
      }],
      messages,
      providerToolNamesById: createValidatedAnthropicProviderToolCorrelationState(
        canonicalProviderToolNamesById,
        rawProviderToolNamesById,
      ),
    };
  }

  return {
    system: joined,
    messages,
    providerToolNamesById: createValidatedAnthropicProviderToolCorrelationState(
      canonicalProviderToolNamesById,
      rawProviderToolNamesById,
    ),
  };
}

const ANTHROPIC_TOOL_VERSION_ALIASES: Record<string, string> = {
  code_execution: "code_execution_20260120",
  computer_use: "computer_20250124",
  computer: "computer_20250124",
  text_editor: "text_editor_20250728",
  bash: "bash_20250124",
  memory: "memory_20250818",
  web_search: "web_search_20250305",
  web_fetch: "web_fetch_20250910",
};

function resolveAnthropicProviderType(rawType: string): string {
  if (/_\d{8}$/.test(rawType)) {
    return rawType;
  }
  return ANTHROPIC_TOOL_VERSION_ALIASES[rawType] ?? rawType;
}

function toAnthropicTools(
  tools: readonly ModelRuntimeToolDefinition[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools) {
    return undefined;
  }

  const normalized: Array<Record<string, unknown>> = [];

  for (const tool of tools) {
    if (tool.type === "function") {
      normalized.push({
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        input_schema: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }

    if (!tool.id.startsWith("anthropic.")) {
      continue;
    }

    const rawType = tool.id.slice("anthropic.".length);
    if (rawType.length === 0) {
      continue;
    }

    if (rawType === "mcp_toolset") {
      const args = normalizeAnthropicMcpToolsetArgs(tool.args);
      normalized.push({
        type: "mcp_toolset",
        mcp_server_name: tool.name,
        ...args,
      });
      continue;
    }

    normalized.push({
      type: resolveAnthropicProviderType(rawType),
      name: tool.name,
      ...toSnakeCaseRecord(tool.args),
    });
  }

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized;
}

function mergeAnthropicMcpToolsets(
  tools: Array<Record<string, unknown>> | undefined,
  mcpConfiguration: AnthropicMcpRequestConfiguration | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!mcpConfiguration) return tools;

  const merged = [...(tools ?? [])];
  const explicitServerNames = new Set(
    merged.flatMap((tool) =>
      tool.type === "mcp_toolset" && typeof tool.mcp_server_name === "string"
        ? [tool.mcp_server_name]
        : []
    ),
  );

  for (const defaultToolset of mcpConfiguration.defaultToolsets) {
    if (explicitServerNames.has(defaultToolset.mcp_server_name)) {
      if (mcpConfiguration.legacyConfiguredServerNames.has(defaultToolset.mcp_server_name)) {
        throw new TypeError(
          "Anthropic MCP tool configuration must use either mcpServers or a provider tool",
        );
      }
      continue;
    }
    merged.push(defaultToolset);
  }
  return merged;
}

function applyAnthropicToolsCacheControl(
  tools: Array<Record<string, unknown>> | undefined,
  cacheControl: { type: "ephemeral"; ttl?: "1h" } | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools || !cacheControl) return tools;
  const lastIndex = tools.length - 1;
  return tools.map((tool, index) =>
    index === lastIndex ? { ...tool, cache_control: cacheControl } : tool
  );
}

function isOmittedJsonObjectPropertyValue(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function assertNoAnthropicCacheJsonHook(value: object): void {
  const visited = new NativeSet<object>();
  let candidate: object | null = value;
  let depth = 0;
  while (candidate !== null && !hasSetValue(visited, candidate) && depth < 64) {
    if (isProxyWithoutHooks(candidate)) {
      throw new TypeError("Anthropic cache inputs must not contain Proxy values");
    }
    addSetValue(visited, candidate);
    depth += 1;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(candidate, "toJSON");
    } catch {
      throw new TypeError("Anthropic cache input toJSON hooks could not be inspected");
    }
    if (descriptor !== undefined) {
      if (!objectHasOwn(descriptor, "value") || typeof descriptor.value === "function") {
        throw new TypeError("Anthropic cache inputs must not define toJSON hooks");
      }
      return;
    }
    try {
      candidate = objectGetPrototypeOf(candidate);
    } catch {
      throw new TypeError("Anthropic cache input toJSON hooks could not be inspected");
    }
  }
  if (candidate !== null) {
    throw new TypeError("Anthropic cache input toJSON hooks could not be inspected");
  }
}

function assertNoNestedAnthropicCacheJsonHooks(
  value: object,
  label = "Anthropic cache_control",
  ancestors = new NativeSet<object>(),
  depth = 0,
): void {
  if (depth >= 64 || hasSetValue(ancestors, value)) {
    throw new TypeError("Anthropic cache input toJSON hooks could not be inspected");
  }
  if (isBoxedPrimitive(value)) {
    throw new TypeError(`${label} must not contain boxed primitive values`);
  }
  assertNoAnthropicCacheJsonHook(value);
  addSetValue(ancestors, value);
  try {
    if (ArrayIsArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const key = `${index}`;
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = objectGetOwnPropertyDescriptor(value, key);
        } catch {
          throw new TypeError(`${label} could not be inspected`);
        }
        if (descriptor === undefined) {
          assertNoInheritedAnthropicArrayElement(value, index, label);
          continue;
        }
        if (!objectHasOwn(descriptor, "value")) {
          throw new TypeError(`${label} must contain only indexed data properties`);
        }
        const nested = descriptor.value;
        if (
          nested !== null &&
          (typeof nested === "object" || typeof nested === "function")
        ) {
          assertNoNestedAnthropicCacheJsonHooks(
            nested,
            label === "Anthropic message content" ? "Anthropic cache records" : label,
            ancestors,
            depth + 1,
          );
        }
      }
      return;
    }
    let keys: string[];
    try {
      keys = objectKeys(value);
    } catch {
      throw new TypeError("Anthropic cache input toJSON hooks could not be inspected");
    }
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = objectGetOwnPropertyDescriptor(value, key);
      } catch {
        throw new TypeError("Anthropic cache input toJSON hooks could not be inspected");
      }
      if (!descriptor || !objectHasOwn(descriptor, "value")) {
        throw new TypeError(`${label} must contain only enumerable data properties`);
      }
      const nested = descriptor.value;
      if (
        nested !== null &&
        (typeof nested === "object" || typeof nested === "function")
      ) {
        const nestedLabel = key === "cache_control" ? "Anthropic cache_control" : label;
        if (
          nestedLabel === "Anthropic cache_control" &&
          (key === "type" || key === "ttl") &&
          isBoxedString(nested)
        ) {
          assertNoAnthropicCacheJsonHook(nested);
          continue;
        }
        assertNoNestedAnthropicCacheJsonHooks(
          nested,
          nestedLabel,
          ancestors,
          depth + 1,
        );
      }
    }
  } finally {
    deleteSetValue(ancestors, value);
  }
}

function assertNoAnthropicCacheRecordSerializationHooks(value: object): void {
  if (isBoxedPrimitive(value)) {
    throw new TypeError("Anthropic cache records must not contain boxed primitive values");
  }
  assertNoAnthropicCacheJsonHook(value);
  let keys: string[];
  try {
    keys = objectKeys(value);
  } catch {
    throw new TypeError("Anthropic cache records could not be inspected");
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError("Anthropic cache records could not be inspected");
    }
    if (!descriptor || !objectHasOwn(descriptor, "value")) {
      if (key === "cache_control") {
        throw new TypeError(
          "Anthropic cache_control must be an own enumerable data property",
        );
      }
      throw new TypeError(
        "Anthropic cache records must contain only enumerable data properties",
      );
    }
    const nested = descriptor.value;
    if (
      nested !== null &&
      (typeof nested === "object" || typeof nested === "function")
    ) {
      const nestedLabel = key === "cache_control"
        ? "Anthropic cache_control"
        : key === "content" && ArrayIsArray(nested)
        ? "Anthropic message content"
        : "Anthropic cache records";
      assertNoNestedAnthropicCacheJsonHooks(
        nested,
        nestedLabel,
      );
    }
  }
}

function cloneAnthropicCacheRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  assertNoAnthropicCacheRecordSerializationHooks(value);
  const clone: Record<string, unknown> = {};
  const keys = objectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !objectHasOwn(descriptor, "value")) {
      throw new TypeError(
        "Anthropic cache records must contain only enumerable data properties",
      );
    }
    defineOwnEnumerableDataProperty(clone, key, descriptor.value);
  }
  return clone;
}

const ANTHROPIC_MAX_CACHE_BREAKPOINTS = 4;

function assertNoInheritedAnthropicArrayElement(
  value: unknown[],
  index: number,
  label: string,
): void {
  const key = `${index}`;
  const visited = new NativeSet<object>();
  let candidate: object | null;
  try {
    candidate = objectGetPrototypeOf(value);
  } catch {
    throw new TypeError(`${label} inherited indexed properties could not be inspected`);
  }
  let depth = 0;
  while (candidate !== null && !hasSetValue(visited, candidate) && depth < 64) {
    if (isProxyWithoutHooks(candidate)) {
      throw new TypeError(`${label} inherited indexed properties could not be inspected`);
    }
    addSetValue(visited, candidate);
    depth += 1;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(candidate, key);
    } catch {
      throw new TypeError(`${label} inherited indexed properties could not be inspected`);
    }
    if (descriptor !== undefined) {
      throw new TypeError(`${label} must not contain inherited indexed properties`);
    }
    try {
      candidate = objectGetPrototypeOf(candidate);
    } catch {
      throw new TypeError(`${label} inherited indexed properties could not be inspected`);
    }
  }
  if (candidate !== null) {
    throw new TypeError(`${label} inherited indexed properties could not be inspected`);
  }
}

function snapshotAnthropicCacheArray<T>(
  value: T[],
  label: string,
): T[] {
  assertNoAnthropicCacheJsonHook(value);
  const snapshot = new NativeArray<T>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(value, `${index}`);
    } catch {
      throw new TypeError(`${label} could not be inspected`);
    }
    if (descriptor === undefined) {
      assertNoInheritedAnthropicArrayElement(value, index, label);
      continue;
    }
    if (!objectHasOwn(descriptor, "value")) {
      throw new TypeError(`${label} must contain only indexed data properties`);
    }
    defineOwnEnumerableDataProperty(snapshot, `${index}`, descriptor.value as T);
  }
  return snapshot;
}

function hasEmittedAnthropicCacheBreakpoint(value: Record<string, unknown>): boolean {
  assertNoAnthropicCacheRecordSerializationHooks(value);
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = objectGetOwnPropertyDescriptor(value, "cache_control");
  } catch {
    throw new TypeError("Anthropic cache_control could not be inspected");
  }
  if (descriptor === undefined || descriptor.enumerable !== true) {
    return false;
  }
  if (!objectHasOwn(descriptor, "value")) {
    throw new TypeError(
      "Anthropic cache_control must be an own enumerable data property",
    );
  }
  if (
    typeof descriptor.value === "function" ||
    (typeof descriptor.value === "object" && descriptor.value !== null)
  ) {
    assertNoAnthropicCacheJsonHook(descriptor.value);
  }
  return !isOmittedJsonObjectPropertyValue(descriptor.value);
}

function isAnthropicMessageCacheBlock(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value === "function" || ArrayIsArray(value)) {
    assertNoAnthropicCacheJsonHook(value);
    return false;
  }
  return typeof value === "object" && value !== null;
}

function readEmittedAnthropicMessageContent(message: AnthropicCompatibleMessage): unknown[] {
  assertNoAnthropicCacheRecordSerializationHooks(message);
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = objectGetOwnPropertyDescriptor(message, "content");
  } catch {
    throw new TypeError("Anthropic message content could not be inspected");
  }
  if (descriptor === undefined || descriptor.enumerable !== true) {
    return [];
  }
  if (!objectHasOwn(descriptor, "value")) {
    throw new TypeError(
      "Anthropic message content must be an own enumerable data property",
    );
  }
  const content = descriptor.value;
  if (!ArrayIsArray(content)) {
    if (
      (typeof content === "object" && content !== null) ||
      typeof content === "function"
    ) {
      assertNoAnthropicCacheJsonHook(content);
    }
    return [];
  }
  return snapshotAnthropicCacheArray(
    content,
    "Anthropic message content",
  );
}

function readAnthropicArrayDataElement(
  value: unknown[],
  index: number,
  label: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = objectGetOwnPropertyDescriptor(value, `${index}`);
  } catch {
    throw new TypeError(`${label} could not be inspected`);
  }
  if (descriptor === undefined) {
    return undefined;
  }
  if (!objectHasOwn(descriptor, "value")) {
    throw new TypeError(`${label} must contain only indexed data properties`);
  }
  return descriptor.value;
}

function retainLatestAnthropicMessageCacheBreakpoints(
  messages: AnthropicCompatibleMessage[],
  maximum: number,
): AnthropicCompatibleMessage[] {
  const breakpointCount = countAnthropicMessageCacheBreakpoints(messages);
  let remainingToRemove = breakpointCount > maximum ? breakpointCount - maximum : 0;
  if (remainingToRemove === 0) {
    return messages;
  }

  const normalizedMessages = new NativeArray<AnthropicCompatibleMessage>(messages.length);
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = readAnthropicArrayDataElement(
      messages,
      messageIndex,
      "Anthropic messages",
    ) as AnthropicCompatibleMessage | undefined;
    if (message === undefined) {
      continue;
    }
    const originalContent = readEmittedAnthropicMessageContent(message);
    let content = originalContent;
    for (
      let contentIndex = 0;
      remainingToRemove > 0 && contentIndex < originalContent.length;
      contentIndex += 1
    ) {
      const block = readAnthropicArrayDataElement(
        originalContent,
        contentIndex,
        "Anthropic message content",
      );
      if (
        !isAnthropicMessageCacheBlock(block) ||
        !hasEmittedAnthropicCacheBreakpoint(block)
      ) {
        continue;
      }
      if (content === originalContent) {
        content = snapshotAnthropicCacheArray(
          originalContent,
          "Anthropic message content",
        );
      }
      const next = cloneAnthropicCacheRecord(block);
      reflectDeleteProperty(next, "cache_control");
      defineOwnEnumerableDataProperty(content, `${contentIndex}`, next);
      remainingToRemove -= 1;
    }
    if (content === originalContent) {
      defineOwnEnumerableDataProperty(normalizedMessages, `${messageIndex}`, message);
    } else {
      const nextMessage = cloneAnthropicCacheRecord(
        message as Record<string, unknown>,
      );
      defineOwnEnumerableDataProperty(nextMessage, "content", content);
      defineOwnEnumerableDataProperty(
        normalizedMessages,
        `${messageIndex}`,
        nextMessage as AnthropicCompatibleMessage,
      );
    }
  }
  return normalizedMessages;
}

function countAnthropicMessageCacheBreakpoints(messages: AnthropicCompatibleMessage[]): number {
  let count = 0;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = readAnthropicArrayDataElement(
      messages,
      messageIndex,
      "Anthropic messages",
    ) as AnthropicCompatibleMessage | undefined;
    if (message === undefined) {
      continue;
    }
    const content = readEmittedAnthropicMessageContent(message);
    for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
      const block = readAnthropicArrayDataElement(
        content,
        contentIndex,
        "Anthropic message content",
      );
      if (
        isAnthropicMessageCacheBlock(block) &&
        hasEmittedAnthropicCacheBreakpoint(block)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

type AnthropicCacheTtl = "5m" | "1h";

function readJsonSerializedAnthropicString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return undefined;

  assertNoAnthropicCacheJsonHook(value);
  try {
    apply(stringValueOf, value, []);
  } catch {
    return undefined;
  }
  throw new TypeError("Anthropic cache strings must use primitive string values");
}

function snapshotAnthropicProviderBucket(
  bucket: object,
): Record<string, unknown> {
  if (isProxyWithoutHooks(bucket)) {
    throw new TypeError("Anthropic provider options could not be inspected");
  }

  const snapshot: Record<string, unknown> = {};
  let keys: PropertyKey[];
  try {
    keys = apply(reflectOwnKeys, Reflect, [bucket]) as PropertyKey[];
  } catch {
    throw new TypeError("Anthropic provider options could not be inspected");
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== "string") continue;

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(bucket, key);
    } catch {
      throw new TypeError("Anthropic provider options could not be inspected");
    }
    if (descriptor?.enumerable !== true) continue;
    if (!objectHasOwn(descriptor, "value")) {
      throw new TypeError("Anthropic provider options could not be inspected");
    }
    defineOwnEnumerableDataProperty(snapshot, key, descriptor.value);
  }
  return snapshot;
}

function prepareAnthropicProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
  ...providerNames: string[]
): Record<string, unknown> | undefined {
  if (providerOptions === undefined) return undefined;

  try {
    if (canIdentifyProxyWithoutHooks) {
      if (isProxyWithoutHooks(providerOptions)) {
        throw new TypeError("Anthropic provider options could not be inspected");
      }
      const snapshot: Record<string, unknown> = {};
      for (let index = 0; index < providerNames.length; index += 1) {
        const providerName = providerNames[index]!;
        const descriptor = objectGetOwnPropertyDescriptor(providerOptions, providerName);
        if (descriptor === undefined) continue;
        if (!objectHasOwn(descriptor, "value")) {
          throw new TypeError("Anthropic provider options could not be inspected");
        }
        const value = descriptor.value;
        defineOwnEnumerableDataProperty(
          snapshot,
          providerName,
          value !== null && typeof value === "object" && !ArrayIsArray(value)
            ? snapshotAnthropicProviderBucket(value)
            : value,
        );
      }
      return snapshot;
    }

    const snapshot = snapshotProviderJsonValue(providerOptions, {
      dropUndefinedMembers: true,
      sortObjectKeys: false,
    });
    if (snapshot === null || typeof snapshot !== "object" || ArrayIsArray(snapshot)) {
      throw new TypeError("Anthropic provider options could not be inspected");
    }
    return snapshot as Record<string, unknown>;
  } catch {
    throw new TypeError("Anthropic provider options could not be inspected");
  }
}

function readEmittedAnthropicCacheTtl(
  value: Record<string, unknown>,
): AnthropicCacheTtl | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = objectGetOwnPropertyDescriptor(value, "cache_control");
  } catch {
    return undefined;
  }
  if (
    descriptor === undefined || descriptor.enumerable !== true ||
    !objectHasOwn(descriptor, "value")
  ) {
    return undefined;
  }
  const cacheControl = descriptor.value;
  if (
    typeof cacheControl !== "object" || cacheControl === null ||
    ArrayIsArray(cacheControl)
  ) {
    return undefined;
  }
  assertNoNestedAnthropicCacheJsonHooks(cacheControl);

  let keys: string[];
  try {
    keys = objectKeys(cacheControl);
  } catch {
    return undefined;
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const property = readOwnEnumerableDataProperty(cacheControl, key);
    if (!property) {
      throw new TypeError(
        "Anthropic cache_control must contain only enumerable data properties",
      );
    }
    if (!isOmittedJsonObjectPropertyValue(property.value) && key !== "type" && key !== "ttl") {
      return undefined;
    }
  }
  const type = readOwnEnumerableDataProperty(cacheControl, "type");
  const ttl = readOwnEnumerableDataProperty(cacheControl, "ttl");
  const typeValue = type?.present ? readJsonSerializedAnthropicString(type.value) : undefined;
  const ttlValue = ttl?.present ? readJsonSerializedAnthropicString(ttl.value) : undefined;
  if (
    !type?.present || isOmittedJsonObjectPropertyValue(type.value) ||
    typeValue !== "ephemeral" || !ttl
  ) {
    return undefined;
  }
  if (ttl.present && ttlValue === "1h") {
    return "1h";
  }
  return !ttl.present || isOmittedJsonObjectPropertyValue(ttl.value) || ttlValue === "5m"
    ? "5m"
    : undefined;
}

function upgradeEmittedAnthropicCacheTtl(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const upgraded = cloneAnthropicCacheRecord(value);
  defineOwnEnumerableDataProperty(
    upgraded,
    "cache_control",
    { type: "ephemeral", ttl: "1h" },
  );
  return upgraded;
}

function normalizeAnthropicCacheTtls(
  values: Array<Record<string, unknown>>,
  requiresOneHourPrefix: boolean,
): { values: Array<Record<string, unknown>>; requiresOneHourPrefix: boolean } {
  let normalized = values;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (!value || !hasEmittedAnthropicCacheBreakpoint(value)) {
      continue;
    }
    const ttl = readEmittedAnthropicCacheTtl(value);
    if (ttl === "1h") {
      requiresOneHourPrefix = true;
    } else if (ttl === "5m" && requiresOneHourPrefix) {
      if (normalized === values) {
        normalized = snapshotAnthropicCacheArray(values, "Anthropic cache blocks");
      }
      defineOwnEnumerableDataProperty(
        normalized,
        `${index}`,
        upgradeEmittedAnthropicCacheTtl(value),
      );
    }
  }
  return { values: normalized, requiresOneHourPrefix };
}

function normalizeAnthropicMessageCacheTtls(
  messages: AnthropicCompatibleMessage[],
): { messages: AnthropicCompatibleMessage[]; requiresOneHourPrefix: boolean } {
  let normalizedMessages = messages;
  let requiresOneHourPrefix = false;

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }
    const content = readEmittedAnthropicMessageContent(message);
    let normalizedContent = content;
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const block = content[contentIndex];
      if (
        !isAnthropicMessageCacheBlock(block) ||
        !hasEmittedAnthropicCacheBreakpoint(block)
      ) {
        continue;
      }
      const ttl = readEmittedAnthropicCacheTtl(block as Record<string, unknown>);
      if (ttl === "1h") {
        requiresOneHourPrefix = true;
      } else if (ttl === "5m" && requiresOneHourPrefix) {
        if (normalizedContent === content) {
          normalizedContent = snapshotAnthropicCacheArray(
            content,
            "Anthropic message content",
          );
        }
        defineOwnEnumerableDataProperty(
          normalizedContent,
          `${contentIndex}`,
          upgradeEmittedAnthropicCacheTtl(block),
        );
      }
    }
    if (normalizedContent !== content) {
      if (normalizedMessages === messages) {
        normalizedMessages = snapshotAnthropicCacheArray(
          messages,
          "Anthropic messages",
        );
      }
      const nextMessage = cloneAnthropicCacheRecord(
        message as Record<string, unknown>,
      );
      defineOwnEnumerableDataProperty(nextMessage, "content", normalizedContent);
      defineOwnEnumerableDataProperty(
        normalizedMessages,
        `${messageIndex}`,
        nextMessage as AnthropicCompatibleMessage,
      );
    }
  }

  return { messages: normalizedMessages, requiresOneHourPrefix };
}

function retainLatestAnthropicCacheBreakpoints(
  values: Array<Record<string, unknown>>,
  maximum: number,
): Array<Record<string, unknown>> {
  const breakpointIndexes = new NativeArray<number>(values.length);
  let breakpointCount = 0;
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = objectGetOwnPropertyDescriptor(values, `${index}`);
    if (
      descriptor !== undefined &&
      hasEmittedAnthropicCacheBreakpoint(descriptor.value)
    ) {
      defineOwnEnumerableDataProperty(breakpointIndexes, `${breakpointCount}`, index);
      breakpointCount += 1;
    }
  }

  const removalCount = breakpointCount > maximum ? breakpointCount - maximum : 0;
  if (removalCount === 0) {
    return values;
  }

  const retained = new NativeArray<Record<string, unknown>>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = objectGetOwnPropertyDescriptor(values, `${index}`);
    if (descriptor !== undefined) {
      defineOwnEnumerableDataProperty(retained, `${index}`, descriptor.value);
    }
  }
  for (let position = 0; position < removalCount; position += 1) {
    const index = breakpointIndexes[position]!;
    const next = cloneAnthropicCacheRecord(retained[index]!);
    reflectDeleteProperty(next, "cache_control");
    defineOwnEnumerableDataProperty(retained, `${index}`, next);
  }
  return retained;
}

function countAnthropicCacheBreakpoints(
  values: Array<Record<string, unknown>>,
): number {
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = readAnthropicArrayDataElement(
      values,
      index,
      "Anthropic cache blocks",
    ) as Record<string, unknown> | undefined;
    if (value !== undefined && hasEmittedAnthropicCacheBreakpoint(value)) {
      count += 1;
    }
  }
  return count;
}

function limitAnthropicCacheBreakpoints(
  system: string | Array<Record<string, unknown>> | undefined,
  tools: Array<Record<string, unknown>> | undefined,
  messages: AnthropicCompatibleMessage[],
): {
  system: string | Array<Record<string, unknown>> | undefined;
  tools: Array<Record<string, unknown>> | undefined;
  messages: AnthropicCompatibleMessage[];
} {
  const inspectedMessages = snapshotAnthropicCacheArray(
    messages,
    "Anthropic messages",
  );
  const inspectedSystem = ArrayIsArray(system)
    ? snapshotAnthropicCacheArray(system, "Anthropic system")
    : system;
  const inspectedTools = tools ? snapshotAnthropicCacheArray(tools, "Anthropic tools") : undefined;
  const boundedMessages = retainLatestAnthropicMessageCacheBreakpoints(
    inspectedMessages,
    ANTHROPIC_MAX_CACHE_BREAKPOINTS,
  );
  const messageBreakpointCount = countAnthropicMessageCacheBreakpoints(boundedMessages);
  const boundedSystem = ArrayIsArray(inspectedSystem)
    ? retainLatestAnthropicCacheBreakpoints(
      inspectedSystem,
      ANTHROPIC_MAX_CACHE_BREAKPOINTS - messageBreakpointCount,
    )
    : inspectedSystem;
  const systemBreakpointCount = ArrayIsArray(boundedSystem)
    ? countAnthropicCacheBreakpoints(boundedSystem)
    : 0;
  const boundedTools = inspectedTools
    ? retainLatestAnthropicCacheBreakpoints(
      inspectedTools,
      ANTHROPIC_MAX_CACHE_BREAKPOINTS - messageBreakpointCount - systemBreakpointCount,
    )
    : undefined;
  const normalizedMessages = normalizeAnthropicMessageCacheTtls(boundedMessages);
  const normalizedSystem = ArrayIsArray(boundedSystem)
    ? normalizeAnthropicCacheTtls(
      boundedSystem,
      normalizedMessages.requiresOneHourPrefix,
    )
    : {
      values: boundedSystem,
      requiresOneHourPrefix: normalizedMessages.requiresOneHourPrefix,
    };
  const normalizedTools = boundedTools
    ? normalizeAnthropicCacheTtls(
      boundedTools,
      normalizedSystem.requiresOneHourPrefix,
    ).values
    : undefined;
  return {
    system: normalizedSystem.values,
    tools: normalizedTools,
    messages: normalizedMessages.messages,
  };
}

function assertAnthropicCacheableRequestFields(
  body: Record<string, unknown>,
): asserts body is AnthropicCompatibleRequest {
  assertNoAnthropicCacheJsonHook(body);
  if (!ArrayIsArray(body.messages)) {
    throw new TypeError("Anthropic messages must be an array");
  }
  if (
    body.system !== undefined && typeof body.system !== "string" &&
    !ArrayIsArray(body.system)
  ) {
    throw new TypeError("Anthropic system must be a string or an array");
  }
  if (body.tools !== undefined && !ArrayIsArray(body.tools)) {
    throw new TypeError("Anthropic tools must be an array");
  }

  const keys = objectKeys(body);
  let lastCacheFieldIndex = -1;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === "messages" || key === "system" || key === "tools") {
      lastCacheFieldIndex = index;
    }
  }
  for (let index = 0; index <= lastCacheFieldIndex; index += 1) {
    const key = keys[index]!;
    if (key === "messages" || key === "system" || key === "tools") {
      continue;
    }
    const descriptor = objectGetOwnPropertyDescriptor(body, key);
    if (!descriptor || !objectHasOwn(descriptor, "value")) {
      throw new TypeError("Anthropic request fields must use enumerable data properties");
    }
    const value = descriptor.value;
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    ) {
      assertNoNestedAnthropicCacheJsonHooks(value, "Anthropic request fields");
    }
  }
}

function containsAnthropicMcpToolset(
  tools: Array<Record<string, unknown>> | undefined,
): boolean {
  return tools?.some((tool) => tool.type === "mcp_toolset") ?? false;
}

function getAnthropicModelCapabilities(
  modelId: string,
): { maxOutputTokens: number; isKnownModel: boolean } {
  if (
    modelId.includes("claude-opus-4-8") ||
    modelId.includes("claude-opus-4-7") ||
    modelId.includes("claude-opus-4-6")
  ) {
    return { maxOutputTokens: 128_000, isKnownModel: true };
  }
  if (modelId.includes("claude-sonnet-4-6")) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (
    modelId.includes("claude-sonnet-4-5") ||
    modelId.includes("claude-opus-4-5") ||
    modelId.includes("claude-haiku-4-5")
  ) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (modelId.includes("claude-opus-4-1")) {
    return { maxOutputTokens: 32_000, isKnownModel: true };
  }
  if (modelId.includes("claude-sonnet-4-")) {
    return { maxOutputTokens: 64_000, isKnownModel: true };
  }
  if (modelId.includes("claude-opus-4-")) {
    return { maxOutputTokens: 32_000, isKnownModel: true };
  }
  if (modelId.includes("claude-3-haiku")) {
    return { maxOutputTokens: 4096, isKnownModel: true };
  }
  return { maxOutputTokens: 4096, isKnownModel: false };
}

/**
 * Map a framework response format onto Anthropic `output_config`.
 *
 * The Messages API constrains generation with
 * `output_config.format = { type: "json_schema", schema }`. There is no
 * schemaless JSON mode, so `{ type: "json" }` is reported as dropped rather
 * than approximated.
 */
function buildAnthropicOutputConfig(
  responseFormat: ModelRuntimeCallOptions["responseFormat"],
  warnings: WarningCollector,
): { format: Record<string, unknown> } | undefined {
  if (!responseFormat || responseFormat.type === "text") return undefined;
  if (responseFormat.type === "json") {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "responseFormat",
      details:
        "Anthropic output_config requires a schema; schemaless JSON mode is unavailable. Pass a json_schema response format instead.",
    });
    return undefined;
  }

  return {
    format: {
      type: "json_schema",
      schema: closeObjectSchemas(unwrapToolInputSchema(responseFormat.schema)),
    },
  };
}

/**
 * JSON Schema keywords whose value is itself a schema, a list of schemas, or a
 * map of schemas. Recursion is restricted to these so that keywords holding
 * literal values -- `default`, `const`, `enum`, `examples` -- are copied
 * through untouched instead of being rewritten when they happen to look like a
 * schema.
 */
const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  // Draft-07 `dependencies` holds either a schema or an array of property
  // names per key. The array form contains strings, which the walk returns
  // unchanged, so both spellings can share this branch.
  "dependencies",
]);
const SCHEMA_LIST_KEYWORDS = new Set(["anyOf", "oneOf", "prefixItems"]);
/**
 * `allOf` branches describe one instance together, not alternatives, and
 * `additionalProperties` only ever sees the `properties` of the schema object
 * carrying it. Closing branches that each declare part of the object therefore
 * makes every one of them reject the others' properties, and the composition
 * accepts nothing at all:
 *
 *   allOf: [ { properties: { a }, additionalProperties: false },
 *            { properties: { b }, additionalProperties: false } ]
 *
 * `{ a, b }` fails the first branch on `b` and the second on `a`.
 *
 * So branches are walked for objects nested deeper inside them, but are not
 * closed themselves. An `allOf` of open objects is still rejected by Anthropic
 * -- which is the correct outcome, and a legible one, rather than a schema that
 * validates nothing the model can produce.
 */
const COMPOSITION_LIST_KEYWORDS = new Set(["allOf"]);
const SCHEMA_VALUE_KEYWORDS = new Set([
  "items",
  "additionalItems",
  "contains",
  "additionalProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema",
]);

/**
 * Set `additionalProperties: false` on every object-typed subschema that left
 * it unset.
 *
 * Anthropic's `output_config.format` rejects an object schema without it with a
 * 400 -- "For 'object' type, 'additionalProperties' must be explicitly set to
 * false" -- unconditionally, and independently of the framework's own `strict`
 * flag. A plain `v.object({...})` with every field required therefore fails
 * even though it already satisfies the rest of strict structured output, so the
 * requirement is satisfied here rather than pushed onto every caller.
 *
 * An explicitly declared `additionalProperties` is preserved: rewriting it
 * would silently narrow a contract the caller deliberately opened, and
 * Anthropic surfaces its own error for that case. An explicit `undefined`
 * is not a declaration -- JSON drops it before the provider ever sees it.
 *
 * The result is a copy. The schema object belongs to the agent and is reused
 * across providers and calls, so closing it for Anthropic must not mutate it.
 */
function closeObjectSchemas(schema: unknown, closeSelf = true): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => closeObjectSchemas(entry, closeSelf));
  if (typeof schema !== "object" || schema === null) return schema;

  const source = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (SCHEMA_MAP_KEYWORDS.has(key)) {
      result[key] = typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map((
            [name, subschema],
          ) => [name, closeObjectSchemas(subschema)]),
        )
        : value;
      continue;
    }
    if (COMPOSITION_LIST_KEYWORDS.has(key)) {
      result[key] = Array.isArray(value)
        ? value.map((branch) => closeObjectSchemas(branch, false))
        : closeObjectSchemas(value, false);
      continue;
    }
    if (SCHEMA_LIST_KEYWORDS.has(key) || SCHEMA_VALUE_KEYWORDS.has(key)) {
      result[key] = closeObjectSchemas(value);
      continue;
    }
    result[key] = value;
  }

  // `undefined` counts as unset, not as a declaration. The key survives the
  // walk when a caller writes it explicitly as `undefined`, but JSON drops it
  // on the way to the provider -- so honoring its presence would emit exactly
  // the open schema Anthropic rejects.
  if (closeSelf && isObjectTyped(source.type) && source.additionalProperties === undefined) {
    result.additionalProperties = false;
  }
  return result;
}

/**
 * Whether a schema declares the object type.
 *
 * `JsonSchema.type` accepts an array as well as a single name, and the array
 * form is how a nullable object is written by hand:
 * `{ type: ["object", "null"], properties: {...} }`. Matching only the exact
 * string would leave that branch open and let Anthropic reject it.
 */
function isObjectTyped(type: unknown): boolean {
  return type === "object" || (Array.isArray(type) && type.includes("object"));
}

function resolveAnthropicMaxTokens(
  modelId: string,
  callerMaxOutputTokens: number | undefined,
): number {
  const { maxOutputTokens: modelMax, isKnownModel } = getAnthropicModelCapabilities(modelId);
  const requested = callerMaxOutputTokens ?? modelMax;
  if (isKnownModel && requested > modelMax) {
    return modelMax;
  }
  return requested;
}

function resolveAnthropicThinkingBudget(
  option: RuntimeReasoningOption | undefined,
): number | undefined {
  if (!option || option.enabled !== true) {
    return undefined;
  }
  if (option.budgetTokens !== undefined) {
    if (!Number.isSafeInteger(option.budgetTokens) || option.budgetTokens < 1024) {
      throw new TypeError(
        "Anthropic reasoning budgetTokens must be a safe integer of at least 1024",
      );
    }
    return option.budgetTokens;
  }
  switch (option.effort) {
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
  options: Record<string, unknown>,
): number | undefined {
  const thinkingProperty = readOwnEnumerableDataProperty(options, "thinking");
  if (!thinkingProperty) {
    throw new TypeError("Anthropic provider thinking must be an object");
  }
  const thinking = thinkingProperty.present ? thinkingProperty.value : undefined;
  if (thinking === undefined) {
    return undefined;
  }
  if (
    thinking === null || typeof thinking !== "object" || ArrayIsArray(thinking) ||
    isProxyWithoutHooks(thinking)
  ) {
    throw new TypeError("Anthropic provider thinking must be an object");
  }
  const type = readOwnEnumerableDataProperty(thinking, "type");
  if (!type?.present || typeof type.value !== "string" || type.value.length === 0) {
    throw new TypeError("Anthropic provider thinking.type must be a non-empty string");
  }
  const budgetTokensProperty = readOwnEnumerableDataProperty(thinking, "budget_tokens");
  if (!budgetTokensProperty) {
    throw new TypeError(
      "Anthropic provider thinking.budget_tokens must be a safe integer of at least 1024",
    );
  }
  const budgetTokens = budgetTokensProperty.present ? budgetTokensProperty.value : undefined;
  if (
    budgetTokens !== undefined &&
    (!Number.isSafeInteger(budgetTokens) || (budgetTokens as number) < 1024)
  ) {
    throw new TypeError(
      "Anthropic provider thinking.budget_tokens must be a safe integer of at least 1024",
    );
  }
  if (type.value !== "enabled") {
    return undefined;
  }
  if (budgetTokens === undefined) {
    throw new TypeError(
      "Anthropic provider thinking.budget_tokens must be a safe integer of at least 1024",
    );
  }
  return budgetTokens as number;
}

export function buildAnthropicMessagesRequestWithCorrelationState(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): {
  body: AnthropicCompatibleRequest;
  providerToolNamesById: AnthropicProviderToolNameRegistry;
} {
  const systemCacheControl = resolveAnthropicCacheControlBlock(
    options.cacheControl?.system,
  );
  const toolsCacheControl = resolveAnthropicCacheControlBlock(
    options.cacheControl?.tools,
  );

  const { system, messages, providerToolNamesById } = toAnthropicMessages(
    options.prompt,
    systemCacheControl,
    providerName,
  );
  const mcpConfiguration = normalizeAnthropicMcpServers(options.mcpServers);
  const callerTools = toAnthropicTools(options.tools);
  const anthropicTools = applyAnthropicToolsCacheControl(
    mergeAnthropicMcpToolsets(callerTools, mcpConfiguration),
    toolsCacheControl,
  );
  const rawProviderOptions = readProviderOptions(
    prepareAnthropicProviderOptions(options.providerOptions, "anthropic", providerName),
    "anthropic",
    providerName,
  );
  if (
    mcpConfiguration &&
    (objectHasOwn(rawProviderOptions, "mcp_servers") ||
      objectHasOwn(rawProviderOptions, "tools"))
  ) {
    throw new TypeError(
      "Anthropic MCP configuration must not be split between mcpServers and providerOptions",
    );
  }
  if (
    objectHasOwn(rawProviderOptions, "tools") &&
    containsAnthropicMcpToolset(callerTools)
  ) {
    throw new TypeError(
      "Anthropic MCP toolsets must not be defined in both tools and providerOptions",
    );
  }
  const thinkingBudget = resolveAnthropicThinkingBudget(options.reasoning);
  const providerThinkingBudget = resolveAnthropicProviderThinkingBudget(rawProviderOptions);
  const effectiveThinkingBudget = thinkingBudget ?? providerThinkingBudget;
  const thinkingEnabled = effectiveThinkingBudget !== undefined;

  if (options.presencePenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "presencePenalty",
      details: "Anthropic Messages API has no equivalent and the value was dropped.",
    });
  }
  if (options.frequencyPenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "frequencyPenalty",
      details: "Anthropic Messages API has no equivalent and the value was dropped.",
    });
  }
  if (options.seed !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "seed",
      details: "Anthropic Messages API does not support deterministic seeding.",
    });
  }
  if (options.topK !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "topK",
      details: "Anthropic Messages API does not expose top_k on this surface.",
    });
  }
  if (options.stopSequences && options.stopSequences.length > 4) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "stopSequences",
      details:
        `Anthropic accepts at most 4 stop sequences; ${options.stopSequences.length} were provided and the extras were truncated.`,
    });
  }
  if (thinkingEnabled && options.temperature !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "temperature",
      details:
        "Dropped because Anthropic rejects sampling params when extended thinking is enabled.",
    });
  }
  if (thinkingEnabled && options.topP !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "anthropic",
      setting: "topP",
      details:
        "Dropped because Anthropic rejects sampling params when extended thinking is enabled.",
    });
  }
  const outputConfig = buildAnthropicOutputConfig(options.responseFormat, warnings);

  const baseMaxTokens = resolveAnthropicMaxTokens(modelId, options.maxOutputTokens);
  const maxTokens = thinkingEnabled
    ? Math.min(
      baseMaxTokens + (effectiveThinkingBudget ?? 0),
      getAnthropicModelCapabilities(modelId).maxOutputTokens,
    )
    : baseMaxTokens;

  const body: AnthropicCompatibleRequest = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    ...(stream ? { stream: true } : {}),
    ...(system ? { system } : {}),
    ...(!thinkingEnabled && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(!thinkingEnabled && options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stop_sequences: options.stopSequences.slice(0, 4) }
      : {}),
    ...(anthropicTools ? { tools: anthropicTools } : {}),
    ...(options.toolChoice !== undefined
      ? { tool_choice: normalizeAnthropicToolChoice(options.toolChoice) }
      : {}),
    ...(thinkingBudget !== undefined
      ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } }
      : {}),
    ...(typeof options.userId === "string" && options.userId.length > 0
      ? { metadata: { user_id: options.userId } }
      : {}),
    ...(mcpConfiguration ? { mcp_servers: mcpConfiguration.servers } : {}),
    ...(options.anthropicContainer !== undefined ? { container: options.anthropicContainer } : {}),
    ...(outputConfig ? { output_config: outputConfig } : {}),
  };

  apply(objectAssign, Object, [body, rawProviderOptions]);
  if (outputConfig) {
    body.output_config = outputConfig;
  }
  if (thinkingBudget !== undefined || providerThinkingBudget !== undefined) {
    body.thinking = { type: "enabled", budget_tokens: effectiveThinkingBudget };
  }
  assertAnthropicCacheableRequestFields(body);
  const boundedCacheBreakpoints = limitAnthropicCacheBreakpoints(
    body.system,
    body.tools,
    body.messages,
  );
  if (boundedCacheBreakpoints.system === undefined) {
    reflectDeleteProperty(body, "system");
  } else {
    body.system = boundedCacheBreakpoints.system;
  }
  if (boundedCacheBreakpoints.tools === undefined) {
    reflectDeleteProperty(body, "tools");
  } else {
    body.tools = boundedCacheBreakpoints.tools;
  }
  body.messages = boundedCacheBreakpoints.messages;
  assertAnthropicMcpRequestContract(body);
  return {
    body,
    providerToolNamesById: new Map(providerToolNamesById),
  };
}

export function buildAnthropicMessagesRequest(
  modelId: string,
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  stream: boolean,
  warnings: WarningCollector,
): AnthropicCompatibleRequest {
  return buildAnthropicMessagesRequestWithCorrelationState(
    modelId,
    providerName,
    options,
    stream,
    warnings,
  ).body;
}
