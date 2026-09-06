/**
 * Agent Runtime - Core execution engine
 *
 * Handles agent execution with:
 * - Multi-step reasoning (agent loop)
 * - Tool calling and execution
 * - Streaming responses
 * - Memory management
 * - Middleware execution
 *
 * @module ai/agent/runtime
 */

import {
  enterSerializedTurn,
  withRuntimeTurnLineage,
} from "#veryfront/agent/runtime/stateful-turn-lineage.ts";
import {
  type AgentConfig,
  type AgentContext,
  type AgentGenerateToolReplacements,
  type AgentResponse,
  type AgentStatus,
  type AgentSystem,
  getTextFromParts,
  type Message,
  type MessagePart,
  type ResolvedRuntimeState,
  type RuntimeReasoningOption,
  type ToolCall,
  type ToolExecutionResultRequest,
  type ToolResultPart,
} from "../types.ts";
import { ensureModelReady, type ModelRuntime, resolveModel } from "#veryfront/provider";
import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED } from "#veryfront/errors";
import { generateId } from "#veryfront/utils/id.ts";
import { detectPlatform, getPlatformCapabilities } from "#veryfront/platform/core-platform.ts";
import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { createAgentMemory, type Memory, NoMemory } from "#veryfront/agent/memory/index.ts";
import { beginMemoryTransaction } from "#veryfront/agent/memory/memory.ts";
import { awaitAbortable } from "#veryfront/utils/abort.ts";
import { serverLogger } from "#veryfront/utils";
import {
  addSpanEvent,
  setActiveSpanErrorStatus as setOtelActiveSpanErrorStatus,
  setSpanAttributes,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import { setActiveSpanAttributes as setOtelActiveSpanAttributes } from "#veryfront/observability";
import { convertToTextGenerationRuntimeRequestMessages } from "./text-generation-runtime-message-converter.ts";
import {
  attachProviderMetadata,
  isProviderReplayDelivered,
  markProviderReplayDelivered,
  readAttachedProviderMetadata,
} from "./provider-metadata.ts";
import { convertToolsToRuntimeTools } from "./model-tool-converter.ts";
import {
  bindRuntimeRemoteToolSourcesToCredentialOwner,
  constrainRuntimeRemoteToolSources,
  getRuntimeRemoteToolSources,
} from "./mcp-server-tool-sources.ts";
import { runWithRuntimeRemoteToolSources } from "./remote-tool-source-context.ts";

import {
  announceStreamedToolCallInput,
  createStreamState,
  processStream,
  type StreamingToolCall,
  type StreamingToolResult,
} from "./chat-stream-handler.ts";
import { repairToolCall } from "./repair-tool-call.ts";
import { MiddlewareChain } from "../middleware/chain.ts";
import {
  getTurnInputValidator,
  getTurnMessageProjectionValidator,
  getTurnMessageValidator,
  getTurnProviderRequestValidator,
  markStatefulTurn,
  type TurnProviderRequestValidator,
} from "#veryfront/agent/middleware/turn-validation.ts";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import {
  getModelRuntimeId,
  getModelRuntimeProvider,
  isLocalModelRuntime,
  supportsModelRuntimeToolCalling,
} from "#veryfront/provider/runtime-inspection.ts";
import { generateText, streamText } from "#veryfront/runtime/runtime-bridge.ts";
import { resolveAgentSystem } from "./effective-agent-system.ts";
import {
  attachOutputSchemaParser,
  resolveAgentOutputSchema,
  type ResolvedAgentOutputSchema,
} from "../output-schema.ts";
import {
  captureStreamedToolCallInput,
  collectFinalStreamToolResults,
  collectGeneratedToolResults,
  createToolErrorMessage,
  createToolResultMessage,
  getProviderExecutedToolNames,
  getToolResultError,
  hasSubstantiveAssistantText,
  isInterruptedClientToolCall,
  isRecoverablePlaceholderToolCall,
  isStreamedToolCallIncomplete,
  materializeStreamedToolCall,
  shouldContinueAfterStreamStep,
} from "./tool-result-continuation.ts";

import {
  enforceSkillPolicy,
  FORM_INPUT_TOOL_ID,
  LOAD_SKILL_TOOL_ID,
  SUBMITTED_FORM_INPUT_CONTEXT_KEY,
} from "./skill-policy-enforcement.ts";
import { AgentLoopSkillState } from "./agent-loop-skill-state.ts";
import {
  isRuntimeGeneratedUserMessage,
  markRuntimeGeneratedUserMessage,
} from "./runtime-message-origin.ts";
import {
  getRuntimeAllowedRemoteTools,
  getRuntimeForwardedIntegrationToolDefs,
  getRuntimeProviderReplayCheckpointMessageId,
  getRuntimeProviderReplayCheckpointPersister,
  getRuntimeProviderReplayCheckpoints,
  getRuntimeProviderReplayCheckpointTurnComplete,
  getRuntimeProviderReplayCheckpointTurnFailed,
  getRuntimeProviderTools,
  getRuntimeSourceIntegrationPolicy,
  getRuntimeToolExposureCheckpoint,
  getRuntimeToolExposureCheckpointPersister,
  isRuntimeProviderReplayCheckpointPersistenceRequired,
  isRuntimeToolExposureCheckpointPersistenceRequired,
  resolveRuntimeToolLoading,
  type RuntimeToolFilterConfig,
} from "./runtime-tool-config.ts";

const IntrinsicArrayFilter = Array.prototype.filter;
const IntrinsicArraySome = Array.prototype.some;
const IntrinsicSet = Set;
const IntrinsicSetAdd = Set.prototype.add;
const IntrinsicSetHas = Set.prototype.has;

function intrinsicArraySome<T>(values: readonly T[], predicate: (value: T) => unknown): boolean {
  return IntrinsicReflectApply(IntrinsicArraySome, values, [predicate]) as boolean;
}

function collectVisibleToolNames(tools: readonly { name: string }[]): Set<string> {
  const names = new IntrinsicSet<string>();
  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index];
    if (tool !== undefined) IntrinsicReflectApply(IntrinsicSetAdd, names, [tool.name]);
  }
  return names;
}

function filterVisibleProviderTools(
  providerTools: readonly string[],
  visibleToolNames: ReadonlySet<string>,
): string[] {
  return IntrinsicReflectApply(IntrinsicArrayFilter, providerTools, [
    (toolName: string) =>
      IntrinsicReflectApply(IntrinsicSetHas, visibleToolNames, [toolName]) as boolean,
  ]) as string[];
}
import {
  applyProviderReplayCheckpointsToMessages,
  captureProviderReplayCheckpoint,
  createProviderReplayCheckpointEmissionState,
  type ProviderReplayCheckpoint,
  type ProviderReplayCheckpointEmissionState,
  type ProviderReplayProvider,
} from "./provider-replay.ts";
import {
  applySourceIntegrationPolicy,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import { runWithRemoteIntegrationToolDiscoveryScope } from "#veryfront/integrations/remote-tools.ts";
import {
  prepareAgentRuntimeStep,
  withIntegrationToolDiscoveryStatus,
} from "./agent-runtime-step.ts";
import {
  buildStreamedAssistantMessage,
  isPersistedReasoningPart,
} from "./streamed-assistant-message.ts";
import {
  type DeferredToolSummary,
  flattenSystemInstructions,
  hasRuntimeToolInventory,
  withRuntimeToolInventory,
} from "./tool-inventory.ts";
import {
  type AgentRunRuntimeContext,
  captureAgentRunRuntimeContext,
  withAgentRunRuntimeContext,
  withAgentRunRuntimeContextMetadata,
} from "./run-runtime-context.ts";

// Re-export from submodules
export { closeSSEStream, generateMessageId, sendSSE } from "./sse-utils.ts";
export {
  RunAlreadyExistsError,
  RunCancelledError,
  RunNotActiveError,
  RunResumeSessionManager,
  WaitConflictError,
  WaitNotPendingError,
} from "./resume-session.ts";
export type {
  RunResumeSessionManagerOptions,
  RunSessionStatus,
  SubmitResumeValueOutcome,
} from "./resume-session.ts";
export {
  executeConfiguredTool,
  getAvailableTools,
  isDynamicTool,
  parseToolArgs,
  resolveConfiguredTool,
} from "./tool-helpers.ts";
export type { ParsedToolArgs, ToolConfigEntry } from "./tool-helpers.ts";
export {
  getProviderToolProfile,
  type ProviderToolCompatOptions,
  type ProviderToolCompatProvider,
  type ProviderToolProfile,
  sanitizeProviderToolSchema,
  selectProviderCompatibleToolNames,
  selectProviderCompatibleTools,
} from "./provider-tool-compat.ts";
export { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";
export { createStreamState, processStream } from "./chat-stream-handler.ts";
import { resolveStreamLifecycleModeFromEnv } from "./stream-lifecycle-mode.ts";
import { createRuntimeStreamSource } from "./chat-stream-handler.ts";
export type {
  ChatStreamCallbacks,
  ChatStreamState,
  StreamingToolCall,
} from "./chat-stream-handler.ts";
export {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MAX_STREAM_BUFFER_SIZE,
} from "./constants.ts";
export {
  captureStreamedToolCallInput,
  collectFinalStreamToolResults,
  collectGeneratedToolResults,
  collectPersistedToolResults,
  isRecoverablePlaceholderToolCall,
  isStreamedToolCallIncomplete,
  materializeStreamedToolCall,
  shouldContinueAfterStreamStep,
  type StreamedToolCallMaterialization,
} from "./tool-result-continuation.ts";

const NativeError = Error;

function getActiveProviderReplayProvider(
  languageModel: ModelRuntime,
): ProviderReplayProvider | "unsupported" {
  const modelRuntimeId = getModelRuntimeId(languageModel);
  const provider =
    (typeof languageModel.modelProvider === "string" ? languageModel.modelProvider : undefined) ??
      getModelRuntimeProvider(languageModel) ??
      (modelRuntimeId !== undefined
        ? resolveRuntimeGenAiProviderName(modelRuntimeId) ?? modelRuntimeId.split("/")[0]
        : undefined);
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai-responses";
  return "unsupported";
}

function resolveRuntimeGenAiProviderName(modelId: string): string | undefined {
  const normalizedModelId = modelId.startsWith("veryfront-cloud/")
    ? modelId.slice("veryfront-cloud/".length)
    : modelId;
  const provider = normalizedModelId.split("/")[0]?.trim().toLowerCase();

  switch (provider) {
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "google":
    case "google-ai-studio":
      return "gcp.gen_ai";
    case "moonshotai":
      return "moonshotai";
    default:
      return undefined;
  }
}

export { enforceSkillPolicy, type SkillPolicyResult } from "./skill-policy-enforcement.ts";

import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, getModelMaxOutputTokens } from "./constants.ts";
import { closeSSEStream, generateMessageId, sendSSE } from "./sse-utils.ts";
import {
  executeConfiguredTool,
  getAvailableTools,
  isDynamicTool,
  resolveConfiguredTool,
  type ToolConfigEntry,
} from "./tool-helpers.ts";
import {
  accumulateUsage,
  getMaxSteps,
  normalizeInput,
  propagateSyntheticMessageMarks,
  resolveValidatedTurnInput,
} from "./input-utils.ts";
import { resolveModelProviderOptionKey, resolveRuntimeModel } from "./model-resolution.ts";
import type { RuntimeGenerateTextResult, RuntimeGenerateToolResult } from "./runtime-tool-types.ts";
import { stringifyToolError, throwIfAborted } from "./error-utils.ts";
import { telemetryErrorType } from "#veryfront/observability/telemetry-error.ts";
import { resolveTemperatureParameter } from "./model-capabilities.ts";
import { applySkillDelegationOverridesToToolInput } from "./skill-delegation-overrides.ts";
import {
  type AgentModelRuntimeResolver,
  createModelRuntimeResolverAbortGuard,
  createModelRuntimeResolverAbortScope,
  resolveAgentModelTransport,
  type ResolvedModelTransport,
  revokeModelRuntimeResolver,
} from "./model-transport.ts";
import { buildRuntimeUsageTraceAttributes } from "./trace-usage.ts";
import {
  createToolExposureCheckpoint,
  createToolExposureState,
  createToolSearchDefinition,
  searchToolExposure,
  TOOL_SEARCH_TOOL_NAME,
  type ToolExposureCheckpoint,
  type ToolExposurePlan,
  type ToolExposureState,
  type ToolSearchResult,
} from "./tool-exposure.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const ArrayIsArray = Array.isArray;
const cloneStructuredValue = globalThis.structuredClone;
const IntrinsicWeakMap = WeakMap;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicStructuredClone = globalThis.structuredClone;
const IntrinsicReadableStream = ReadableStream;
const PromiseThen = Promise.prototype.then;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectIs = Object.is;
const ObjectKeys = Object.keys;
const ObjectPrototype = Object.prototype;
const ReflectOwnKeys = Reflect.ownKeys;
const WeakMapGet = IntrinsicWeakMap.prototype.get;
const WeakMapSet = IntrinsicWeakMap.prototype.set;
const IntrinsicURL = URL;
const URLHrefGetter = ObjectGetOwnPropertyDescriptor(URL.prototype, "href")?.get;
const logger = serverLogger.component("agent");
const EVAL_RETAINED_SKILL_LOADER_TOOL_IDS = ["load_skill", "load_skill_reference"] as const;

function cloneStructuredValuePreservingOpaque<T>(value: T, allowOpaqueObjects = false): T {
  class UnsafeInputCopyError extends TypeError {}
  const seen = new IntrinsicWeakMap<object, unknown>();
  const clone = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate !== "object") {
      try {
        return IntrinsicStructuredClone(candidate);
      } catch {
        return candidate;
      }
    }
    if (URLHrefGetter) {
      try {
        return new IntrinsicURL(IntrinsicReflectApply(URLHrefGetter, candidate, []));
      } catch {
        // The native URL getter rejects every non-URL object without invoking
        // caller hooks, so ordinary values continue through recursive clone.
      }
    }
    const existing = IntrinsicReflectApply(WeakMapGet, seen, [candidate]);
    if (existing !== undefined) return existing;
    let isArray: boolean;
    try {
      isArray = ArrayIsArray(candidate);
    } catch {
      if (allowOpaqueObjects) return candidate;
      throw new UnsafeInputCopyError("Object input cannot be safely copied");
    }
    if (isArray) {
      const candidateArray = candidate as unknown[];
      const array: unknown[] = [];
      IntrinsicReflectApply(WeakMapSet, seen, [candidate, array]);
      try {
        const length = candidateArray.length;
        for (let index = 0; index < length; index++) {
          array[index] = clone(candidateArray[index]);
        }
      } catch (error) {
        if (error instanceof UnsafeInputCopyError) throw error;
        try {
          // Read array descriptors without invoking a Proxy's indexed get
          // traps. Provider-visible values must not retain the caller's array.
          const descriptors = ObjectGetOwnPropertyDescriptors(candidate);
          const length = descriptors.length?.value;
          if (typeof length !== "number") throw new TypeError("Invalid array length");
          array.length = 0;
          array.length = length;
          for (let index = 0; index < length; index++) {
            const descriptor = ObjectHasOwn(descriptors, index) ? descriptors[index] : undefined;
            array[index] = descriptor
              ? clone(
                "value" in descriptor
                  ? descriptor.value
                  : descriptor.get
                  ? IntrinsicReflectApply(descriptor.get, candidate, [])
                  : undefined,
              )
              : undefined;
          }
        } catch (error) {
          if (error instanceof UnsafeInputCopyError) throw error;
          if (!allowOpaqueObjects) {
            throw new UnsafeInputCopyError("Array input cannot be safely copied");
          }
          IntrinsicReflectApply(WeakMapSet, seen, [candidate, candidate]);
          return candidate;
        }
      }
      return array;
    }
    let prototype: object | null;
    let descriptors: PropertyDescriptorMap;
    try {
      try {
        prototype = ObjectGetPrototypeOf(candidate);
      } catch {
        prototype = ObjectPrototype;
      }
      if (prototype !== ObjectPrototype && prototype !== null) {
        try {
          const serialize = (candidate as { toJSON?: unknown }).toJSON;
          if (typeof serialize === "function") {
            IntrinsicReflectApply(WeakMapSet, seen, [candidate, candidate]);
            const serialized = IntrinsicReflectApply(serialize, candidate, []);
            if (serialized !== candidate) {
              const detached = clone(serialized);
              IntrinsicReflectApply(WeakMapSet, seen, [candidate, detached]);
              return detached;
            }
          }
          const detached = IntrinsicStructuredClone(candidate);
          IntrinsicReflectApply(WeakMapSet, seen, [candidate, detached]);
          return detached;
        } catch (error) {
          if (error instanceof UnsafeInputCopyError) throw error;
          // A nested Proxy can report a native prototype while exposing an
          // ordinary record. Detach its readable fields instead of keeping a
          // caller-owned reference after native cloning rejects it.
          prototype = ObjectPrototype;
        }
      }
      descriptors = ObjectGetOwnPropertyDescriptors(candidate);
    } catch (error) {
      if (error instanceof UnsafeInputCopyError) throw error;
      if (!allowOpaqueObjects) {
        throw new UnsafeInputCopyError("Object input cannot be safely copied");
      }
      return candidate;
    }
    const object = ObjectCreate(prototype) as Record<PropertyKey, unknown>;
    IntrinsicReflectApply(WeakMapSet, seen, [candidate, object]);
    for (const key of ReflectOwnKeys(descriptors)) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (!descriptor?.enumerable) continue;
      let detachedValue: unknown;
      try {
        detachedValue = "value" in descriptor
          ? clone(descriptor.value)
          : descriptor.get
          ? clone(IntrinsicReflectApply(descriptor.get, candidate, []))
          : undefined;
        ObjectDefineProperty(object, key, {
          value: detachedValue,
          enumerable: descriptor.enumerable,
          configurable: true,
          writable: true,
        });
      } catch (error) {
        if (error instanceof UnsafeInputCopyError) throw error;
        continue;
      }
    }
    return object;
  };
  return clone(value) as T;
}

const PROVIDER_VISIBLE_MESSAGE_PART_FIELDS = [
  "type",
  "text",
  "signature",
  "redactedData",
  "toolCallId",
  "tool_call_id",
  "id",
  "toolName",
  "tool_name",
  "name",
  "args",
  "input",
  "inputText",
  "providerExecuted",
  "supportsDeferredResults",
  "result",
  "output",
  "sourceId",
  "url",
  "title",
  "mediaType",
  "filename",
  "uploadId",
  "upload_id",
  "uploadPath",
  "upload_path",
] as const;

function cloneKnownMessagePartFields(part: MessagePart): MessagePart {
  const detached = ObjectCreate(ObjectPrototype) as Record<string, unknown>;
  const source = part as Record<string, unknown>;
  for (const key of PROVIDER_VISIBLE_MESSAGE_PART_FIELDS) {
    let value: unknown;
    try {
      value = source[key];
    } catch {
      continue;
    }
    if (value === undefined) continue;
    ObjectDefineProperty(detached, key, {
      value: cloneStructuredValuePreservingOpaque(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return detached as MessagePart;
}

function cloneMessagePartForCommit(part: MessagePart): MessagePart {
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = ObjectGetOwnPropertyDescriptors(part);
  } catch {
    // A structurally valid Proxy can expose the fields consumed by provider
    // conversion while refusing descriptor enumeration. Detach those known
    // fields individually so persistence does not introduce a new failure.
    return cloneKnownMessagePartFields(part);
  }
  const detached = ObjectCreate(ObjectPrototype) as Record<string, unknown>;
  for (const key of ObjectKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    let value: unknown;
    try {
      value = "value" in descriptor
        ? descriptor.value
        : descriptor.get
        ? IntrinsicReflectApply(descriptor.get, part, [])
        : undefined;
    } catch {
      // Provider conversion ignores unrelated extension accessors. Preserve
      // valid structural fields when one of those accessors cannot be read.
      continue;
    }
    ObjectDefineProperty(detached, key, {
      value: cloneStructuredValuePreservingOpaque(
        value,
        !(PROVIDER_VISIBLE_MESSAGE_PART_FIELDS as readonly string[]).includes(key),
      ),
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true,
    });
  }
  const source = part as Record<string, unknown>;
  for (const key of PROVIDER_VISIBLE_MESSAGE_PART_FIELDS) {
    if (ObjectHasOwn(descriptors, key)) continue;
    let value: unknown;
    try {
      value = source[key];
    } catch {
      continue;
    }
    if (value === undefined) continue;
    ObjectDefineProperty(detached, key, {
      value: cloneStructuredValuePreservingOpaque(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return detached as MessagePart;
}

function cloneMessageForCommit(message: Message): Message {
  const parts: MessagePart[] = [];
  for (let index = 0; index < message.parts.length; index++) {
    const part = message.parts[index];
    if (part !== undefined) parts[parts.length] = cloneMessagePartForCommit(part);
  }
  return {
    id: message.id,
    role: message.role,
    parts,
    ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
    ...(message.metadata === undefined
      ? {}
      : { metadata: cloneStructuredValuePreservingOpaque(message.metadata, true) }),
  };
}

function providerValuesEqual(
  left: unknown,
  right: unknown,
  seen: WeakMap<object, object>,
): boolean {
  if (ObjectIs(left, right)) return true;
  if (
    left === null || right === null ||
    typeof left !== "object" || typeof right !== "object"
  ) return false;

  const knownRight = IntrinsicReflectApply(WeakMapGet, seen, [left]);
  if (knownRight !== undefined) return knownRight === right;
  IntrinsicReflectApply(WeakMapSet, seen, [left, right]);

  const leftIsArray = ArrayIsArray(left);
  if (leftIsArray !== ArrayIsArray(right)) return false;
  if (leftIsArray) {
    const leftArray = left as unknown[];
    const rightArray = right as unknown[];
    if (leftArray.length !== rightArray.length) return false;
    for (let index = 0; index < leftArray.length; index++) {
      if (!providerValuesEqual(leftArray[index], rightArray[index], seen)) return false;
    }
    return true;
  }

  const leftPrototype = ObjectGetPrototypeOf(left);
  const rightPrototype = ObjectGetPrototypeOf(right);
  if (
    leftPrototype !== rightPrototype ||
    leftPrototype !== ObjectPrototype && leftPrototype !== null
  ) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = ObjectKeys(leftRecord);
  const rightKeys = ObjectKeys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index++) {
    const key = leftKeys[index]!;
    if (
      !ObjectHasOwn(rightRecord, key) ||
      !providerValuesEqual(leftRecord[key], rightRecord[key], seen)
    ) return false;
  }
  return true;
}

function providerMessagesEqual(left: Message, right: Message): boolean {
  return left.role === right.role &&
    providerValuesEqual(left.parts, right.parts, new IntrinsicWeakMap()) &&
    providerValuesEqual(
      readAttachedProviderMetadata(left),
      readAttachedProviderMetadata(right),
      new IntrinsicWeakMap(),
    ) && isProviderReplayDelivered(left) === isProviderReplayDelivered(right);
}

function providerTranscriptsEqual(left: readonly Message[], right: readonly Message[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const leftMessage = left[index]!;
    const rightMessage = right[index]!;
    if (!providerMessagesEqual(leftMessage, rightMessage)) return false;
  }
  return true;
}

function providerTranscriptIsOrderedSubset(
  subset: readonly Message[],
  full: readonly Message[],
): boolean {
  let fullIndex = 0;
  for (let subsetIndex = 0; subsetIndex < subset.length; subsetIndex++) {
    const candidate = subset[subsetIndex]!;
    let matched = false;
    while (fullIndex < full.length) {
      const current = full[fullIndex++]!;
      if (providerMessagesEqual(candidate, current)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function getStructuredCloneFailureFingerprint(error: unknown): string | undefined {
  if (!(error instanceof DOMException) || error.name !== "DataCloneError") {
    return undefined;
  }
  return `${error.name}\u0000${error.message}`;
}

function captureOpaqueProxyCloneFailureFingerprints(): readonly string[] {
  const revokedArrayProxy = Proxy.revocable([], {});
  revokedArrayProxy.revoke();
  const probes = [
    new Proxy({}, {}),
    new Proxy([], {}),
    new Proxy(ObjectCreate(null), {}),
    revokedArrayProxy.proxy,
  ];
  const fingerprints: string[] = [];
  for (const probe of probes) {
    try {
      cloneStructuredValue(probe);
    } catch (error) {
      const fingerprint = getStructuredCloneFailureFingerprint(error);
      if (fingerprint !== undefined && !fingerprints.includes(fingerprint)) {
        fingerprints.push(fingerprint);
      }
    }
  }
  return fingerprints;
}

const OPAQUE_PROXY_CLONE_FAILURE_FINGERPRINTS = captureOpaqueProxyCloneFailureFingerprints();

function isOpaqueProxyCloneFailure(error: unknown): boolean {
  const fingerprint = getStructuredCloneFailureFingerprint(error);
  return fingerprint !== undefined &&
    OPAQUE_PROXY_CLONE_FAILURE_FINGERPRINTS.includes(fingerprint);
}

type RuntimeStateCloneFallback =
  | "root"
  | "message"
  | "provider-options"
  | "provider-bucket"
  | "cache-control"
  | "provider-metadata"
  | "opaque";

function isArrayWithoutThrowing(value: object): boolean {
  try {
    return ArrayIsArray(value);
  } catch {
    return false;
  }
}

function shouldRecoverOpaqueProxyContainer(
  value: object,
  fallback: RuntimeStateCloneFallback,
): boolean {
  return fallback === "root"
    ? isArrayWithoutThrowing(value)
    : fallback !== "opaque" && fallback !== "provider-metadata";
}

function getChildRuntimeStateCloneFallback(
  fallback: RuntimeStateCloneFallback,
  parentIsArray: boolean,
  key: PropertyKey,
  providerOptionKey: string | undefined,
): RuntimeStateCloneFallback {
  if (fallback === "root" && parentIsArray) {
    return "message";
  }
  if (fallback === "message" && key === "providerOptions") {
    return "provider-options";
  }
  if (
    fallback === "provider-options" &&
    (key === "anthropic" || key === "veryfront-cloud" || key === providerOptionKey)
  ) {
    return "provider-bucket";
  }
  if (fallback === "provider-bucket") {
    return key === "cacheControl" ? "cache-control" : "provider-metadata";
  }
  if (fallback === "cache-control") {
    return "provider-metadata";
  }
  return "opaque";
}

function isOrdinaryRecordPrototype(prototype: object | null): boolean {
  if (prototype === null || prototype === ObjectPrototype) {
    return true;
  }
  if (isProxyWithoutHooks(prototype)) {
    return false;
  }
  try {
    return ObjectGetPrototypeOf(prototype) === null;
  } catch {
    return false;
  }
}

function cloneRuntimeStateMutableValue(
  value: unknown,
  clones: WeakMap<object, unknown>,
  proxyDetectionAvailable: boolean,
  fallback: RuntimeStateCloneFallback,
  providerOptionKey: string | undefined,
): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (proxyDetectionAvailable && isProxyWithoutHooks(value)) {
    return value;
  }

  const existing = clones.get(value);
  if (existing !== undefined) {
    return existing;
  }

  const inspectFrameworkContainer = shouldRecoverOpaqueProxyContainer(value, fallback);
  if (!proxyDetectionAvailable && fallback === "provider-metadata") {
    // Without host-level Proxy branding, unknown provider metadata cannot be
    // reflected over safely. Keep it opaque instead of structured-cloning it,
    // which would evaluate enumerable accessors. Known cacheControl metadata
    // still follows the descriptor-first framework-container path.
    return value;
  }
  if (!proxyDetectionAvailable && !inspectFrameworkContainer) {
    try {
      const clone = cloneStructuredValue(value);
      clones.set(value, clone);
      return clone;
    } catch (error) {
      // Proxy branding is unavailable on browser and edge hosts. Compare the
      // failure with trusted, host-local Proxy failures before reflecting over
      // the value. Unlike matching engine-specific text, this remains valid
      // across engines and localized exception messages. Framework-owned
      // structured-system containers are copied from descriptors before this
      // branch so metadata accessors stay inert. Unknown values still fail
      // closed without reflective Proxy probes.
      if (isOpaqueProxyCloneFailure(error)) {
        return value;
      }
      if (getStructuredCloneFailureFingerprint(error) === undefined) {
        return value;
      }
    }
  }

  const isArray = isArrayWithoutThrowing(value);
  let prototype: object | null;
  try {
    prototype = ObjectGetPrototypeOf(value);
  } catch {
    return value;
  }
  if (!isArray && !isOrdinaryRecordPrototype(prototype)) {
    return value;
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = ObjectGetOwnPropertyDescriptors(value);
  } catch {
    return value;
  }

  const clone = isArray ? [] : ObjectCreate(prototype === null ? null : ObjectPrototype);
  clones.set(value, clone);
  const lengthDescriptor = isArray ? descriptors.length : undefined;
  for (const key of ReflectOwnKeys(descriptors)) {
    if (isArray && key === "length") {
      continue;
    }
    const descriptor = descriptors[key as keyof PropertyDescriptorMap];
    if (!descriptor) {
      continue;
    }
    if ("value" in descriptor) {
      descriptor.value = cloneRuntimeStateMutableValue(
        descriptor.value,
        clones,
        proxyDetectionAvailable,
        getChildRuntimeStateCloneFallback(fallback, isArray, key, providerOptionKey),
        providerOptionKey,
      );
    }
    ObjectDefineProperty(clone, key, descriptor);
  }
  if (lengthDescriptor) {
    ObjectDefineProperty(clone, "length", lengthDescriptor);
  }
  return clone;
}

export function cloneRuntimeStateMutableData<T>(
  value: T,
  proxyDetectionAvailable = canIdentifyProxyWithoutHooks,
  providerOptionKey?: string,
): T {
  return cloneRuntimeStateMutableValue(
    value,
    new IntrinsicWeakMap<object, unknown>(),
    proxyDetectionAvailable,
    "root",
    providerOptionKey,
  ) as T;
}

type DeferredRecoveryOutput =
  | { kind: "sse"; chunk: Uint8Array; isTextEvent: boolean }
  | { kind: "callback"; chunk: string };

function isTextSseChunk(chunk: Uint8Array): boolean {
  const payload = new TextDecoder().decode(chunk);
  if (!payload.startsWith("data: ")) {
    return false;
  }

  try {
    const event = JSON.parse(payload.slice("data: ".length)) as { type?: unknown };
    return event.type === "text-start" || event.type === "text-delta" ||
      event.type === "text-end";
  } catch {
    return false;
  }
}

function isTextEndSseChunk(chunk: Uint8Array): boolean {
  const payload = new TextDecoder().decode(chunk);
  if (!payload.startsWith("data: ")) {
    return false;
  }

  try {
    const event = JSON.parse(payload.slice("data: ".length)) as { type?: unknown };
    return event.type === "text-end";
  } catch {
    return false;
  }
}

function textDeltaFromSseChunk(chunk: Uint8Array): string | undefined {
  const payload = new TextDecoder().decode(chunk);
  if (!payload.startsWith("data: ")) {
    return undefined;
  }

  try {
    const event = JSON.parse(payload.slice("data: ".length)) as Record<string, unknown>;
    return event.type === "text-delta" && typeof event.delta === "string" ? event.delta : undefined;
  } catch {
    return undefined;
  }
}

function stripLeadingText(
  text: string,
  remainingPrefixLength: number,
): { text: string; remainingPrefixLength: number } {
  const consumedLength = Math.min(text.length, remainingPrefixLength);
  return {
    text: text.slice(consumedLength),
    remainingPrefixLength: remainingPrefixLength - consumedLength,
  };
}

function stripTextDeltaPrefixFromSseChunk(
  chunk: Uint8Array,
  remainingPrefixLength: number,
  encoder: TextEncoder,
): { chunk: Uint8Array | undefined; remainingPrefixLength: number } {
  const payload = new TextDecoder().decode(chunk);
  if (!payload.startsWith("data: ")) {
    return { chunk, remainingPrefixLength };
  }

  try {
    const event = JSON.parse(payload.slice("data: ".length)) as Record<string, unknown>;
    if (event.type !== "text-delta" || typeof event.delta !== "string") {
      return { chunk, remainingPrefixLength };
    }
    const stripped = stripLeadingText(event.delta, remainingPrefixLength);
    if (stripped.text.length === 0) {
      return { chunk: undefined, remainingPrefixLength: stripped.remainingPrefixLength };
    }
    return {
      chunk: encoder.encode(`data: ${JSON.stringify({ ...event, delta: stripped.text })}\n\n`),
      remainingPrefixLength: stripped.remainingPrefixLength,
    };
  } catch {
    return { chunk, remainingPrefixLength };
  }
}

function rewriteRecoveryTextSseChunkId(
  chunk: Uint8Array,
  fallbackId: string,
  encoder: TextEncoder,
): Uint8Array {
  const payload = new TextDecoder().decode(chunk);
  if (!payload.startsWith("data: ")) {
    return chunk;
  }

  try {
    const event = JSON.parse(payload.slice("data: ".length)) as Record<string, unknown>;
    if (
      event.type !== "text-start" && event.type !== "text-delta" &&
      event.type !== "text-end"
    ) {
      return chunk;
    }
    const id = typeof event.id === "string" && event.id.length > 0
      ? `${event.id}:recovery`
      : fallbackId;
    return encoder.encode(`data: ${JSON.stringify({ ...event, id })}\n\n`);
  } catch {
    return chunk;
  }
}

function buildGeneratedAssistantMessage(
  response: RuntimeGenerateTextResult,
  metadata: { id: string; timestamp: number },
): Message {
  const parts: MessagePart[] = [];
  if (response.text) parts.push({ type: "text", text: response.text });
  for (const toolCall of response.toolCalls ?? []) {
    parts.push({
      type: `tool-${toolCall.toolName}`,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: toolCall.input as Record<string, unknown>,
    });
  }
  return attachProviderMetadata({
    ...metadata,
    role: "assistant",
    parts,
  }, response.providerMetadata);
}

function executeFrameworkToolSearch(input: {
  args: Record<string, unknown>;
  plan: ToolExposurePlan;
  state: ToolExposureState;
}): {
  result: ReturnType<typeof searchToolExposure> & { nextStep: string };
  checkpoint: ReturnType<typeof createToolExposureCheckpoint>;
} {
  const query = typeof input.args.query === "string" ? input.args.query.trim() : "";
  if (!query) {
    throw new Error('tool_search requires a non-empty "query" string');
  }
  const result: ToolSearchResult = searchToolExposure({
    query,
    authorized: input.plan.deferred,
    available: input.plan.visible.filter((tool) => tool.name !== TOOL_SEARCH_TOOL_NAME),
    state: input.state,
    maxLoadedTools: input.plan.maxLoadedTools,
  });
  const alreadyVisible = result.matches.find((match) => match.status === "available");
  return {
    result: {
      ...result,
      nextStep: alreadyVisible
        ? `The matching tool "${alreadyVisible.name}" is already available. Call it directly.`
        : result.loadedCount > 0
        ? "Continue to the next model step. Loaded tool schemas will be available then."
        : "Continue with the available tools or answer without a tool.",
    },
    checkpoint: createToolExposureCheckpoint(input.plan.authorized, input.state),
  };
}

async function persistToolExposureCheckpointBeforeContinuation(input: {
  checkpoint: ToolExposureCheckpoint;
  persist: ((checkpoint: ToolExposureCheckpoint) => void | Promise<void>) | undefined;
  required: boolean;
}): Promise<void> {
  if (!input.persist) {
    if (input.required) {
      throw new Error("Tool exposure checkpoint persistence is required before continuation");
    }
    return;
  }
  await input.persist(input.checkpoint);
}

type RuntimeProviderReplayCheckpointEmission = {
  state: ProviderReplayCheckpointEmissionState | undefined;
  persist: ((checkpoint: ProviderReplayCheckpoint) => void | Promise<void>) | undefined;
  complete: (() => void | Promise<void>) | undefined;
  fail: (() => void | Promise<void>) | undefined;
  failed: boolean;
  required: boolean;
};

function resolveRuntimeProviderReplayCheckpointEmission(
  config: AgentConfig,
): RuntimeProviderReplayCheckpointEmission {
  const messageId = getRuntimeProviderReplayCheckpointMessageId(config);
  const existingCheckpoint = messageId
    ? getRuntimeProviderReplayCheckpoints(config)?.find((checkpoint) =>
      checkpoint.messageId === messageId
    )
    : undefined;
  return {
    state: messageId
      ? createProviderReplayCheckpointEmissionState({ messageId, existingCheckpoint })
      : undefined,
    persist: getRuntimeProviderReplayCheckpointPersister(config),
    complete: getRuntimeProviderReplayCheckpointTurnComplete(config),
    fail: getRuntimeProviderReplayCheckpointTurnFailed(config),
    failed: false,
    required: isRuntimeProviderReplayCheckpointPersistenceRequired(config),
  };
}

async function failProviderReplayCheckpointTurn(
  emission: RuntimeProviderReplayCheckpointEmission,
): Promise<void> {
  if (emission.failed) return;
  emission.failed = true;
  await emission.fail?.();
}

async function persistProviderReplayCheckpointAfterTurn(input: {
  emission: RuntimeProviderReplayCheckpointEmission;
  providerMetadata: Record<string, unknown> | undefined;
}): Promise<void> {
  try {
    await persistProviderReplayCheckpointAfterTurnUnsafe(input);
  } catch (error) {
    await failProviderReplayCheckpointTurn(input.emission);
    throw error;
  }
}

async function persistProviderReplayCheckpointAfterTurnUnsafe(input: {
  emission: RuntimeProviderReplayCheckpointEmission;
  providerMetadata: Record<string, unknown> | undefined;
}): Promise<void> {
  if (!input.emission.state) {
    if (input.emission.required) {
      throw DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({
        detail: "provider replay checkpoint message identity is required",
      });
    }
    await input.emission.complete?.();
    return;
  }
  const checkpoint = captureProviderReplayCheckpoint(
    input.emission.state,
    input.providerMetadata,
  );
  if (!checkpoint) {
    await input.emission.complete?.();
    return;
  }
  if (!input.emission.persist) {
    if (input.emission.required) {
      throw DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({
        detail: "provider replay checkpoint persistence is required before continuation",
      });
    }
    return;
  }
  await input.emission.persist(checkpoint);
  await input.emission.complete?.();
}

function isToolVisibleForStep(toolName: string, plan: ToolExposurePlan): boolean {
  return intrinsicArraySome(plan.visible, (tool) => tool.name === toolName);
}

function isFrameworkToolSearch(toolName: string, plan: ToolExposurePlan): boolean {
  return toolName === TOOL_SEARCH_TOOL_NAME &&
    isToolVisibleForStep(toolName, plan) &&
    !intrinsicArraySome(plan.authorized, (tool) => tool.name === toolName);
}

function toolNotVisibleError(toolName: string): string {
  return `Tool "${toolName}" is not available in the current model step`;
}

function resolveToolExecutionAuthority(input: {
  toolName: string;
  plan: ToolExposurePlan;
}): { kind: "visible" } | undefined {
  return isToolVisibleForStep(input.toolName, input.plan) ? { kind: "visible" } : undefined;
}

function buildStreamFinishUsage(
  usage: AgentResponse["usage"],
): Record<string, unknown> | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: usage.cachedInputTokens }
      : {}),
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: usage.cacheReadInputTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
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
    ...(usage.providerCostUsd !== undefined ? { providerCostUsd: usage.providerCostUsd } : {}),
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
  };
}

function getResponseFinishReason(response: AgentResponse): string | undefined {
  const finishReason = response.metadata?.finishReason;
  return typeof finishReason === "string" && finishReason.length > 0 ? finishReason : undefined;
}

const AGENT_WRITE_FINAL_RESPONSE_EXCLUDED_TOOL_NAMES = new Set([
  "create_agent",
  "update_agent",
]);

function shouldHideProjectToolAfterAgentWriteSuccess(toolName: string): boolean {
  return AGENT_WRITE_FINAL_RESPONSE_EXCLUDED_TOOL_NAMES.has(toolName);
}

function didReloadProjectAgentWriteTool(result: ToolSearchResult): boolean {
  return result.matches.some((match) =>
    match.status === "loaded" && shouldHideProjectToolAfterAgentWriteSuccess(match.name)
  );
}

function compareToolNames(left: { name: string }, right: { name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function applyAgentWriteFinalResponseGuard(
  plan: ToolExposurePlan,
  options: { reloadable: boolean },
): ToolExposurePlan {
  const keep = (tool: { name: string }) => !shouldHideProjectToolAfterAgentWriteSuccess(tool.name);
  for (const toolName of plan.loadedToolNames) {
    if (shouldHideProjectToolAfterAgentWriteSuccess(toolName)) {
      plan.loadedToolNames.delete(toolName);
    }
  }
  if (options.reloadable) {
    const guardedTools = plan.authorized.filter((tool) => !keep(tool));
    const visible = plan.visible.filter(keep);
    const deferredByName = new Map(
      [...plan.deferred, ...guardedTools].map((tool) => [tool.name, tool]),
    );
    if (
      guardedTools.length > 0 &&
      !visible.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME)
    ) {
      visible.push(createToolSearchDefinition());
    }
    return {
      ...plan,
      visible: visible.sort(compareToolNames),
      deferred: [...deferredByName.values()].sort(compareToolNames),
    };
  }
  return {
    ...plan,
    authorized: plan.authorized.filter(keep),
    visible: plan.visible.filter(keep),
    deferred: plan.deferred.filter(keep),
  };
}

function synchronizeRuntimeToolInventory(
  systemPrompt: AgentSystem,
  runtimeTools: Record<string, unknown> | undefined,
  deferredTools: readonly DeferredToolSummary[] = [],
): AgentSystem {
  if (!hasRuntimeToolInventory(systemPrompt)) {
    return systemPrompt;
  }
  const instructions = withRuntimeToolInventory(
    systemPrompt,
    Object.keys(runtimeTools ?? {}).sort(compareStrings),
    deferredTools,
  );
  return typeof systemPrompt === "string" ? flattenSystemInstructions(instructions) : instructions;
}

function parseToolResultJson(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function containsSubmittedFormInputExecutionResult(result: unknown, depth = 0): boolean {
  const normalized = typeof result === "string" ? parseToolResultJson(result) : result;
  if (!normalized || typeof normalized !== "object" || depth > 3) {
    return false;
  }
  if ((normalized as { submitted?: unknown }).submitted === true) {
    return true;
  }
  return Object.values(normalized).some((value) =>
    containsSubmittedFormInputExecutionResult(value, depth + 1)
  );
}

function isSubmittedFormInputExecutionResult(toolName: string, result: unknown): boolean {
  return toolName === FORM_INPUT_TOOL_ID && containsSubmittedFormInputExecutionResult(result);
}

type RuntimeTraceAttributes = Record<string, string | number | boolean | undefined | null>;

function estimateSerializedSizeBytes(value: unknown): number | undefined {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return new TextEncoder().encode(serialized).length;
  } catch {
    return undefined;
  }
}

function compactRuntimeTraceAttributes(
  attributes: RuntimeTraceAttributes,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ),
  ) as Record<string, string | number | boolean>;
}

function buildRuntimeToolTraceAttributes(input: {
  mode: "generate" | "stream";
  agentId: string;
  toolName: string;
  toolCallId: string;
  context?: ToolExecutionContext;
  status?: "executing" | "completed" | "failed" | "blocked";
  providerExecuted?: boolean;
  inputSizeBytes?: number;
  outputSizeBytes?: number;
  errorType?: string;
}): Record<string, string | number | boolean> {
  return compactRuntimeTraceAttributes({
    "agent.id": input.agentId,
    "run.id": input.context?.runId,
    "project.id": input.context?.projectId,
    "project.slug": input.context?.projectSlug,
    "tool.name": input.toolName,
    "tool.call.id": input.toolCallId,
    "tool.id": input.toolCallId,
    "tool.status": input.status,
    "tool.provider_executed": input.providerExecuted,
    "tool.input.size_bytes": input.inputSizeBytes,
    "tool.output.size_bytes": input.outputSizeBytes,
    "agent.tool.execution_mode": input.mode,
    "agent.tool.status": input.status,
    "agent.tool.provider_executed": input.providerExecuted,
    "agent.tool.input.size_bytes": input.inputSizeBytes,
    "agent.tool.output.size_bytes": input.outputSizeBytes,
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.agent.id": input.agentId,
    "gen_ai.tool.name": input.toolName,
    "gen_ai.tool.type": "function",
    "gen_ai.tool.call.id": input.toolCallId,
    // Deliberately no "error.message". Tool and provider error text is
    // caller-supplied and telemetry leaves the process; "error.type" is the
    // bounded classification, the same trade the workflow retry events make.
    "error.type": input.errorType,
  });
}

async function traceConfiguredToolExecution(input: {
  mode: "generate" | "stream";
  agentId: string;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  toolsConfig: true | Record<string, ToolConfigEntry> | undefined;
  context: ToolExecutionContext;
  allowedRemoteToolNames: string[] | undefined;
  remoteToolSources: ReturnType<typeof getRuntimeRemoteToolSources>;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest | undefined;
  strictConfiguredToolsOnly?: boolean;
}): Promise<unknown> {
  const inputSizeBytes = estimateSerializedSizeBytes(input.args);
  return await withSpan(
    "agent.tool_execute",
    async () => {
      setOtelActiveSpanAttributes(
        buildRuntimeToolTraceAttributes({
          mode: input.mode,
          agentId: input.agentId,
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          context: input.context,
          status: "executing",
          providerExecuted: false,
          inputSizeBytes,
        }),
      );
      try {
        const inheritedRemoteToolSources = bindRuntimeRemoteToolSourcesToCredentialOwner(
          constrainRuntimeRemoteToolSources(
            input.remoteToolSources,
            input.allowedRemoteToolNames,
          ),
          input.context,
        );
        const result = await runWithRuntimeRemoteToolSources(
          inheritedRemoteToolSources,
          () =>
            executeConfiguredTool(
              input.toolName,
              input.args,
              input.toolsConfig,
              input.context,
              input.allowedRemoteToolNames,
              input.remoteToolSources,
              input.sourceIntegrationPolicy,
              { strictConfiguredToolsOnly: input.strictConfiguredToolsOnly },
            ),
        );
        const resultError = getToolResultError(result);
        if (resultError !== undefined) {
          // Identify the tool, not the failure text: `resultError` is a raw
          // string, which reaches the wire unchanged through both the span
          // status and the recorded exception.
          setOtelActiveSpanErrorStatus(new NativeError(`Tool "${input.toolName}" failed`));
        }
        setOtelActiveSpanAttributes(
          buildRuntimeToolTraceAttributes({
            mode: input.mode,
            agentId: input.agentId,
            toolName: input.toolName,
            toolCallId: input.toolCallId,
            context: input.context,
            status: resultError === undefined ? "completed" : "failed",
            providerExecuted: false,
            inputSizeBytes,
            outputSizeBytes: estimateSerializedSizeBytes(result),
            errorType: resultError === undefined ? undefined : "ToolResultError",
          }),
        );
        return result;
      } catch (error) {
        setOtelActiveSpanAttributes({
          ...buildRuntimeToolTraceAttributes({
            mode: input.mode,
            agentId: input.agentId,
            toolName: input.toolName,
            toolCallId: input.toolCallId,
            context: input.context,
            status: "failed",
            providerExecuted: false,
            inputSizeBytes,
            errorType: telemetryErrorType(error),
          }),
        });
        throw error;
      }
    },
    buildRuntimeToolTraceAttributes({
      mode: input.mode,
      agentId: input.agentId,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      context: input.context,
      status: "executing",
      providerExecuted: false,
      inputSizeBytes,
    }),
  );
}

async function traceProviderExecutedTool(input: {
  mode: "generate" | "stream";
  agentId: string;
  toolName: string;
  toolCallId: string;
  context?: ToolExecutionContext;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}): Promise<void> {
  const status = input.isError === true ? "failed" : "completed";
  const hasError = input.isError === true;
  await withSpan(
    "agent.tool_execute",
    async () => {
      if (hasError) {
        setOtelActiveSpanErrorStatus(new NativeError(`Tool "${input.toolName}" failed`));
      }
      setOtelActiveSpanAttributes(
        buildRuntimeToolTraceAttributes({
          ...input,
          status,
          providerExecuted: true,
          inputSizeBytes: estimateSerializedSizeBytes(input.args),
          outputSizeBytes: estimateSerializedSizeBytes(input.result),
          errorType: hasError ? "ProviderExecutedToolError" : undefined,
        }),
      );
    },
    buildRuntimeToolTraceAttributes({
      ...input,
      status,
      providerExecuted: true,
      inputSizeBytes: estimateSerializedSizeBytes(input.args),
      outputSizeBytes: estimateSerializedSizeBytes(input.result),
      errorType: hasError ? "ProviderExecutedToolError" : undefined,
    }),
  );
}

function markSubmittedFormInputRuntimeContext(
  runtimeContext?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(runtimeContext ?? {}),
    [SUBMITTED_FORM_INPUT_CONTEXT_KEY]: true,
  };
}

function isAbortError(error: unknown, abortSignal?: AbortSignal): boolean {
  if (abortSignal?.aborted && error === abortSignal.reason) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

function warnUnsupportedToolCalling(agentId: string, modelId: string): void {
  logger.warn(
    `Agent "${agentId}" has tools configured, but model "${modelId}" does not support ` +
      "tool calling. Tools will be skipped.",
  );
}

function debugRuntimeModelRemap(requestedModel: string, resolvedModelString: string): void {
  if (resolvedModelString === requestedModel) return;

  logger.debug(
    `⚡ Using runtime model "${resolvedModelString}" instead of "${requestedModel}".`,
  );
}

type RuntimeStepState = {
  systemPrompt: AgentSystem;
  context?: Record<string, unknown>;
};

/** @internal Framework-only AgentRuntime construction options. */
export type AgentRuntimeInternalOptions = {
  resolveModelRuntime?: AgentModelRuntimeResolver;
};

type AgentRuntimeGenerateArgs = [
  input: string | Message[],
  context?: Record<string, unknown>,
  modelOverride?: string,
  maxOutputTokensOverride?: number,
  abortSignal?: AbortSignal,
  options?: {
    toolReplacements?: AgentGenerateToolReplacements;
    retainSkillLoaderTools?: boolean;
    outputSchema?: unknown;
  },
];

type AgentRuntimeStreamCallbacks = {
  onToolCall?: (toolCall: ToolCall) => void;
  onChunk?: (chunk: string) => void;
  onFinish?: (response: AgentResponse) => void;
};

type AgentRuntimeStreamArgs = [
  messages: Message[],
  context?: Record<string, unknown>,
  callbacks?: AgentRuntimeStreamCallbacks,
  modelOverride?: string,
  maxOutputTokensOverride?: number,
  abortSignal?: AbortSignal,
  options?: { outputSchema?: unknown },
];

type AgentRuntimeGenerateDispatch = (
  ...args: AgentRuntimeGenerateArgs
) => Promise<AgentResponse>;

type AgentRuntimeStreamDispatch = (
  ...args: AgentRuntimeStreamArgs
) => Promise<ReadableStream<Uint8Array>>;

type AgentRuntimeDispatch = {
  generate: AgentRuntimeGenerateDispatch;
  stream: AgentRuntimeStreamDispatch;
};

type AgentRuntimeModelResolverState =
  | { status: "absent" }
  | { status: "available"; resolver: AgentModelRuntimeResolver }
  | { status: "consumed" };

const agentRuntimeDispatches = new IntrinsicWeakMap<AgentRuntime, AgentRuntimeDispatch>();

function getAgentRuntimeDispatch(runtime: AgentRuntime): AgentRuntimeDispatch {
  const dispatch = IntrinsicReflectApply(WeakMapGet, agentRuntimeDispatches, [
    runtime,
  ]) as AgentRuntimeDispatch | undefined;
  if (!dispatch) {
    throw new TypeError("AgentRuntime framework dispatch is unavailable");
  }
  return dispatch;
}

/** @internal Dispatch through framework-owned runtime capabilities, not mutable prototype methods. */
export function generateWithAgentRuntimeDispatch(
  runtime: AgentRuntime,
  ...args: AgentRuntimeGenerateArgs
): Promise<AgentResponse> {
  return getAgentRuntimeDispatch(runtime).generate(...args);
}

/** @internal Dispatch through framework-owned runtime capabilities, not mutable prototype methods. */
export function streamWithAgentRuntimeDispatch(
  runtime: AgentRuntime,
  ...args: AgentRuntimeStreamArgs
): Promise<ReadableStream<Uint8Array>> {
  return getAgentRuntimeDispatch(runtime).stream(...args);
}

/** Implement agent runtime. */
export class AgentRuntime {
  #modelResolverState: AgentRuntimeModelResolverState;
  private id: string;
  private config: AgentConfig;
  private memory: Memory<Message>;
  private status: AgentStatus = "idle";

  constructor(
    id: string,
    config: AgentConfig,
    internalOptions: AgentRuntimeInternalOptions = {},
  ) {
    this.#modelResolverState = internalOptions.resolveModelRuntime
      ? { status: "available", resolver: internalOptions.resolveModelRuntime }
      : { status: "absent" };
    this.id = id;
    this.config = { ...config };

    // Agents are stateless by default (see docs/guides/memory-and-streaming.md):
    // with no `memory` config, calls never share conversation history, so
    // concurrent stream()/generate() on a shared instance stay isolated.
    // Providing `memory` opts in to cross-call persistence.
    this.memory = createAgentMemory<Message>(config.memory);
    IntrinsicReflectApply(WeakMapSet, agentRuntimeDispatches, [
      this,
      {
        generate: (...args: AgentRuntimeGenerateArgs) => this.#generate(...args),
        stream: (...args: AgentRuntimeStreamArgs) => this.#stream(...args),
      },
    ]);
  }

  /**
   * Persist this turn's input, then resolve the messages to run on. Configured
   * memory returns the full persisted conversation (this turn + history); the
   * stateless default persists nothing and returns empty, so we fall back to
   * this turn's input. That fallback is what keeps concurrent stream()/
   * generate() calls on a shared instance isolated instead of interleaving into
   * one conversation.
   *
   * Before anything is committed, a cross-turn validator registered on the
   * middleware context checks the assembled conversation (history + this
   * turn's input). Per-turn validation cannot see memory, so a blocked phrase
   * split between an earlier turn's trailing system message (left behind when
   * that turn failed or was cancelled before its assistant reply persisted)
   * and this turn's leading system message would otherwise reassemble at the
   * provider unvalidated. Validating before the write keeps a rejected turn
   * out of memory.
   */
  private async restoreInputReplayMetadata(inputMessages: Message[]): Promise<void> {
    const checkpoints = getRuntimeProviderReplayCheckpoints(this.config);
    if (!checkpoints?.length) return;
    const history = (await this.memory.getMessages()).map(cloneMessageForCommit);
    applyProviderReplayCheckpointsToMessages([...history, ...inputMessages], checkpoints);
  }

  private prepareTurnMessages(
    inputMessages: Message[],
    context?: AgentContext,
    abortSignal?: AbortSignal,
  ): Promise<{
    messages: Message[];
    addMessage: (message: Message) => Promise<void>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    finalized: Promise<void>;
  }> {
    // Serialize validate-then-write per runtime: two concurrent turns that
    // both read the same history before either writes could each validate an
    // individually harmless fragment whose interleaved writes become adjacent
    // in the persisted transcript. The queue makes the second turn's
    // validation see the first turn's write. A rejected or failed commit must
    // not poison the queue for later turns, hence the swallowed catch on the
    // stored chain; callers still observe the rejection through the returned
    // promise.
    //
    // Only a turn that actually runs a cross-turn validator is queued. Without
    // one there is nothing to serialize: the write no longer depends on the
    // history read, so a stateless agent (no `memory` config, where
    // `createAgentMemory(undefined)` persists nothing) and every agent without
    // the security middleware keep the pre-existing concurrency, and one slow
    // memory backend cannot hold up unrelated concurrent turns.
    //
    // Keep the queue until the entire turn finalizes: every provider step can
    // reject the caller input, and overlapping rollback snapshots can restore
    // another turn's rejected messages. This serializes validated stateful
    // turns on one runtime instance, including time spent awaiting tools.
    if (
      this.memory instanceof NoMemory || !context ||
      !getTurnMessageValidator(context) && !getTurnProviderRequestValidator(context) &&
        !getTurnMessageProjectionValidator(context)
    ) {
      return this.#commitTurnMessages(inputMessages, context);
    }

    const leaveLineage = enterSerializedTurn(this);
    const predecessor = this.#turnCommitQueue;
    const task = awaitAbortable(predecessor, abortSignal).then(async () => {
      try {
        throwIfAborted(abortSignal);
        const prepared = await this.#commitTurnMessages(inputMessages, context);
        return {
          ...prepared,
          commit: async () => {
            try {
              await prepared.commit();
            } finally {
              leaveLineage();
            }
          },
          rollback: async () => {
            try {
              await prepared.rollback();
            } finally {
              leaveLineage();
            }
          },
        };
      } catch (error) {
        leaveLineage();
        throw error;
      }
    }, (error: unknown) => {
      leaveLineage();
      throw error;
    });
    const finalized = task.then(
      ({ finalized }) => finalized,
      () => undefined,
    );
    // Cancellation releases this caller, not the preceding turn's queue slot.
    // Later turns must still wait until that predecessor has finalized.
    this.#turnCommitQueue = Promise.all([predecessor, finalized]).then(() => undefined);
    return task;
  }

  #turnCommitQueue: Promise<void> = Promise.resolve();

  private createTurnPersistence(
    inputMessages: Message[],
    context: AgentContext,
    abortSignal?: AbortSignal,
  ): {
    persisted: boolean;
    persist: () => Promise<Message[]>;
    addMessage: (message: Message) => Promise<void>;
    commit: () => Promise<void>;
    finalize: () => Promise<void>;
    validationState: () => "pending" | "accepted" | "rejected";
    validateProviderRequest: TurnProviderRequestValidator;
  } {
    if (!(this.memory instanceof NoMemory)) markStatefulTurn(context);
    // Memoized on the first call: persistence now runs inside the middleware
    // continuation, so a middleware that invokes `next()` more than once (a
    // retry or fallback wrapper) would otherwise write this turn's input to
    // memory once per attempt. Every attempt shares the first commit, including
    // its rejection, so a turn that failed validation stays rejected.
    let transaction: ReturnType<AgentRuntime["prepareTurnMessages"]> | undefined;
    let finalization: Promise<void> | undefined;
    let rejection: { error: unknown } | undefined;
    let validationState: "pending" | "accepted" | "rejected" = "pending";
    const commit = async (): Promise<void> => {
      if (rejection) throw rejection.error;
      if (transaction === undefined) return;
      finalization ??= transaction.then(async (prepared) => {
        try {
          await prepared.commit();
        } catch (error) {
          rejection = { error };
          validationState = "rejected";
          throw error;
        }
      });
      await finalization;
    };
    const rollback = async (): Promise<void> => {
      if (transaction === undefined) return;
      if (finalization !== undefined) {
        // The original caller observes commit or rollback errors. Cleanup must
        // still finish so streaming can report that error and close replay state.
        await finalization.catch(() => undefined);
        return;
      }
      finalization = transaction.catch(() => undefined).then((prepared) => prepared?.rollback());
      await finalization;
    };
    const persistence = {
      persisted: false,
      persist: (): Promise<Message[]> => {
        if (rejection) return Promise.reject(rejection.error);
        persistence.persisted = true;
        transaction ??= this.prepareTurnMessages(
          resolveValidatedTurnInput(context.input, inputMessages),
          context,
          abortSignal,
        );
        return transaction.then(({ messages }) => messages);
      },
      commit,
      addMessage: async (message: Message) => {
        if (rejection) throw rejection.error;
        try {
          await persistence.persist();
          await (await transaction!).addMessage(message);
        } catch (error) {
          rejection = { error };
          validationState = "rejected";
          await rollback();
          throw error;
        }
      },
      finalize: () => validationState === "accepted" ? commit() : rollback(),
      validationState: () => validationState,
      validateProviderRequest: async (providerSystem: AgentSystem, messages: Message[]) => {
        if (rejection) throw rejection.error;
        try {
          await getTurnProviderRequestValidator(context)?.(providerSystem, messages);
        } catch (error) {
          rejection = { error };
          validationState = "rejected";
          await rollback();
          throw error;
        }
        validationState = "accepted";
        // Keep validated stateful turns serialized until finalization. An
        // overlapping rollback could otherwise restore another rejected turn.
      },
    };
    return persistence;
  }

  async #commitTurnMessages(
    inputMessages: Message[],
    context?: AgentContext,
  ): Promise<{
    messages: Message[];
    addMessage: (message: Message) => Promise<void>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    finalized: Promise<void>;
  }> {
    const committedInputMessages = inputMessages.map((message) => {
      const cloned = cloneMessageForCommit(message);
      propagateSyntheticMessageMarks(message, cloned);
      return isRuntimeGeneratedUserMessage(message)
        ? markRuntimeGeneratedUserMessage(cloned)
        : cloned;
    });
    // The security middleware validated `context.input` when it ran, but a
    // later middleware can replace the array or mutate a message in place, and
    // the resolved value is exactly what gets persisted and dispatched below.
    // The registered hook re-validates the resolved input (skipping texts the
    // middleware already approved), including on a first turn where the
    // cross-turn validator has no history to check.
    const validateTurnInput = context && getTurnInputValidator(context);
    await this.restoreInputReplayMetadata(committedInputMessages);
    if (validateTurnInput) await validateTurnInput(committedInputMessages);

    const validateTurnMessages = context && getTurnMessageValidator(context);
    const validateProjectedMessages = context && getTurnMessageProjectionValidator(context);
    const validateProviderRequest = context && getTurnProviderRequestValidator(context);
    const memoryTransaction =
      validateTurnMessages || validateProjectedMessages || validateProviderRequest
        ? await beginMemoryTransaction(this.memory)
        : undefined;
    const turnMemory = memoryTransaction ?? this.memory;
    let validated = committedInputMessages;
    let history: Message[] = [];
    let persisted: Message[];
    try {
      if (validateTurnMessages || validateProjectedMessages || validateProviderRequest) {
        history = await turnMemory.getMessages();
        if (history.length > 0) validated = [...history, ...committedInputMessages];
        // Durable provider replay metadata can keep a reasoning-only assistant
        // turn in the actual provider request. Attach it before validation so
        // the validator does not incorrectly merge the user turns around it.
        applyProviderReplayCheckpointsToMessages(
          validated,
          getRuntimeProviderReplayCheckpoints(this.config),
        );
        // With no history the assembled conversation is exactly this turn's
        // input, which the middleware already validated.
        if (validateTurnMessages && history.length > 0) {
          await validateTurnMessages(history, committedInputMessages);
        }
      }
      // Memory adapters may normalize staged objects in place. Keep validation
      // provenance detached from every object the transaction receives, while
      // preserving replay metadata that determines provider message boundaries.
      if (validateTurnMessages || validateProjectedMessages) {
        validated = validated.map((message) => {
          const snapshot = cloneMessageForCommit(message);
          propagateSyntheticMessageMarks(message, snapshot);
          if (isRuntimeGeneratedUserMessage(message)) markRuntimeGeneratedUserMessage(snapshot);
          attachProviderMetadata(
            snapshot,
            cloneStructuredValuePreservingOpaque(readAttachedProviderMetadata(message)),
          );
          if (isProviderReplayDelivered(message)) markProviderReplayDelivered(snapshot);
          return snapshot;
        });
      }
      for (const msg of committedInputMessages) await turnMemory.add(msg);
      persisted = await turnMemory.getMessages();
      if (persisted.length > 0 && !providerTranscriptsEqual(persisted, validated)) {
        if (validateProjectedMessages) {
          await validateProjectedMessages(persisted, validated);
        } else if (!providerTranscriptIsOrderedSubset(persisted, validated)) {
          // A turn-only validator has no projection provenance contract. Keep
          // its historical fail-closed behavior for replacement projections.
          await validateTurnMessages?.([], persisted);
        }
      }
    } catch (error) {
      await memoryTransaction?.rollback();
      throw error;
    }
    let isFinalized = false;
    const finalization = Promise.withResolvers<void>();
    return {
      messages: persisted.length > 0 ? persisted : committedInputMessages,
      addMessage: (message) => turnMemory.add(message),
      commit: async () => {
        if (isFinalized) return;
        isFinalized = true;
        try {
          await memoryTransaction?.commit();
        } catch (error) {
          await memoryTransaction?.rollback();
          throw error;
        } finally {
          finalization.resolve();
        }
      },
      rollback: async () => {
        if (isFinalized) return;
        isFinalized = true;
        try {
          await memoryTransaction?.rollback();
        } finally {
          finalization.resolve();
        }
      },
      finalized: finalization.promise,
    };
  }

  async #resolveModelTransport(
    context: Record<string, unknown> | undefined,
    modelOverride: string | undefined,
    mode: "generate" | "stream",
  ): Promise<{
    transport: ResolvedModelTransport;
    resolveModelRuntime?: AgentModelRuntimeResolver;
  }> {
    const resolverState = this.#modelResolverState;
    if (resolverState.status === "consumed") {
      throw new TypeError("AgentRuntime model resolver has already been consumed");
    }
    const resolveModelRuntime = resolverState.status === "available"
      ? resolverState.resolver
      : undefined;
    if (resolverState.status === "available") {
      this.#modelResolverState = { status: "consumed" };
    }
    try {
      return {
        transport: await resolveAgentModelTransport({
          agentId: this.id,
          config: this.config,
          context,
          modelOverride,
          mode,
          resolveModelRuntime,
        }),
        ...(resolveModelRuntime ? { resolveModelRuntime } : {}),
      };
    } catch (error) {
      revokeModelRuntimeResolver(resolveModelRuntime);
      throw error;
    }
  }

  private async resolveRuntimeState(
    messages: Message[],
    context: Record<string, unknown> | undefined,
    mode: "generate" | "stream",
    step: number,
    systemPrompt: AgentSystem,
    providerOptionKey: string | undefined,
  ): Promise<RuntimeStepState> {
    const structuredSystem = Array.isArray(systemPrompt) ? systemPrompt : undefined;
    const refreshed: ResolvedRuntimeState | undefined = await this.config.resolveRuntimeState?.({
      agentId: this.id,
      mode,
      step,
      system: typeof systemPrompt === "string"
        ? systemPrompt
        : flattenSystemInstructions(systemPrompt),
      ...(structuredSystem === undefined ? {} : {
        structuredSystem: cloneRuntimeStateMutableData(
          structuredSystem,
          canIdentifyProxyWithoutHooks,
          providerOptionKey,
        ),
      }),
      messages: [...messages],
      context,
    });

    return {
      systemPrompt: refreshed?.structuredSystem ?? refreshed?.system ?? systemPrompt,
      context: refreshed?.context ?? context,
    };
  }

  private async notifyToolResult(
    request: Omit<ToolExecutionResultRequest, "agentId">,
  ): Promise<void> {
    await this.config.onToolResult?.({
      agentId: this.id,
      ...request,
    });
  }

  private createGenerateReplacementTools(
    toolReplacements: AgentGenerateToolReplacements | undefined,
    retainSkillLoaderTools: boolean | undefined,
  ): AgentGenerateToolReplacements | undefined {
    if (toolReplacements === undefined) {
      return undefined;
    }
    if (!retainSkillLoaderTools || this.config.skills === false) {
      return toolReplacements;
    }

    const tools: AgentGenerateToolReplacements = { ...toolReplacements };
    for (const toolName of EVAL_RETAINED_SKILL_LOADER_TOOL_IDS) {
      if (tools[toolName]) {
        continue;
      }
      const configuredTool = resolveConfiguredTool(this.config.tools, toolName, {
        agentId: this.id,
      });
      if (configuredTool) {
        tools[toolName] = configuredTool;
      }
    }
    return tools;
  }

  /**
   * Resolve the schema that constrains this request.
   *
   * A per-call schema replaces the configured one; without either, the agent
   * is unconstrained.
   */
  private resolveOutputSchema(override: unknown): ResolvedAgentOutputSchema | undefined {
    return resolveAgentOutputSchema(override ?? this.config.outputSchema, this.id);
  }

  /**
   * Generate a response (non-streaming)
   */
  async generate(
    input: string | Message[],
    context?: Record<string, unknown>,
    modelOverride?: string,
    maxOutputTokensOverride?: number,
    abortSignal?: AbortSignal,
    options?: {
      toolReplacements?: AgentGenerateToolReplacements;
      retainSkillLoaderTools?: boolean;
      outputSchema?: unknown;
    },
  ): Promise<AgentResponse> {
    return this.#generate(
      input,
      context,
      modelOverride,
      maxOutputTokensOverride,
      abortSignal,
      options,
    );
  }

  #generate(...args: AgentRuntimeGenerateArgs): Promise<AgentResponse> {
    return withRuntimeTurnLineage(this, () => this.#generateWithinTurn(...args));
  }

  async #generateWithinTurn(
    input: string | Message[],
    context?: Record<string, unknown>,
    modelOverride?: string,
    maxOutputTokensOverride?: number,
    abortSignal?: AbortSignal,
    options?: {
      toolReplacements?: AgentGenerateToolReplacements;
      retainSkillLoaderTools?: boolean;
      outputSchema?: unknown;
    },
  ): Promise<AgentResponse> {
    const runRuntimeContext = captureAgentRunRuntimeContext();
    if (this.#modelResolverState.status === "absent") throwIfAborted(abortSignal);
    const { transport, resolveModelRuntime } = await this.#resolveModelTransport(
      context,
      modelOverride,
      "generate",
    );
    const abortGuard = createModelRuntimeResolverAbortGuard(resolveModelRuntime, abortSignal);
    try {
      throwIfAborted(abortSignal);
      const outputSchema = this.resolveOutputSchema(options?.outputSchema);
      const requestedModel = transport.requestedModel;
      const resolvedModelString = transport.resolvedModelString;
      const supportsToolCalling = supportsModelRuntimeToolCalling(transport.languageModel);
      const providerReplayCheckpointEmission = resolveRuntimeProviderReplayCheckpointEmission(
        this.config,
      );
      debugRuntimeModelRemap(requestedModel, resolvedModelString);

      return await withSpan("agent.generate", async (span) => {
        setSpanAttributes(span, {
          "agent.id": this.id,
          "agent.model": resolvedModelString,
          "run.started_at_utc": runRuntimeContext.runStartedAtUtc,
          "run.current_date_utc": runRuntimeContext.currentDateUtc,
        });

        const inputMessages = normalizeInput(input);
        await this.restoreInputReplayMetadata(inputMessages);

        const systemPrompt = await this.resolveSystemPrompt(transport.providerOptionKey);

        const agentContext: AgentContext = {
          agentId: this.id,
          model: resolvedModelString,
          input: inputMessages,
          data: context,
          platform: detectPlatform(),
        };

        // Persist only after the middleware chain accepted this turn. Committing
        // to memory first would store a rejected (hostile) message, and the next
        // benign turn would replay it to the provider without ever being
        // validated again. A middleware that answers without calling `next()`
        // (a cache hit) still accepted the turn, so persistence runs after the
        // chain resolves when the continuation never reached it.
        const turnPersistence = this.createTurnPersistence(
          inputMessages,
          agentContext,
          abortSignal,
        );

        const chain = new MiddlewareChain(this.config.middleware);
        let response: AgentResponse;
        try {
          response = await chain.execute(
            agentContext,
            async () => {
              const messages = await turnPersistence.persist();
              try {
                return await runWithRemoteIntegrationToolDiscoveryScope(() =>
                  this.#executeAgentLoop(
                    systemPrompt,
                    messages,
                    turnPersistence.validateProviderRequest,
                    turnPersistence.addMessage,
                    {
                      agentId: this.id,
                      projectId: tryGetCacheKeyContext()?.projectId,
                    },
                    context,
                    runRuntimeContext,
                    supportsToolCalling,
                    providerReplayCheckpointEmission,
                    resolvedModelString,
                    transport.languageModel,
                    transport.headers,
                    transport.providerOptions,
                    transport.reasoning,
                    maxOutputTokensOverride,
                    requestedModel,
                    this.createGenerateReplacementTools(
                      options?.toolReplacements,
                      options?.retainSkillLoaderTools,
                    ),
                    abortSignal,
                    outputSchema,
                  )
                );
              } finally {
                abortGuard.revoke();
              }
            },
          );
        } catch (error) {
          await turnPersistence.finalize();
          throw error;
        }

        const messages = await turnPersistence.persist();
        if (turnPersistence.validationState() === "pending") {
          await turnPersistence.validateProviderRequest(
            withAgentRunRuntimeContext(systemPrompt, runRuntimeContext),
            messages,
          );
        }
        await turnPersistence.commit();
        return response;
      }).catch(async (error) => {
        await failProviderReplayCheckpointTurn(providerReplayCheckpointEmission);
        throw error;
      });
    } finally {
      abortGuard.dispose();
    }
  }

  /**
   * Stream a response
   * Returns a ReadableStream in the veryfront stream event format.
   */
  async stream(
    messages: Message[],
    context?: Record<string, unknown>,
    callbacks?: AgentRuntimeStreamCallbacks,
    modelOverride?: string,
    maxOutputTokensOverride?: number,
    abortSignal?: AbortSignal,
    options?: { outputSchema?: unknown },
  ): Promise<ReadableStream<Uint8Array>> {
    return this.#stream(
      messages,
      context,
      callbacks,
      modelOverride,
      maxOutputTokensOverride,
      abortSignal,
      options,
    );
  }

  #stream(...args: AgentRuntimeStreamArgs): Promise<ReadableStream<Uint8Array>> {
    return withRuntimeTurnLineage(this, () => this.#streamWithinTurn(...args));
  }

  async #streamWithinTurn(
    messages: Message[],
    context?: Record<string, unknown>,
    callbacks?: AgentRuntimeStreamCallbacks,
    modelOverride?: string,
    maxOutputTokensOverride?: number,
    abortSignal?: AbortSignal,
    options?: { outputSchema?: unknown },
  ): Promise<ReadableStream<Uint8Array>> {
    const runRuntimeContext = captureAgentRunRuntimeContext();
    setOtelActiveSpanAttributes({
      "run.started_at_utc": runRuntimeContext.runStartedAtUtc,
      "run.current_date_utc": runRuntimeContext.currentDateUtc,
    });
    if (this.#modelResolverState.status === "absent") throwIfAborted(abortSignal);
    const { transport, resolveModelRuntime } = await this.#resolveModelTransport(
      context,
      modelOverride,
      "stream",
    );
    const abortScope = createModelRuntimeResolverAbortScope(resolveModelRuntime, abortSignal);
    try {
      const outputSchema = this.resolveOutputSchema(options?.outputSchema);
      const requestedModel = transport.requestedModel;
      const resolvedModelString = transport.resolvedModelString;
      debugRuntimeModelRemap(requestedModel, resolvedModelString);

      const inputMessages = normalizeInput(messages);

      const systemPrompt = await this.resolveSystemPrompt(transport.providerOptionKey);

      const encoder = new TextEncoder();
      const streamAbortSignal = abortScope.signal;
      const streamCacheCtx = tryGetCacheKeyContext();
      const toolContext = {
        agentId: this.id,
        abortSignal: streamAbortSignal,
        projectId: streamCacheCtx?.projectId,
        ...context,
      };
      const textPartId = generateId("text");

      // Resolve model BEFORE creating the ReadableStream. If this throws
      // (e.g., no_ai_available), the error propagates to the caller who can
      // return a proper error response (503) instead of a 200 with an error event.
      const languageModel = transport.languageModel;

      // Determine inference mode from the resolved model object, not the string.
      const isLocal = isLocalModelRuntime(languageModel);
      const supportsToolCalling = supportsModelRuntimeToolCalling(languageModel);
      const providerReplayCheckpointEmission = resolveRuntimeProviderReplayCheckpointEmission(
        this.config,
      );

      // Eagerly verify the model runtime is available. For local models this
      // checks that @huggingface/transformers can be imported. Must happen
      // BEFORE creating the ReadableStream so no_ai_available errors propagate
      // to the route handler, which returns a 503 instead of swallowing it as an
      // in-band SSE error in a 200 response.
      try {
        await ensureModelReady(languageModel, streamAbortSignal);
      } catch (error) {
        revokeModelRuntimeResolver(resolveModelRuntime);
        throw error;
      }

      // The context carries the normalized clones, not the caller's raw array:
      // a middleware that mutates a message in place must be mutating the same
      // objects that are later persisted and dispatched to the provider.
      await this.restoreInputReplayMetadata(inputMessages);
      const agentContext: AgentContext = {
        agentId: this.id,
        model: resolvedModelString,
        input: inputMessages,
        data: context,
        platform: detectPlatform(),
      };
      const chain = new MiddlewareChain(this.config.middleware);

      // Persist only after the middleware chain accepted this turn, so a
      // rejected message never lands in memory to be replayed to the provider on
      // a later, benign turn. A middleware that answers without calling `next()`
      // (a cache hit) still accepted the turn, so persistence runs after the
      // chain resolves when the continuation never reached it.
      const turnPersistence = this.createTurnPersistence(
        inputMessages,
        agentContext,
        streamAbortSignal,
      );

      // Deferring persistence into the stream body moved the memory calls past
      // the point where the route can still return a 5xx, so probe the memory
      // backend BEFORE creating the ReadableStream: an unreachable store (e.g.
      // a Redis outage) rejects this call instead of surfacing as an in-band
      // SSE error inside a committed 200 response. The write itself still
      // happens only after the middleware chain accepts the turn.
      await this.memory.getMessages();

      // Hold the in-flight agent-loop promise so stream cancellation can detach a
      // no-op rejection handler. When the client cancels, we abort the shared
      // signal; the loop (model fetch / tool execution) then rejects with an
      // AbortError. The `start` body awaits it, but cancellation can land after
      // that await settles, leaving the rejection without a consumer, fatal as
      // an unhandled rejection under Deno (#2334).
      let inFlight: Promise<AgentResponse> | undefined;

      const runtimeStream = new IntrinsicReadableStream<Uint8Array>({
        start: async (controller) => {
          try {
            throwIfAborted(streamAbortSignal);
            this.status = "streaming";

            const messageId = generateMessageId();
            sendSSE(controller, encoder, { type: "message-start", messageId });
            // Report the effective model after resolution so the client can show
            // whether inference is cloud or explicit server-local.
            sendSSE(controller, encoder, {
              type: "data",
              data: {
                inferenceMode: isLocal ? "server-local" : "cloud",
                model: resolvedModelString,
              },
            });
            sendSSE(controller, encoder, {
              type: "data-veryfront.runtime_context",
              data: runRuntimeContext,
            });
            let streamedResponseText = "";
            const streamingCallbacks: AgentRuntimeStreamCallbacks = {
              ...callbacks,
              onChunk: (chunk) => {
                streamedResponseText += chunk;
                callbacks?.onChunk?.(chunk);
              },
            };
            inFlight = chain.execute(
              agentContext,
              async () => {
                try {
                  const memoryMessages = await turnPersistence.persist();
                  return await runWithRemoteIntegrationToolDiscoveryScope(() =>
                    this.#executeAgentLoopStreaming(
                      systemPrompt,
                      memoryMessages,
                      turnPersistence.validateProviderRequest,
                      turnPersistence.addMessage,
                      controller,
                      encoder,
                      streamingCallbacks,
                      textPartId,
                      toolContext,
                      context,
                      runRuntimeContext,
                      supportsToolCalling,
                      providerReplayCheckpointEmission,
                      resolvedModelString,
                      languageModel,
                      transport.headers,
                      transport.providerOptions,
                      transport.reasoning,
                      maxOutputTokensOverride,
                      streamAbortSignal,
                      requestedModel,
                      outputSchema,
                    )
                  );
                } finally {
                  abortScope.revoke();
                }
              },
            );
            const response = await inFlight;
            const messages = await turnPersistence.persist();
            if (turnPersistence.validationState() === "pending") {
              await turnPersistence.validateProviderRequest(
                withAgentRunRuntimeContext(systemPrompt, runRuntimeContext),
                messages,
              );
            }
            await turnPersistence.commit();
            throwIfAborted(streamAbortSignal);
            if (response.text.length > 0 && streamedResponseText.length === 0) {
              sendSSE(controller, encoder, { type: "text-start", id: textPartId });
              sendSSE(controller, encoder, {
                type: "text-delta",
                id: textPartId,
                delta: response.text,
              });
              callbacks?.onChunk?.(response.text);
              sendSSE(controller, encoder, { type: "text-end", id: textPartId });
            }
            callbacks?.onFinish?.(response);
            throwIfAborted(streamAbortSignal);

            const finishUsage = buildStreamFinishUsage(response.usage);
            const finishReason = getResponseFinishReason(response);
            sendSSE(controller, encoder, {
              type: "message-finish",
              ...(finishReason ? { finishReason } : {}),
              ...(finishUsage ? { totalUsage: finishUsage } : {}),
              ...("object" in response && response.object !== undefined
                ? { object: response.object }
                : {}),
            });
            closeSSEStream(controller);
          } catch (streamError) {
            let error = streamError;
            try {
              await turnPersistence.finalize();
            } catch (finalizationError) {
              error = finalizationError;
            }
            try {
              await failProviderReplayCheckpointTurn(providerReplayCheckpointEmission);
            } catch (failureHookError) {
              logger.debug("Provider replay failure hook rejected", {
                error: failureHookError,
              });
            }
            if (isAbortError(error, streamAbortSignal)) {
              closeSSEStream(controller);
              return;
            }

            this.status = "error";
            logger.error("Agent stream error", { error });
            sendSSE(controller, encoder, {
              type: "error",
              error: error instanceof Error ? error.message : String(error),
            });
            closeSSEStream(controller);
          } finally {
            abortScope.dispose();
          }
        },
        cancel(reason) {
          // The client disconnected (e.g. the Chat Stop button). Treat this as a
          // clean stop: revoke authority before project-controlled abort listeners
          // run, then attach a no-op rejection handler through the captured Promise
          // intrinsic so the aborted loop cannot surface an unhandled rejection.
          try {
            abortScope.abort(reason);
          } catch {
            // Aborting an already-aborted controller, or a synchronous reject
            // from a signal consumer, is a no-op for cancellation purposes.
          }
          if (inFlight) {
            void IntrinsicReflectApply(PromiseThen, inFlight, [undefined, () => {}]);
          }
        },
      });
      return runtimeStream;
    } catch (error) {
      abortScope.dispose();
      throw error;
    }
  }

  /**
   * Execute agent loop (with tool calling)
   */
  async #executeAgentLoop( // NOSONAR: Existing loop shape; this patch only adds authority cleanup.
    systemPrompt: AgentSystem,
    messages: Message[],
    validateProviderRequest: TurnProviderRequestValidator,
    persistMessage: (message: Message) => Promise<void>,
    toolContextBase: ToolExecutionContext | undefined,
    runtimeContext: Record<string, unknown> | undefined,
    runRuntimeContext: AgentRunRuntimeContext,
    supportsToolCalling: boolean,
    providerReplayCheckpointEmission: RuntimeProviderReplayCheckpointEmission,
    modelString?: string,
    resolvedModel?: ModelRuntime,
    headers?: HeadersInit,
    providerOptions?: Record<string, unknown>,
    reasoning?: RuntimeReasoningOption,
    maxOutputTokensOverride?: number,
    temperatureModelString?: string,
    toolReplacements?: AgentGenerateToolReplacements,
    abortSignal?: AbortSignal,
    outputSchema?: ResolvedAgentOutputSchema,
  ): Promise<AgentResponse> {
    return withSpan("agent.execution_loop", async (loopSpan) => {
      const { maxAgentSteps } = getPlatformCapabilities();
      const maxSteps = this.computeMaxSteps(maxAgentSteps);
      const effectiveModel = resolveRuntimeModel(modelString || this.config.model);
      const languageModel = resolvedModel ?? resolveModel(effectiveModel);

      const toolCalls: ToolCall[] = [];
      const currentMessages = [...messages];
      applyProviderReplayCheckpointsToMessages(
        currentMessages,
        getRuntimeProviderReplayCheckpoints(this.config),
        { activeProvider: getActiveProviderReplayProvider(languageModel) },
      );
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      if (!supportsToolCalling && this.config.tools) {
        warnUnsupportedToolCalling(this.id, effectiveModel);
      }

      // Request-scoped skill policy (not class-level mutable state)
      const skillState = AgentLoopSkillState.hydrate(currentMessages, runtimeContext);
      const hasToolReplacements = toolReplacements !== undefined;
      const initialToolExposureCheckpoint = hasToolReplacements
        ? undefined
        : getRuntimeToolExposureCheckpoint(this.config);
      const toolExposureState = createToolExposureState();
      const persistToolExposureCheckpoint = hasToolReplacements
        ? undefined
        : getRuntimeToolExposureCheckpointPersister(this.config);
      const requireToolExposureCheckpointPersistence = hasToolReplacements
        ? false
        : isRuntimeToolExposureCheckpointPersistenceRequired(this.config);
      const runtimeToolsConfig = hasToolReplacements ? toolReplacements : this.config.tools;
      const toolLoadingResolution = resolveRuntimeToolLoading(this.config);
      const runConfig: RuntimeToolFilterConfig = {
        ...this.config,
        __vfToolLoadingMode: hasToolReplacements ? "eager" : toolLoadingResolution.mode,
      };
      const runtimeStepConfig: AgentConfig = hasToolReplacements
        ? {
          ...runConfig,
          tools: runtimeToolsConfig,
          skills: undefined,
          providerTools: undefined,
          mcpServers: undefined,
          sandbox: undefined,
        }
        : runConfig;
      const runtimeStepToolLoading = resolveRuntimeToolLoading(runtimeStepConfig);
      const allowedRemoteToolNames = hasToolReplacements
        ? undefined
        : getRuntimeAllowedRemoteTools(this.config);
      const forwardedRemoteToolDefinitions = hasToolReplacements
        ? undefined
        : getRuntimeForwardedIntegrationToolDefs(this.config);
      const remoteToolSources = hasToolReplacements
        ? undefined
        : getRuntimeRemoteToolSources(this.config, undefined, this.id);
      const sourceIntegrationPolicy = hasToolReplacements
        ? undefined
        : getRuntimeSourceIntegrationPolicy(this.config);
      const configuredProviderTools = hasToolReplacements
        ? []
        : getRuntimeProviderTools(this.config);
      const providerTools = sourceIntegrationPolicy
        ? applySourceIntegrationPolicy(configuredProviderTools, sourceIntegrationPolicy)
        : configuredProviderTools;
      let currentSystemPrompt = systemPrompt;
      let currentRuntimeContext = runtimeContext;
      let agentWriteFinalResponseToolGuardEnabled = false;

      for (let step = 0; step < maxSteps; step++) {
        throwIfAborted(abortSignal);
        this.status = "thinking";
        addSpanEvent(loopSpan, "step_start", { step });
        const stepRuntimeContext = skillState.hasSubmittedFormInput
          ? markSubmittedFormInputRuntimeContext(currentRuntimeContext)
          : currentRuntimeContext;

        const preparedStep = await prepareAgentRuntimeStep({
          agentId: this.id,
          activeSkillId: hasToolReplacements ? undefined : skillState.activeSkillId,
          activeSkillToolAvailability: hasToolReplacements
            ? undefined
            : skillState.activeSkillToolAvailability,
          allowedRemoteToolNames,
          config: runtimeStepConfig,
          effectiveModel,
          excludedToolNames: agentWriteFinalResponseToolGuardEnabled &&
              runtimeStepToolLoading.mode === "eager"
            ? AGENT_WRITE_FINAL_RESPONSE_EXCLUDED_TOOL_NAMES
            : undefined,
          forwardedRemoteToolDefinitions,
          getAvailableTools,
          supportsToolCalling,
          messages: currentMessages,
          mode: "generate",
          modelRuntime: languageModel,
          providerOptionKey: resolveModelProviderOptionKey(effectiveModel, languageModel),
          providerToolNames: supportsToolCalling && !agentWriteFinalResponseToolGuardEnabled
            ? providerTools
            : [],
          remoteToolSources,
          sourceIntegrationPolicy,
          resolveRuntimeState: this.resolveRuntimeState.bind(this),
          runtimeContext: stepRuntimeContext,
          step,
          systemPrompt: currentSystemPrompt,
          toolContextBase: { ...toolContextBase, abortSignal },
          strictConfiguredToolsOnly: hasToolReplacements,
          toolExposureState,
          toolExposureCheckpoint: step === 0 ? initialToolExposureCheckpoint : undefined,
        });
        throwIfAborted(abortSignal);
        currentSystemPrompt = preparedStep.systemPrompt;
        currentRuntimeContext = preparedStep.runtimeContext;
        const toolContext = preparedStep.toolContext;
        const effectiveToolExposurePlan = agentWriteFinalResponseToolGuardEnabled
          ? applyAgentWriteFinalResponseGuard(preparedStep.toolExposurePlan, {
            reloadable: runtimeStepToolLoading.mode === "deferred",
          })
          : preparedStep.toolExposurePlan;
        const tools = effectiveToolExposurePlan.visible;
        setSpanAttributes(loopSpan, {
          "tool.loading.mode": runtimeStepToolLoading.mode,
          "tool.loading.provenance": toolLoadingResolution.provenance,
          "tool.catalog.authorized_count": preparedStep.toolExposurePlan.authorized.length,
          "tool.catalog.visible_count": tools.length,
          "tool.catalog.deferred_count": preparedStep.toolExposurePlan.deferred.length,
          "tool.loading.path": "framework-fallback",
        });
        const visibleToolNames = collectVisibleToolNames(tools);
        const stepProviderTools = supportsToolCalling && !agentWriteFinalResponseToolGuardEnabled
          ? filterVisibleProviderTools(providerTools, visibleToolNames)
          : [];

        const temperature = this.resolveTemperature(
          temperatureModelString ?? effectiveModel,
          providerOptions,
        );
        const runtimeTools = convertToolsToRuntimeTools(tools, {
          model: effectiveModel,
          providerTools: stepProviderTools,
        });
        currentSystemPrompt = withIntegrationToolDiscoveryStatus(
          synchronizeRuntimeToolInventory(
            currentSystemPrompt,
            runtimeTools,
            agentWriteFinalResponseToolGuardEnabled
              ? effectiveToolExposurePlan.deferred.filter((tool) =>
                shouldHideProjectToolAfterAgentWriteSuccess(tool.name)
              )
              : [],
          ),
          preparedStep.integrationToolDiscovery,
        );
        const response = await withSpan("agent.generate_text", async (span) => {
          setSpanAttributes(span, {
            "model.id": effectiveModel,
            "messages.count": currentMessages.length,
          });
          const providerSystemPrompt = withAgentRunRuntimeContext(
            currentSystemPrompt,
            runRuntimeContext,
          );
          await validateProviderRequest(
            providerSystemPrompt,
            currentMessages,
          );
          const result = await generateText({
            model: languageModel,
            system: providerSystemPrompt,
            messages: convertToTextGenerationRuntimeRequestMessages(currentMessages, {
              // A server-local runtime fetches attachments from this machine,
              // where a loopback or private-network URL resolves; only a remote
              // provider needs the URL to be reachable from the internet.
              requireInternetReachableAttachments: !isLocalModelRuntime(languageModel),
            }),
            tools: runtimeTools,
            experimental_repairToolCall: repairToolCall,
            maxOutputTokens: this.resolveMaxOutputTokens(effectiveModel, maxOutputTokensOverride),
            ...(temperature === undefined ? {} : { temperature }),
            ...(headers ? { headers } : {}),
            ...(providerOptions ? { providerOptions } : {}),
            ...(reasoning ? { reasoning } : {}),
            ...(outputSchema ? { responseFormat: outputSchema.responseFormat } : {}),
            abortSignal,
          });
          setSpanAttributes(span, buildRuntimeUsageTraceAttributes(result.usage));
          return result;
        });
        throwIfAborted(abortSignal);

        // Accumulate usage
        if (response.usage) {
          const input = response.usage.inputTokens ?? 0;
          const output = response.usage.outputTokens ?? 0;
          accumulateUsage(totalUsage, {
            promptTokens: input,
            completionTokens: output,
            totalTokens: response.usage.totalTokens ?? input + output,
            cachedInputTokens: response.usage.cachedInputTokens ??
              response.usage.cacheReadInputTokens,
            cacheCreationInputTokens: response.usage.cacheCreationInputTokens,
            cacheReadInputTokens: response.usage.cacheReadInputTokens,
            reasoningTokens: response.usage.reasoningTokens,
            billableInputTokens: response.usage.billableInputTokens,
            billableOutputTokens: response.usage.billableOutputTokens,
            costUsd: response.usage.costUsd,
            providerInputCostUsd: response.usage.providerInputCostUsd,
            providerOutputCostUsd: response.usage.providerOutputCostUsd,
            providerCostUsd: response.usage.providerCostUsd,
            veryfrontInputChargeUsd: response.usage.veryfrontInputChargeUsd,
            veryfrontOutputChargeUsd: response.usage.veryfrontOutputChargeUsd,
            veryfrontChargeUsd: response.usage.veryfrontChargeUsd,
            veryfrontBilledUsd: response.usage.veryfrontBilledUsd,
            costCredits: response.usage.costCredits,
            costSource: response.usage.costSource,
            billingMode: response.usage.billingMode,
            usageCaptureStatus: response.usage.usageCaptureStatus,
          });
          setSpanAttributes(loopSpan, buildRuntimeUsageTraceAttributes(totalUsage));
        }

        const assistantMessage = buildGeneratedAssistantMessage(response, {
          id: `msg_${Date.now()}_${step}`,
          timestamp: Date.now(),
        });
        currentMessages.push(assistantMessage);
        await persistMessage(assistantMessage);
        await persistProviderReplayCheckpointAfterTurn({
          emission: providerReplayCheckpointEmission,
          providerMetadata: readAttachedProviderMetadata(assistantMessage),
        });
        throwIfAborted(abortSignal);
        const generatedToolResults = collectGeneratedToolResults(response.toolResults);

        const persistGeneratedToolResult = async (
          generatedToolResult: RuntimeGenerateToolResult,
        ): Promise<void> => {
          const toolResultMessage = createToolResultMessage(
            generatedToolResult.toolCallId,
            generatedToolResult.toolName,
            generatedToolResult.isError === true
              ? { error: stringifyToolError(generatedToolResult.result) }
              : generatedToolResult.result,
            generatedToolResult.providerExecuted === true,
          );
          currentMessages.push(toolResultMessage);
          await persistMessage(toolResultMessage);
          throwIfAborted(abortSignal);
        };

        const rejectUnpairedRequestScopedGeneratedToolResult = async (
          generatedToolResult: RuntimeGenerateToolResult,
        ): Promise<boolean> => {
          if (!hasToolReplacements) {
            return false;
          }

          const error =
            `Tool "${generatedToolResult.toolName}" is not available in request-scoped replacement tools`;
          const toolCall: ToolCall = {
            id: generatedToolResult.toolCallId,
            name: generatedToolResult.toolName,
            args: {},
            status: "error",
            error,
          };
          toolCalls.push(toolCall);
          const errorMessage = createToolErrorMessage(
            generatedToolResult.toolCallId,
            generatedToolResult.toolName,
            error,
          );
          currentMessages.push(errorMessage);
          await persistMessage(errorMessage);
          return true;
        };

        if (!response.toolCalls?.length) {
          for (const generatedToolResult of generatedToolResults.values()) {
            if (await rejectUnpairedRequestScopedGeneratedToolResult(generatedToolResult)) {
              continue;
            }
            await persistGeneratedToolResult(generatedToolResult);
          }
          this.status = "completed";
          addSpanEvent(loopSpan, "loop_complete");
          setSpanAttributes(loopSpan, buildRuntimeUsageTraceAttributes(totalUsage));
          return attachOutputSchemaParser({
            text: response.text,
            ...(outputSchema ? { object: await outputSchema.parseOutput(response.text) } : {}),
            messages: currentMessages,
            toolCalls,
            status: this.status,
            usage: totalUsage,
            metadata: withAgentRunRuntimeContextMetadata(
              runRuntimeContext,
              response.finishReason ? { finishReason: response.finishReason } : undefined,
            ),
          }, outputSchema);
        }

        this.status = "tool_execution";
        addSpanEvent(loopSpan, "tool_execution_start", { count: response.toolCalls.length });

        for (const tc of response.toolCalls) {
          throwIfAborted(abortSignal);
          const toolCall: ToolCall = {
            id: tc.toolCallId,
            name: tc.toolName,
            args: tc.input as Record<string, unknown>,
            status: "pending",
          };
          const generatedToolResult = generatedToolResults.get(tc.toolCallId);

          await withSpan("agent.tool_execute", async (toolSpan) => {
            const inputSizeBytes = estimateSerializedSizeBytes(tc.input);
            setSpanAttributes(
              toolSpan,
              compactRuntimeTraceAttributes({
                "tool.name": tc.toolName,
                "tool.call.id": tc.toolCallId,
                "tool.id": tc.toolCallId,
                "tool.status": "executing",
                "tool.input.size_bytes": inputSizeBytes,
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": tc.toolName,
                "gen_ai.tool.type": "function",
                "gen_ai.tool.call.id": tc.toolCallId,
              }),
            );

            const executionAuthority = resolveToolExecutionAuthority({
              toolName: tc.toolName,
              plan: effectiveToolExposurePlan,
            });
            if (
              !hasToolReplacements &&
              generatedToolResult === undefined &&
              executionAuthority === undefined
            ) {
              toolCall.status = "error";
              toolCall.error = toolNotVisibleError(tc.toolName);
              setSpanAttributes(toolSpan, {
                "tool.status": "blocked",
                error: true,
                "error.type": "ToolExposureBlocked",
              });
              const errorMessage = createToolErrorMessage(
                tc.toolCallId,
                tc.toolName,
                toolCall.error,
              );
              currentMessages.push(errorMessage);
              await persistMessage(errorMessage);
              toolCalls.push(toolCall);
              return;
            }
            if (
              generatedToolResult === undefined &&
              isFrameworkToolSearch(tc.toolName, effectiveToolExposurePlan)
            ) {
              let checkpoint: ToolExposureCheckpoint;
              try {
                const search = executeFrameworkToolSearch({
                  args: toolCall.args,
                  plan: effectiveToolExposurePlan,
                  state: toolExposureState,
                });
                if (didReloadProjectAgentWriteTool(search.result)) {
                  agentWriteFinalResponseToolGuardEnabled = false;
                }
                toolCall.status = "completed";
                toolCall.result = search.result;
                setSpanAttributes(toolSpan, {
                  "tool.status": "completed",
                  "tool.search.result_count": search.result.resultCount,
                  "tool.search.loaded_count": search.result.loadedCount,
                  "tool.search.miss": search.result.miss,
                });
                const toolResultMessage = createToolResultMessage(
                  tc.toolCallId,
                  tc.toolName,
                  search.result,
                );
                currentMessages.push(toolResultMessage);
                await persistMessage(toolResultMessage);
                checkpoint = search.checkpoint;
              } catch (error) {
                toolCall.status = "error";
                toolCall.error = error instanceof Error ? error.message : String(error);
                const errorMessage = createToolErrorMessage(
                  tc.toolCallId,
                  tc.toolName,
                  toolCall.error,
                );
                currentMessages.push(errorMessage);
                await persistMessage(errorMessage);
                toolCalls.push(toolCall);
                return;
              }
              await persistToolExposureCheckpointBeforeContinuation({
                checkpoint,
                persist: persistToolExposureCheckpoint,
                required: requireToolExposureCheckpointPersistence,
              });
              toolCalls.push(toolCall);
              return;
            }

            // Provider-executed tools (web_search/web_fetch) return results without skill-state
            // transitions. Unlike locally-executed paths, load_skill and form_input are client-side
            // function tools that the runtime executes itself, so they never appear in
            // response.toolResults. This branch mirrors the streaming loop's providerExecuted===true
            // path, not the locally-executed ones. If provider-executed tools expand beyond web_*,
            // the transitions (skillState.applySuccessfulResult, markFormInputSubmitted) would apply.
            if (generatedToolResult && !hasToolReplacements) {
              if (generatedToolResult.providerExecuted === true) {
                await traceProviderExecutedTool({
                  mode: "generate",
                  agentId: this.id,
                  toolName: tc.toolName,
                  toolCallId: tc.toolCallId,
                  context: {
                    toolCallId: tc.toolCallId,
                    ...toolContext,
                    agentId: this.id,
                  },
                  args: tc.input,
                  result: generatedToolResult.result,
                  isError: generatedToolResult.isError === true,
                });
              }
              await persistGeneratedToolResult(generatedToolResult);
              toolCall.status = generatedToolResult.isError === true ? "error" : "completed";
              toolCall.result = generatedToolResult.result;
              toolCall.error = generatedToolResult.isError === true
                ? stringifyToolError(generatedToolResult.result)
                : undefined;
              if (toolCall.error !== undefined) {
                setOtelActiveSpanErrorStatus(new NativeError(`Tool "${tc.toolName}" failed`));
              }
              if (
                generatedToolResult.isError !== true &&
                shouldHideProjectToolAfterAgentWriteSuccess(tc.toolName)
              ) {
                agentWriteFinalResponseToolGuardEnabled = true;
              }
              setSpanAttributes(
                toolSpan,
                compactRuntimeTraceAttributes({
                  "tool.status": generatedToolResult.isError === true ? "failed" : "completed",
                  "tool.provider_executed": generatedToolResult.providerExecuted === true,
                  "tool.output.size_bytes": estimateSerializedSizeBytes(generatedToolResult.result),
                  ...(toolCall.error
                    ? {
                      error: true,
                      "error.type": "ProviderExecutedToolError",
                    }
                    : {}),
                }),
              );
              toolCalls.push(toolCall);
              return;
            }

            const policyCheck = enforceSkillPolicy(
              tc.toolName,
              {
                activeSkillId: skillState.activeSkillId,
                hasSubmittedFormInput: skillState.hasSubmittedFormInput,
                skillToolAvailability: skillState.activeSkillToolAvailability,
                toolInput: tc.input,
              },
            );
            if (!policyCheck.allowed) {
              toolCall.status = "error";
              toolCall.error = policyCheck.error;
              setSpanAttributes(toolSpan, {
                "tool.status": "blocked",
                error: true,
                "error.type": "ToolPolicyBlocked",
              });

              const errorMessage: Message = {
                id: `tool_error_${tc.toolCallId}`,
                role: "tool",
                parts: [{
                  type: "tool-result",
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  result: { error: policyCheck.error },
                }],
                timestamp: Date.now(),
              };
              currentMessages.push(errorMessage);
              await persistMessage(errorMessage);
              toolCalls.push(toolCall);
              return;
            }

            try {
              toolCall.status = "executing";
              const startTime = Date.now();

              const cacheCtx = tryGetCacheKeyContext();
              toolCall.args = applySkillDelegationOverridesToToolInput(
                tc.toolName,
                toolCall.args,
                hasToolReplacements ? undefined : skillState.activeSkillDelegationOverrides,
                hasToolReplacements
                  ? undefined
                  : resolveConfiguredTool(runtimeToolsConfig, tc.toolName, { agentId: this.id }) ??
                    undefined,
              );
              const executionContext = {
                toolCallId: tc.toolCallId,
                ...toolContext,
                projectId: cacheCtx?.projectId ?? toolContext?.projectId,
                // Caller identity for capability scoping. Stamped after the
                // spreads so caller-supplied context cannot spoof it.
                agentId: this.id,
              };
              throwIfAborted(abortSignal);
              const result = await traceConfiguredToolExecution({
                mode: "generate",
                agentId: this.id,
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
                args: toolCall.args,
                toolsConfig: runtimeToolsConfig,
                context: executionContext,
                allowedRemoteToolNames,
                remoteToolSources,
                sourceIntegrationPolicy,
                strictConfiguredToolsOnly: hasToolReplacements,
              });
              await this.notifyToolResult({
                mode: "generate",
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
                input: toolCall.args,
                result,
                context: executionContext,
              });

              const resultError = getToolResultError(result);
              if (resultError !== undefined) {
                setOtelActiveSpanErrorStatus(new NativeError(`Tool "${tc.toolName}" failed`));
              }
              toolCall.status = resultError === undefined ? "completed" : "error";
              toolCall.result = result;
              toolCall.error = resultError;
              toolCall.executionTime = Date.now() - startTime;
              setSpanAttributes(
                toolSpan,
                compactRuntimeTraceAttributes({
                  "tool.status": resultError === undefined ? "completed" : "failed",
                  "tool.provider_executed": false,
                  "tool.output.size_bytes": estimateSerializedSizeBytes(result),
                  ...(resultError === undefined ? {} : {
                    error: true,
                    "error.type": "ToolResultError",
                  }),
                }),
              );

              if (resultError === undefined) {
                if (shouldHideProjectToolAfterAgentWriteSuccess(tc.toolName)) {
                  agentWriteFinalResponseToolGuardEnabled = true;
                }
                // Track skill policy from successful load_skill results
                if (tc.toolName === LOAD_SKILL_TOOL_ID) {
                  skillState.applySuccessfulResult(result);
                }
                const submittedFormInput = isSubmittedFormInputExecutionResult(
                  tc.toolName,
                  result,
                );
                skillState.markFormInputSubmitted(submittedFormInput);
                if (submittedFormInput) {
                  currentRuntimeContext = markSubmittedFormInputRuntimeContext(
                    currentRuntimeContext,
                  );
                }
              }

              const toolResultMessage = createToolResultMessage(
                tc.toolCallId,
                tc.toolName,
                result,
              );
              currentMessages.push(toolResultMessage);
              await persistMessage(toolResultMessage);
            } catch (error) {
              throwIfAborted(abortSignal);
              toolCall.status = "error";
              toolCall.error = error instanceof Error ? error.message : String(error);
              setSpanAttributes(toolSpan, {
                "tool.status": "failed",
                error: true,
                "error.type": telemetryErrorType(error),
              });

              const errorMessage = createToolErrorMessage(
                tc.toolCallId,
                tc.toolName,
                toolCall.error,
              );
              currentMessages.push(errorMessage);
              await persistMessage(errorMessage);
            }

            toolCalls.push(toolCall);
          });
          throwIfAborted(abortSignal);
        }
      }

      throwIfAborted(abortSignal);
      this.status = "completed";
      addSpanEvent(loopSpan, "max_steps_reached", { maxSteps });
      setSpanAttributes(loopSpan, buildRuntimeUsageTraceAttributes(totalUsage));

      // The last message on this exit is a tool result, so the response text
      // and the structured-output candidate come from the final assistant turn.
      const finalText = getFinalAssistantText(currentMessages);
      const parsedOutput = await tryParseMaxStepsOutput(finalText, outputSchema);
      return attachOutputSchemaParser({
        text: finalText,
        ...(parsedOutput.parsed ? { object: parsedOutput.object } : {}),
        messages: currentMessages,
        toolCalls,
        status: this.status,
        usage: totalUsage,
        metadata: withAgentRunRuntimeContextMetadata(runRuntimeContext, {
          warning: `Max steps (${maxSteps}) reached`,
          ...(!parsedOutput.parsed && parsedOutput.outputSchemaError !== undefined
            ? { outputSchemaError: parsedOutput.outputSchemaError }
            : {}),
        }),
      }, outputSchema);
    });
  }

  /**
   * Execute agent loop with streaming
   * Emits veryfront stream events (message-start/message-finish + step-start/step-end)
   * while consuming model-runtime `streamText()` parts internally.
   */
  async #executeAgentLoopStreaming( // NOSONAR: Existing loop shape; this patch only adds authority cleanup.
    systemPrompt: AgentSystem,
    messages: Message[],
    validateProviderRequest: TurnProviderRequestValidator,
    persistMessage: (message: Message) => Promise<void>,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    callbacks: {
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
      onFinish?: (response: AgentResponse) => void;
    } | undefined,
    textPartId: string | undefined,
    toolContextBase: Record<string, unknown> | undefined,
    runtimeContext: Record<string, unknown> | undefined,
    runRuntimeContext: AgentRunRuntimeContext,
    supportsToolCalling: boolean,
    providerReplayCheckpointEmission: RuntimeProviderReplayCheckpointEmission,
    modelString?: string,
    resolvedModel?: ModelRuntime,
    headers?: HeadersInit,
    providerOptions?: Record<string, unknown>,
    reasoning?: RuntimeReasoningOption,
    maxOutputTokensOverride?: number,
    abortSignal?: AbortSignal,
    temperatureModelString?: string,
    outputSchema?: ResolvedAgentOutputSchema,
  ): Promise<AgentResponse> {
    const { maxAgentSteps } = getPlatformCapabilities();
    const maxSteps = this.computeMaxSteps(maxAgentSteps);
    const effectiveModel = resolveRuntimeModel(modelString || this.config.model);
    const languageModel = resolvedModel ?? resolveModel(effectiveModel);

    const toolCalls: ToolCall[] = [];
    const currentMessages = [...messages];
    applyProviderReplayCheckpointsToMessages(
      currentMessages,
      getRuntimeProviderReplayCheckpoints(this.config),
      { activeProvider: getActiveProviderReplayProvider(languageModel) },
    );
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    if (!supportsToolCalling && this.config.tools) {
      warnUnsupportedToolCalling(this.id, effectiveModel);
    }

    // Request-scoped skill policy (not class-level mutable state)
    const skillState = AgentLoopSkillState.hydrate(currentMessages, runtimeContext);
    let finalFinishReason: string | undefined;
    let latestAssistantText = "";
    let completedWithinStepBudget = false;
    const initialToolExposureCheckpoint = getRuntimeToolExposureCheckpoint(this.config);
    const toolExposureState = createToolExposureState();
    const persistToolExposureCheckpoint = getRuntimeToolExposureCheckpointPersister(this.config);
    const requireToolExposureCheckpointPersistence =
      isRuntimeToolExposureCheckpointPersistenceRequired(this.config);
    const toolLoadingResolution = resolveRuntimeToolLoading(this.config);
    const runtimeStepConfig: RuntimeToolFilterConfig = {
      ...this.config,
      __vfToolLoadingMode: toolLoadingResolution.mode,
    };
    const allowedRemoteToolNames = getRuntimeAllowedRemoteTools(this.config);
    const forwardedRemoteToolDefinitions = getRuntimeForwardedIntegrationToolDefs(this.config);
    const remoteToolSources = getRuntimeRemoteToolSources(this.config, undefined, this.id);
    const sourceIntegrationPolicy = getRuntimeSourceIntegrationPolicy(this.config);
    const configuredProviderTools = getRuntimeProviderTools(this.config);
    const providerTools = sourceIntegrationPolicy
      ? applySourceIntegrationPolicy(configuredProviderTools, sourceIntegrationPolicy)
      : configuredProviderTools;
    let currentSystemPrompt = systemPrompt;
    let currentRuntimeContext = runtimeContext;
    let agentWriteFinalResponseToolGuardEnabled = false;
    // One retry gives the model a chance to reconstruct a transport-truncated
    // batch without allowing a repeatedly broken provider stream to loop.
    let recoveredInterruptedLocalToolBatch = false;
    let interruptedLocalToolBatchRecoveryStep: number | undefined;
    let interruptedLocalToolBatchRecoveryText: string | undefined;

    for (let step = 0; step < maxSteps; step++) {
      throwIfAborted(abortSignal);
      sendSSE(controller, encoder, { type: "step-start" });
      const currentStepToolResults = new Map<string, ToolResultPart>();
      const stepRuntimeContext = skillState.hasSubmittedFormInput
        ? markSubmittedFormInputRuntimeContext(currentRuntimeContext)
        : currentRuntimeContext;

      const preparedStep = await prepareAgentRuntimeStep({
        agentId: this.id,
        activeSkillId: skillState.activeSkillId,
        activeSkillToolAvailability: skillState.activeSkillToolAvailability,
        allowedRemoteToolNames,
        config: runtimeStepConfig,
        effectiveModel,
        excludedToolNames: agentWriteFinalResponseToolGuardEnabled &&
            toolLoadingResolution.mode === "eager"
          ? AGENT_WRITE_FINAL_RESPONSE_EXCLUDED_TOOL_NAMES
          : undefined,
        forwardedRemoteToolDefinitions,
        getAvailableTools,
        supportsToolCalling,
        messages: currentMessages,
        mode: "stream",
        modelRuntime: languageModel,
        providerOptionKey: resolveModelProviderOptionKey(effectiveModel, languageModel),
        providerToolNames: supportsToolCalling && !agentWriteFinalResponseToolGuardEnabled
          ? providerTools
          : [],
        remoteToolSources,
        sourceIntegrationPolicy,
        resolveRuntimeState: this.resolveRuntimeState.bind(this),
        runtimeContext: stepRuntimeContext,
        step,
        systemPrompt: currentSystemPrompt,
        toolContextBase,
        toolExposureState,
        toolExposureCheckpoint: step === 0 ? initialToolExposureCheckpoint : undefined,
      });
      currentSystemPrompt = preparedStep.systemPrompt;
      currentRuntimeContext = preparedStep.runtimeContext;
      const toolContext = preparedStep.toolContext;
      const effectiveToolExposurePlan = agentWriteFinalResponseToolGuardEnabled
        ? applyAgentWriteFinalResponseGuard(preparedStep.toolExposurePlan, {
          reloadable: toolLoadingResolution.mode === "deferred",
        })
        : preparedStep.toolExposurePlan;
      const tools = effectiveToolExposurePlan.visible;
      setOtelActiveSpanAttributes({
        "tool.loading.mode": resolveRuntimeToolLoading(runtimeStepConfig).mode,
        "tool.loading.provenance": toolLoadingResolution.provenance,
        "tool.catalog.authorized_count": preparedStep.toolExposurePlan.authorized.length,
        "tool.catalog.visible_count": tools.length,
        "tool.catalog.deferred_count": preparedStep.toolExposurePlan.deferred.length,
        "tool.loading.path": "framework-fallback",
      });
      const visibleToolNames = collectVisibleToolNames(tools);
      const stepProviderTools = supportsToolCalling && !agentWriteFinalResponseToolGuardEnabled
        ? filterVisibleProviderTools(providerTools, visibleToolNames)
        : [];

      const runtimeTools = convertToolsToRuntimeTools(tools, {
        model: effectiveModel,
        providerTools: stepProviderTools,
      });
      currentSystemPrompt = withIntegrationToolDiscoveryStatus(
        synchronizeRuntimeToolInventory(
          currentSystemPrompt,
          runtimeTools,
          agentWriteFinalResponseToolGuardEnabled
            ? effectiveToolExposurePlan.deferred.filter((tool) =>
              shouldHideProjectToolAfterAgentWriteSuccess(tool.name)
            )
            : [],
        ),
        preparedStep.integrationToolDiscovery,
      );
      const runtimeToolNames = Object.keys(runtimeTools ?? {}).sort(compareStrings);

      const temperature = this.resolveTemperature(
        temperatureModelString ?? effectiveModel,
        providerOptions,
      );
      const maxOutputTokens = this.resolveMaxOutputTokens(effectiveModel, maxOutputTokensOverride);
      const genAiProviderName = resolveRuntimeGenAiProviderName(effectiveModel);
      const providerSystemPrompt = withAgentRunRuntimeContext(
        currentSystemPrompt,
        runRuntimeContext,
      );
      await validateProviderRequest(
        providerSystemPrompt,
        currentMessages,
      );
      const streamSource = createRuntimeStreamSource((streamSignal) =>
        streamText({
          model: languageModel,
          system: providerSystemPrompt,
          messages: convertToTextGenerationRuntimeRequestMessages(
            currentMessages,
            // A server-local runtime fetches attachments from this machine,
            // where a loopback or private-network URL resolves; only a remote
            // provider needs the URL to be reachable from the internet.
            { requireInternetReachableAttachments: !isLocalModelRuntime(languageModel) },
          ),
          tools: runtimeTools,
          experimental_repairToolCall: repairToolCall,
          maxOutputTokens,
          ...(temperature === undefined ? {} : { temperature }),
          ...(headers ? { headers } : {}),
          ...(providerOptions ? { providerOptions } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(outputSchema ? { responseFormat: outputSchema.responseFormat } : {}),
          abortSignal: streamSignal,
        })
      );

      const state = createStreamState();
      // Hold a possible replay only while it remains a prefix of the text the
      // client already received. Once it diverges, resume live delivery.
      const deferInterruptedRecoveryOutput = step === interruptedLocalToolBatchRecoveryStep &&
        interruptedLocalToolBatchRecoveryText !== undefined;
      const deferredRecoveryOutput: DeferredRecoveryOutput[] | undefined =
        deferInterruptedRecoveryOutput ? [] : undefined;
      const previousRecoveryText = interruptedLocalToolBatchRecoveryText ?? "";
      let deferredRecoverySseText = "";
      let deferredRecoveryCallbackText = "";
      let releasedDeferredRecoveryOutput = false;
      let releasedRecoveryReplacementTextPartId: string | undefined;
      let suppressedRecoveryReplayTextLength = 0;
      const stepTextPartId = textPartId === undefined || step === 0
        ? textPartId
        : `${textPartId}:step:${step}`;
      const replacementRecoveryTextPartId = stepTextPartId === undefined
        ? `recovery:step:${step}`
        : `${stepTextPartId}:recovery`;
      const remainingRecoveryReplayText = () =>
        previousRecoveryText.slice(suppressedRecoveryReplayTextLength);
      const flushDeferredRecoveryOutput = (
        interruptedRecoveryPrefixLength: number,
        repeatsInterruptedRecoveryText: boolean,
        useReplacementTextPartId: boolean,
      ): void => {
        if (deferredRecoveryOutput === undefined) return;

        let remainingSsePrefixLength = interruptedRecoveryPrefixLength;
        let remainingCallbackPrefixLength = interruptedRecoveryPrefixLength;
        for (const output of deferredRecoveryOutput) {
          if (
            repeatsInterruptedRecoveryText &&
            (output.kind === "callback" || output.isTextEvent)
          ) {
            continue;
          }
          if (output.kind === "callback") {
            const stripped = stripLeadingText(output.chunk, remainingCallbackPrefixLength);
            remainingCallbackPrefixLength = stripped.remainingPrefixLength;
            if (stripped.text.length > 0) {
              callbacks?.onChunk?.(stripped.text);
            }
          } else {
            const textChunk = useReplacementTextPartId && output.isTextEvent
              ? rewriteRecoveryTextSseChunkId(
                output.chunk,
                replacementRecoveryTextPartId,
                encoder,
              )
              : output.chunk;
            const stripped = output.isTextEvent
              ? stripTextDeltaPrefixFromSseChunk(
                textChunk,
                remainingSsePrefixLength,
                encoder,
              )
              : { chunk: textChunk, remainingPrefixLength: remainingSsePrefixLength };
            remainingSsePrefixLength = stripped.remainingPrefixLength;
            if (stripped.chunk !== undefined) {
              controller.enqueue(stripped.chunk);
            }
          }
        }
        deferredRecoveryOutput.length = 0;
      };
      const releaseDeferredRecoveryOutputAfterDivergence = (): void => {
        if (deferredRecoveryOutput === undefined || releasedDeferredRecoveryOutput) return;

        const expectedReplayText = remainingRecoveryReplayText();
        const sseDiverged = !expectedReplayText.startsWith(deferredRecoverySseText);
        const callbackDiverged = callbacks?.onChunk === undefined ||
          !expectedReplayText.startsWith(deferredRecoveryCallbackText);
        if (!sseDiverged || !callbackDiverged) return;

        const observedRecoveryText = callbacks?.onChunk === undefined
          ? deferredRecoverySseText
          : deferredRecoveryCallbackText;
        const extendsPreviousRecoveryText = observedRecoveryText.startsWith(expectedReplayText);
        flushDeferredRecoveryOutput(
          extendsPreviousRecoveryText ? expectedReplayText.length : 0,
          false,
          !extendsPreviousRecoveryText && suppressedRecoveryReplayTextLength === 0,
        );
        if (extendsPreviousRecoveryText && suppressedRecoveryReplayTextLength > 0) {
          suppressedRecoveryReplayTextLength += expectedReplayText.length;
        }
        if (!extendsPreviousRecoveryText && suppressedRecoveryReplayTextLength === 0) {
          releasedRecoveryReplacementTextPartId = replacementRecoveryTextPartId;
        }
        releasedDeferredRecoveryOutput = true;
      };
      const releaseDeferredRecoveryOutputAfterExactReplay = (
        isTextEvent: boolean,
      ): void => {
        if (
          isTextEvent || deferredRecoveryOutput === undefined || releasedDeferredRecoveryOutput ||
          deferredRecoverySseText !== remainingRecoveryReplayText() ||
          (callbacks?.onChunk !== undefined &&
            deferredRecoveryCallbackText !== remainingRecoveryReplayText())
        ) {
          return;
        }

        flushDeferredRecoveryOutput(remainingRecoveryReplayText().length, false, false);
        releasedDeferredRecoveryOutput = true;
      };
      const releaseDeferredRecoveryNonTextOutput = (
        isTextEvent: boolean,
      ): void => {
        if (
          isTextEvent || deferredRecoveryOutput === undefined || releasedDeferredRecoveryOutput
        ) {
          return;
        }

        const retainedOutput = deferredRecoveryOutput.filter((output) =>
          output.kind === "callback" || output.isTextEvent
        );
        for (const output of deferredRecoveryOutput) {
          if (output.kind === "sse" && !output.isTextEvent) {
            controller.enqueue(output.chunk);
          }
        }
        deferredRecoveryOutput.length = 0;
        deferredRecoveryOutput.push(...retainedOutput);
      };
      const reconcileDeferredRecoveryTextSegment = (
        isTextEndEvent: boolean,
      ): void => {
        if (
          !isTextEndEvent || deferredRecoveryOutput === undefined ||
          releasedDeferredRecoveryOutput ||
          !remainingRecoveryReplayText().startsWith(deferredRecoverySseText) ||
          (callbacks?.onChunk !== undefined &&
            !remainingRecoveryReplayText().startsWith(deferredRecoveryCallbackText))
        ) {
          return;
        }

        // A tool or reasoning event closes the current text segment. If that
        // segment only replayed a prefix the client already received, discard
        // it now and treat later text as a distinct segment. Otherwise retained
        // prefix events could be released after the boundary when later text
        // diverges, duplicating and reordering the replay.
        suppressedRecoveryReplayTextLength += deferredRecoverySseText.length;
        deferredRecoveryOutput.length = 0;
        deferredRecoverySseText = "";
        deferredRecoveryCallbackText = "";
      };
      const stepController = deferredRecoveryOutput === undefined ? controller : {
        enqueue(chunk: Uint8Array) {
          if (releasedDeferredRecoveryOutput) {
            controller.enqueue(
              releasedRecoveryReplacementTextPartId !== undefined
                ? rewriteRecoveryTextSseChunkId(
                  chunk,
                  releasedRecoveryReplacementTextPartId,
                  encoder,
                )
                : chunk,
            );
            return;
          }
          deferredRecoverySseText += textDeltaFromSseChunk(chunk) ?? "";
          const isTextEvent = isTextSseChunk(chunk);
          deferredRecoveryOutput.push({
            kind: "sse",
            chunk,
            isTextEvent,
          });
          releaseDeferredRecoveryOutputAfterDivergence();
          releaseDeferredRecoveryOutputAfterExactReplay(isTextEvent);
          releaseDeferredRecoveryNonTextOutput(isTextEvent);
          reconcileDeferredRecoveryTextSegment(isTextEndSseChunk(chunk));
        },
      } as ReadableStreamDefaultController;
      await processStream(streamSource, state, stepController, encoder, stepTextPartId, {
        onChunk: deferredRecoveryOutput === undefined ? callbacks?.onChunk : (chunk) => {
          if (releasedDeferredRecoveryOutput) {
            callbacks?.onChunk?.(chunk);
            return;
          }
          deferredRecoveryCallbackText += chunk;
          if (callbacks?.onChunk !== undefined) {
            deferredRecoveryOutput.push({ kind: "callback", chunk });
          }
          releaseDeferredRecoveryOutputAfterDivergence();
        },
        onUsage: (usage) => accumulateUsage(totalUsage, usage),
        providerExecutedToolNames: getProviderExecutedToolNames(runtimeTools),
        availableToolNames: runtimeToolNames,
        streamLifecycleMode: resolveStreamLifecycleModeFromEnv(),
        traceSpanName: `chat ${effectiveModel}`,
        traceAttributes: {
          ...(genAiProviderName ? { "gen_ai.provider.name": genAiProviderName } : {}),
          "gen_ai.request.model": effectiveModel,
          "gen_ai.response.model": effectiveModel,
          "gen_ai.request.max_tokens": maxOutputTokens,
          "gen_ai.output.type": "text",
          ...(temperature === undefined ? {} : { "gen_ai.request.temperature": temperature }),
        },
      }, abortSignal);
      throwIfAborted(abortSignal);
      const interruptedRecoveryPrefixLength = deferredRecoveryOutput === undefined
        ? 0
        : state.accumulatedText.startsWith(previousRecoveryText)
        ? previousRecoveryText.length
        : previousRecoveryText.startsWith(state.accumulatedText)
        ? state.accumulatedText.length
        : 0;
      const recoveryPresentationPrefixLength = suppressedRecoveryReplayTextLength > 0
        ? suppressedRecoveryReplayTextLength
        : interruptedRecoveryPrefixLength;
      const recoveryPresentationText = state.accumulatedText.slice(
        recoveryPresentationPrefixLength,
      );
      const repeatsInterruptedRecoveryText = interruptedRecoveryPrefixLength > 0 &&
        recoveryPresentationText.length === 0;
      if (deferredRecoveryOutput !== undefined && !releasedDeferredRecoveryOutput) {
        flushDeferredRecoveryOutput(
          interruptedRecoveryPrefixLength,
          repeatsInterruptedRecoveryText,
          previousRecoveryText.length > 0 && interruptedRecoveryPrefixLength === 0 &&
            !repeatsInterruptedRecoveryText && state.accumulatedText.length > 0,
        );
      }
      finalFinishReason = state.finishReason ?? finalFinishReason;

      const streamedToolCalls = Array.from(state.toolCalls.values());
      const finalToolResults = collectFinalStreamToolResults(state);
      // Recovery replays the whole step, so it also re-emits this step's
      // reasoning — duplicating it in the live stream and in history, with a
      // signature that no longer matches the replayed content. Reasoning that
      // was persisted is reasoning the client already saw, so fail closed.
      // This is a stopgap: reasoning is default-on across the hosted catalog,
      // which makes recovery inert on most hosted paths. See #3736 for the
      // reconciliation protocol that would let it run again.
      const hasExposedReasoning = state.reasoningParts.some(isPersistedReasoningPart);
      const canRecoverInterruptedLocalToolBatch = !recoveredInterruptedLocalToolBatch &&
        step + 1 < maxSteps &&
        !hasExposedReasoning;
      const shouldContinue = shouldContinueAfterStreamStep(state, {
        recoverInterruptedToolCalls: canRecoverInterruptedLocalToolBatch,
      });
      const shouldRecoverInterruptedLocalToolBatch = canRecoverInterruptedLocalToolBatch &&
        shouldContinue &&
        streamedToolCalls.some(isInterruptedClientToolCall);
      const exhaustedStepBudgetDuringInterruptedLocalToolRecovery =
        !recoveredInterruptedLocalToolBatch &&
        step + 1 >= maxSteps &&
        !hasExposedReasoning &&
        streamedToolCalls.some(isInterruptedClientToolCall) &&
        shouldContinueAfterStreamStep(state, { recoverInterruptedToolCalls: true });
      // Exactly `shouldRecoverInterruptedLocalToolBatch` with the reasoning
      // gate lifted: the batch this step would have replayed had it not
      // already exposed reasoning. Re-asking is what separates "recovery was
      // declined" from "this step merely carried reasoning";
      // `shouldContinueAfterStreamStep` only reads state, so asking twice has
      // no side effects, and the cheap conditions short-circuit ahead of it.
      const declinedRecoveryForExposedReasoning = hasExposedReasoning &&
        !recoveredInterruptedLocalToolBatch &&
        step + 1 < maxSteps &&
        streamedToolCalls.some(isInterruptedClientToolCall) &&
        shouldContinueAfterStreamStep(state, { recoverInterruptedToolCalls: true });
      if (declinedRecoveryForExposedReasoning) {
        logger.warn("Declined interrupted local tool batch recovery after exposed reasoning", {
          step,
          toolName: streamedToolCalls.find(isInterruptedClientToolCall)?.name,
          reasoningPartCount: state.reasoningParts.filter(isPersistedReasoningPart).length,
        });
      }
      const assistantMessage = buildStreamedAssistantMessage({
        ...state,
        accumulatedText: recoveryPresentationText,
      }, {
        id: `msg_${Date.now()}_${step}`,
        timestamp: Date.now(),
      }, {
        preserveRecoverablePlaceholderToolCalls: shouldRecoverInterruptedLocalToolBatch ||
          !shouldContinue,
      });
      attachProviderMetadata(
        assistantMessage,
        reconcileSuppressedProviderMetadata(
          languageModel,
          state.providerMetadata,
          state.suppressedToolCalls,
          state.toolCalls.size > 0,
        ),
      );

      for (const tc of state.toolCalls.values()) {
        const materialized = materializeStreamedToolCall(tc);

        if (materialized.kind === "incomplete" && isRecoverablePlaceholderToolCall(tc)) {
          // Provisional empty-object placeholder that never finalized. The
          // model never committed arguments. Preserve it when recovery or
          // terminalization records a matching tool result; otherwise the
          // assistant message builder can omit it beside final text. Surface no
          // input warning or error for the provisional fragment.
          continue;
        }

        if (materialized.kind === "incomplete") {
          // Stream terminated before the provider emitted the finalizing
          // `tool-call` event for this block. The model never committed this
          // tool use. Surface the failure via SSE so the live client can
          // react, and leave the partial fragment under `inputText` in the
          // persisted part above so the history is replayable and transparent.
          logger.warn("Streamed tool call terminated before tool-call event", {
            toolCallId: tc.id,
            toolName: tc.name,
            partialArgumentsLength: materialized.partialArgumentsLength,
            partialArgumentsPreview: materialized.partialArgumentsPreview,
          });
          if (tc.inputAnnounced === true) {
            const dynamicIncomplete = isDynamicTool(tc.name);
            sendSSE(controller, encoder, {
              type: "tool-input-error",
              toolCallId: tc.id,
              errorText: `Stream terminated before tool-call event fired for "${tc.name}". ` +
                `Received ${materialized.partialArgumentsLength} chars of partial tool-input deltas.`,
              ...(dynamicIncomplete ? { dynamic: true } : {}),
            });
          }
        } else if (materialized.kind === "parse-error") {
          logger.warn("Failed to parse streamed tool arguments", {
            toolCallId: tc.id,
            error: materialized.parseError,
          });
        }
      }

      const stepAssistantText = getTextFromParts(assistantMessage.parts);
      if (
        step === interruptedLocalToolBatchRecoveryStep &&
        suppressedRecoveryReplayTextLength > 0
      ) {
        latestAssistantText = `${previousRecoveryText}${recoveryPresentationText}`;
      } else if (
        step === interruptedLocalToolBatchRecoveryStep && interruptedRecoveryPrefixLength > 0
      ) {
        latestAssistantText = previousRecoveryText.startsWith(state.accumulatedText)
          ? previousRecoveryText
          : state.accumulatedText;
      } else if (
        hasSubstantiveAssistantText(stepAssistantText) ||
        step !== interruptedLocalToolBatchRecoveryStep
      ) {
        latestAssistantText = stepAssistantText;
      }
      currentMessages.push(assistantMessage);
      await persistMessage(assistantMessage);
      await persistProviderReplayCheckpointAfterTurn({
        emission: providerReplayCheckpointEmission,
        providerMetadata: readAttachedProviderMetadata(assistantMessage),
      });

      const persistToolResult = async (toolResult: StreamingToolResult): Promise<void> => {
        if (currentStepToolResults.has(toolResult.toolCallId)) {
          return;
        }

        const toolResultMessage = createToolResultMessage(
          toolResult.toolCallId,
          toolResult.toolName,
          toolResult.error === undefined
            ? toolResult.output
            : { error: stringifyToolError(toolResult.error) },
          toolResult.providerExecuted === true,
        );
        currentMessages.push(toolResultMessage);
        await persistMessage(toolResultMessage);
        currentStepToolResults.set(
          toolResult.toolCallId,
          toolResultMessage.parts[0] as ToolResultPart,
        );
      };

      const recordIncompleteLocalToolError = async (
        toolCall: StreamingToolCall,
        options: { includeInResponse?: boolean; announceInput?: boolean } = {},
      ): Promise<boolean> => {
        if (
          toolCall.providerExecuted === true ||
          !isStreamedToolCallIncomplete(toolCall) ||
          finalToolResults.has(toolCall.id)
        ) {
          return false;
        }
        if (options.announceInput === true) {
          // An interrupted call never reached `tool-input-end`, so its
          // `tool-input-start` is still buffered and `inputAnnounced` is false
          // — which would suppress the `tool-output-error` below. Every
          // terminal path passes `announceInput`, because on all of them the
          // run stops here and the client would otherwise be left with
          // whatever preceded the truncation and then nothing at all. Which
          // path declined recovery — exposed reasoning, a spent step budget, a
          // second interruption, an exposed sibling — is invisible to the
          // user, so it must not decide whether the failure renders (#3737).
          //
          // The name is safe to publish here. `tool-call` is what can supersede
          // a name, and it also sets `inputAvailable`, which fails the guard
          // above — so reaching this line means no such event arrived and the
          // buffered name is the only one this call will ever have. It is the
          // same name recorded below and in the persisted assistant message,
          // so the card matches a reload. Announcing is idempotent, so a call
          // surfaced upstream is not reported twice.
          announceStreamedToolCallInput(controller, encoder, toolCall);
        }
        const incompleteToolCall: ToolCall = {
          id: toolCall.id,
          name: toolCall.name,
          args: {},
          ...(toolCall.arguments.length > 0 ? { inputText: toolCall.arguments } : {}),
          status: "pending",
        };
        await this.recordToolError(
          persistMessage,
          incompleteToolCall,
          `Stream terminated before tool-call event fired for "${toolCall.name}". ` +
            `Received ${toolCall.arguments.length} chars of partial tool-input deltas.`,
          controller,
          encoder,
          currentMessages,
          toolCalls,
          {
            emitSse: toolCall.inputAnnounced === true,
            includeInResponse: options.includeInResponse,
          },
        );
        return true;
      };

      if (!shouldContinue) {
        for (const toolResult of finalToolResults.values()) {
          await persistToolResult(toolResult);
        }
        for (const toolCall of streamedToolCalls) {
          // Terminal. Every incomplete local call recorded here is also
          // terminalized into history, so announce unconditionally and let the
          // wire carry the same failure. `recordIncompleteLocalToolError`
          // guards on `providerExecuted`, completeness and a final result, so
          // only genuinely truncated local calls are announced, and
          // `announceStreamedToolCallInput` is idempotent for any already
          // surfaced upstream.
          await recordIncompleteLocalToolError(toolCall, { announceInput: true });
        }
        sendSSE(controller, encoder, { type: "step-end" });
        completedWithinStepBudget = !exhaustedStepBudgetDuringInterruptedLocalToolRecovery;
        break;
      }

      this.status = "tool_execution";
      if (shouldRecoverInterruptedLocalToolBatch) {
        // Treat parallel local calls as one batch. Executing the finalized
        // prefix here could apply only part of the model's intended mutation.
        recoveredInterruptedLocalToolBatch = true;
        interruptedLocalToolBatchRecoveryStep = step + 1;
        interruptedLocalToolBatchRecoveryText = hasSubstantiveAssistantText(stepAssistantText)
          ? stepAssistantText
          : undefined;
      }

      for (const tc of streamedToolCalls) {
        throwIfAborted(abortSignal);
        if (shouldRecoverInterruptedLocalToolBatch && tc.providerExecuted !== true) {
          if (await recordIncompleteLocalToolError(tc, { includeInResponse: false })) {
            continue;
          }
          const capturedInput = captureStreamedToolCallInput(tc);
          const interruptedBatchToolCall: ToolCall = {
            id: tc.id,
            name: tc.name,
            args: capturedInput.args,
            ...(capturedInput.inputText ? { inputText: capturedInput.inputText } : {}),
            status: "pending",
          };
          await this.recordToolError(
            persistMessage,
            interruptedBatchToolCall,
            "Tool execution skipped because another tool call in the same model step " +
              "was interrupted before its input completed.",
            controller,
            encoder,
            currentMessages,
            toolCalls,
          );
          continue;
        }
        if (isRecoverablePlaceholderToolCall(tc)) {
          // Provisional empty-object placeholder that never finalized. If the
          // bounded recovery path was unavailable, do not execute or surface
          // it as a committed call.
          continue;
        }
        if (await recordIncompleteLocalToolError(tc)) {
          // Stream ended before the provider finalized this tool call. We
          // cannot execute it, so record a distinct stream-termination error
          // (not a tool-argument parse error) so the parent step and any
          // upstream orchestrator (e.g. the child-fork watchdog) see a
          // completed step with a clearly-labelled failure and can recover.
          continue;
        }
        const capturedInput = captureStreamedToolCallInput(tc);
        const toolCall: ToolCall = {
          id: tc.id,
          name: tc.name,
          args: capturedInput.args,
          ...(capturedInput.inputText ? { inputText: capturedInput.inputText } : {}),
          status: "pending",
        };
        const matchingResult = finalToolResults.get(tc.id);
        const persistedResult = currentStepToolResults.get(tc.id);

        if (matchingResult) {
          await persistToolResult(matchingResult);
          toolCall.status = matchingResult.error === undefined ? "completed" : "error";
          toolCall.result = matchingResult.output;
          toolCall.error = matchingResult.error === undefined
            ? undefined
            : stringifyToolError(matchingResult.error);
          toolCalls.push(toolCall);

          if (matchingResult.error === undefined) {
            if (shouldHideProjectToolAfterAgentWriteSuccess(tc.name)) {
              agentWriteFinalResponseToolGuardEnabled = true;
            }
            if (tc.name === LOAD_SKILL_TOOL_ID) {
              skillState.applySuccessfulResult(matchingResult.output);
            }
            const submittedFormInput = isSubmittedFormInputExecutionResult(
              tc.name,
              matchingResult.output,
            );
            skillState.markFormInputSubmitted(submittedFormInput);
            if (submittedFormInput) {
              currentRuntimeContext = markSubmittedFormInputRuntimeContext(currentRuntimeContext);
            }
          }
          continue;
        }

        if (persistedResult) {
          const persistedError = getToolResultError(persistedResult.result);
          toolCall.status = persistedError === undefined ? "completed" : "error";
          toolCall.result = persistedResult.result;
          toolCall.error = persistedError;
          toolCalls.push(toolCall);
          if (persistedError === undefined) {
            if (shouldHideProjectToolAfterAgentWriteSuccess(tc.name)) {
              agentWriteFinalResponseToolGuardEnabled = true;
            }
            if (tc.name === LOAD_SKILL_TOOL_ID) {
              skillState.applySuccessfulResult(persistedResult.result);
            }
            const submittedFormInput = isSubmittedFormInputExecutionResult(
              tc.name,
              persistedResult.result,
            );
            skillState.markFormInputSubmitted(submittedFormInput);
            if (submittedFormInput) {
              currentRuntimeContext = markSubmittedFormInputRuntimeContext(currentRuntimeContext);
            }
          }
          continue;
        }

        if (tc.providerExecuted === true) {
          await traceProviderExecutedTool({
            mode: "stream",
            agentId: this.id,
            toolName: tc.name,
            toolCallId: tc.id,
            context: {
              toolCallId: tc.id,
              ...toolContext,
              agentId: this.id,
            },
            args: toolCall.args,
          });
          toolCall.status = "completed";
          toolCalls.push(toolCall);
          continue;
        }

        if (capturedInput.parseError) {
          logger.warn("Invalid streamed tool arguments", {
            toolCallId: tc.id,
            error: capturedInput.parseError,
          });

          const dynamic = isDynamicTool(tc.name);
          sendSSE(controller, encoder, {
            type: "tool-input-error",
            toolCallId: tc.id,
            errorText: `Invalid tool arguments: ${capturedInput.parseError}`,
            ...(dynamic ? { dynamic: true } : {}),
          });

          await this.recordToolError(
            persistMessage,
            toolCall,
            `Invalid tool arguments: ${capturedInput.parseError}`,
            controller,
            encoder,
            currentMessages,
            toolCalls,
          );
          continue;
        }

        if (isFrameworkToolSearch(tc.name, effectiveToolExposurePlan)) {
          let checkpoint: ToolExposureCheckpoint;
          try {
            callbacks?.onToolCall?.(toolCall);
            const search = executeFrameworkToolSearch({
              args: toolCall.args,
              plan: effectiveToolExposurePlan,
              state: toolExposureState,
            });
            if (didReloadProjectAgentWriteTool(search.result)) {
              agentWriteFinalResponseToolGuardEnabled = false;
            }
            toolCall.status = "completed";
            toolCall.result = search.result;
            toolCalls.push(toolCall);
            setOtelActiveSpanAttributes({
              "tool.search.result_count": search.result.resultCount,
              "tool.search.loaded_count": search.result.loadedCount,
              "tool.search.miss": search.result.miss,
            });
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: toolCall.id,
              output: search.result,
            });
            const toolResultMessage = createToolResultMessage(tc.id, tc.name, search.result);
            currentMessages.push(toolResultMessage);
            await persistMessage(toolResultMessage);
            checkpoint = search.checkpoint;
            currentStepToolResults.set(tc.id, toolResultMessage.parts[0] as ToolResultPart);
          } catch (error) {
            await this.recordToolError(
              persistMessage,
              toolCall,
              error instanceof Error ? error.message : String(error),
              controller,
              encoder,
              currentMessages,
              toolCalls,
            );
            continue;
          }
          await persistToolExposureCheckpointBeforeContinuation({
            checkpoint,
            persist: persistToolExposureCheckpoint,
            required: requireToolExposureCheckpointPersistence,
          });
          continue;
        }

        const executionAuthority = resolveToolExecutionAuthority({
          toolName: tc.name,
          plan: effectiveToolExposurePlan,
        });
        if (executionAuthority === undefined) {
          await this.recordToolError(
            persistMessage,
            toolCall,
            toolNotVisibleError(tc.name),
            controller,
            encoder,
            currentMessages,
            toolCalls,
          );
          continue;
        }
        const policyCheck = enforceSkillPolicy(
          tc.name,
          {
            activeSkillId: skillState.activeSkillId,
            hasSubmittedFormInput: skillState.hasSubmittedFormInput,
            skillToolAvailability: skillState.activeSkillToolAvailability,
            toolInput: toolCall.args,
          },
        );
        if (!policyCheck.allowed) {
          await this.recordToolError(
            persistMessage,
            toolCall,
            policyCheck.error,
            controller,
            encoder,
            currentMessages,
            toolCalls,
          );
          continue;
        }

        try {
          toolCall.status = "executing";
          const startTime = Date.now();
          toolCall.args = applySkillDelegationOverridesToToolInput(
            tc.name,
            toolCall.args,
            skillState.activeSkillDelegationOverrides,
            resolveConfiguredTool(this.config.tools, tc.name, { agentId: this.id }) ?? undefined,
          );

          callbacks?.onToolCall?.(toolCall);

          const executionContext = {
            toolCallId: tc.id,
            ...toolContext,
            // Caller identity for capability scoping. Stamped after the
            // spread so caller-supplied context cannot spoof it.
            agentId: this.id,
          };
          const result = await traceConfiguredToolExecution({
            mode: "stream",
            agentId: this.id,
            toolName: tc.name,
            toolCallId: tc.id,
            args: toolCall.args,
            toolsConfig: this.config.tools,
            context: executionContext,
            allowedRemoteToolNames,
            remoteToolSources,
            sourceIntegrationPolicy,
          });
          throwIfAborted(abortSignal);
          await this.notifyToolResult({
            mode: "stream",
            toolName: tc.name,
            toolCallId: tc.id,
            input: toolCall.args,
            result,
            context: executionContext,
          });

          const resultError = getToolResultError(result);
          toolCall.status = resultError === undefined ? "completed" : "error";
          toolCall.result = result;
          toolCall.error = resultError;
          toolCall.executionTime = Date.now() - startTime;
          toolCalls.push(toolCall);

          if (resultError === undefined) {
            // Track skill policy from successful load_skill results
            if (tc.name === LOAD_SKILL_TOOL_ID) {
              skillState.applySuccessfulResult(result);
            }
            const submittedFormInput = isSubmittedFormInputExecutionResult(tc.name, result);
            skillState.markFormInputSubmitted(submittedFormInput);
            if (submittedFormInput) {
              currentRuntimeContext = markSubmittedFormInputRuntimeContext(currentRuntimeContext);
            }
            if (shouldHideProjectToolAfterAgentWriteSuccess(tc.name)) {
              agentWriteFinalResponseToolGuardEnabled = true;
            }
          }

          const dynamic = isDynamicTool(tc.name);
          if (resultError === undefined) {
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: toolCall.id,
              output: result,
              ...(dynamic ? { dynamic: true } : {}),
            });
          } else {
            sendSSE(controller, encoder, {
              type: "tool-output-error",
              toolCallId: toolCall.id,
              errorText: resultError,
              ...(dynamic ? { dynamic: true } : {}),
            });
          }

          const toolResultMessage = createToolResultMessage(tc.id, tc.name, result);
          if (!currentStepToolResults.has(tc.id)) {
            currentMessages.push(toolResultMessage);
            await persistMessage(toolResultMessage);
            currentStepToolResults.set(tc.id, toolResultMessage.parts[0] as ToolResultPart);
          }
        } catch (error) {
          const errorStr = error instanceof Error ? error.message : String(error);
          await this.recordToolError(
            persistMessage,
            toolCall,
            errorStr,
            controller,
            encoder,
            currentMessages,
            toolCalls,
          );
        }
      }

      for (const toolResult of finalToolResults.values()) {
        await persistToolResult(toolResult);
      }

      if (state.suppressedToolCalls.length > 0) {
        const unavailableNames = [
          ...new Set(state.suppressedToolCalls.map((toolCall) => toolCall.name)),
        ];
        currentMessages.push(
          markRuntimeGeneratedUserMessage({
            id: `runtime_note_${Date.now()}_${step}`,
            role: "user",
            parts: [{
              type: "text",
              text: `Runtime recovery: ignored unavailable tool call(s): ${
                unavailableNames.join(", ")
              }. Continue using only currently available tools: ${runtimeToolNames.join(", ")}.`,
            }],
            timestamp: Date.now(),
          }),
        );
      }

      throwIfAborted(abortSignal);
      sendSSE(controller, encoder, { type: "step-end" });
      this.status = "thinking";
    }

    if (!completedWithinStepBudget) {
      // Step-budget exhaustion mirrors the generate loop's max-steps exit: the
      // partial result is still returned, so the structured-output parse is
      // best effort and a failure is surfaced in metadata instead of thrown.
      const parsedOutput = await tryParseMaxStepsOutput(
        latestAssistantText,
        outputSchema,
      );
      return attachOutputSchemaParser({
        text: latestAssistantText,
        ...(parsedOutput.parsed ? { object: parsedOutput.object } : {}),
        messages: currentMessages,
        toolCalls,
        status: "completed",
        usage: totalUsage,
        metadata: withAgentRunRuntimeContextMetadata(runRuntimeContext, {
          warning: `Max steps (${maxSteps}) reached`,
          ...(finalFinishReason ? { finishReason: finalFinishReason } : {}),
          ...(!parsedOutput.parsed && parsedOutput.outputSchemaError !== undefined
            ? { outputSchemaError: parsedOutput.outputSchemaError }
            : {}),
        }),
      }, outputSchema);
    }

    return attachOutputSchemaParser({
      text: latestAssistantText,
      ...(outputSchema ? { object: await outputSchema.parseOutput(latestAssistantText) } : {}),
      messages: currentMessages,
      toolCalls,
      status: "completed",
      usage: totalUsage,
      metadata: withAgentRunRuntimeContextMetadata(
        runRuntimeContext,
        finalFinishReason ? { finishReason: finalFinishReason } : undefined,
      ),
    }, outputSchema);
  }

  /**
   * Record a tool error and send SSE event.
   */
  private async recordToolError(
    persistMessage: (message: Message) => Promise<void>,
    toolCall: ToolCall,
    errorStr: string,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    currentMessages: Message[],
    toolCalls: ToolCall[],
    options: { emitSse?: boolean; includeInResponse?: boolean } = {},
  ): Promise<void> {
    toolCall.status = "error";
    toolCall.error = errorStr;
    if (options.includeInResponse !== false) {
      toolCalls.push(toolCall);
    }

    if (options.emitSse !== false) {
      const dynamic = isDynamicTool(toolCall.name);
      sendSSE(controller, encoder, {
        type: "tool-output-error",
        toolCallId: toolCall.id,
        errorText: errorStr,
        ...(dynamic ? { dynamic: true } : {}),
      });
    }

    const errorMessage = createToolErrorMessage(
      toolCall.id,
      toolCall.name,
      errorStr,
    );
    currentMessages.push(errorMessage);
    await persistMessage(errorMessage);
  }

  /**
   * Resolve system prompt (handle string or function)
   */
  private async resolveSystemPrompt(providerOptionKey?: string): Promise<AgentSystem> {
    const { system } = this.config;
    if (system === undefined) return "You are a helpful assistant.";
    return await resolveAgentSystem(system, providerOptionKey);
  }

  /**
   * Compute max steps considering edge config and platform limits.
   */
  private computeMaxSteps(platformLimit: number): number {
    const edgeMaxSteps = this.config.edge?.enabled ? this.config.edge.maxSteps : undefined;
    return getMaxSteps(this.config.maxSteps, edgeMaxSteps, platformLimit);
  }

  private resolveTemperature(
    modelString?: string,
    providerOptions?: Record<string, unknown>,
  ): number | undefined {
    return resolveTemperatureParameter(
      modelString,
      this.config.temperature,
      DEFAULT_TEMPERATURE,
      providerOptions,
    );
  }

  private resolveMaxOutputTokens(modelString?: string, maxOutputTokensOverride?: number): number {
    if (
      typeof maxOutputTokensOverride === "number" &&
      Number.isFinite(maxOutputTokensOverride) &&
      maxOutputTokensOverride > 0
    ) {
      return Math.floor(maxOutputTokensOverride);
    }

    // A disabled memory config contributes nothing, exactly like omitting
    // `memory`, so its maxTokens (a conversation-window size) must not cap
    // model output.
    const memoryMaxTokens = this.config.memory?.enabled === false
      ? undefined
      : this.config.memory?.maxTokens;
    return memoryMaxTokens ??
      (modelString ? getModelMaxOutputTokens(modelString) : undefined) ??
      DEFAULT_MAX_TOKENS;
  }

  /**
   * Get memory instance (for advanced use cases)
   */
  getMemory(): Memory<Message> {
    return this.memory;
  }

  /**
   * Get memory stats
   */
  async getMemoryStats(): Promise<{
    totalMessages: number;
    estimatedTokens: number;
    type: string;
  }> {
    return this.memory.getStats();
  }

  /**
   * Clear agent memory
   */
  async clearMemory(): Promise<void> {
    await this.memory.clear();
  }
}

type ProviderMetadataReconciler = (input: {
  providerMetadata: Record<string, unknown>;
  suppressedToolCalls: readonly { id: string; name: string }[];
}) => Record<string, unknown> | undefined;

/**
 * Best-effort structured-output parse for the max-steps exit.
 *
 * The normal completion path is fail-loud, but a run cut off by the step limit
 * still returns its partial result. A parse or validation failure here must not
 * throw that result away, so the failure is captured as `outputSchemaError` for
 * the response metadata instead of being swallowed.
 */
type MaxStepsOutputParse =
  | {
    /** The configured schema parsed successfully, even if its transform returned undefined. */
    parsed: true;
    object: unknown;
  }
  | {
    /** No schema was configured, or the configured schema rejected the output. */
    parsed: false;
    outputSchemaError?: string;
  };

async function tryParseMaxStepsOutput(
  finalText: string,
  outputSchema: ResolvedAgentOutputSchema | undefined,
): Promise<MaxStepsOutputParse> {
  if (!outputSchema) return { parsed: false };
  try {
    return { parsed: true, object: await outputSchema.parseOutput(finalText) };
  } catch (error) {
    return {
      parsed: false,
      outputSchemaError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Text of the latest assistant message, or empty when no assistant turn exists. */
function getFinalAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant") {
      return getTextFromParts(message.parts);
    }
  }
  return "";
}

function reconcileSuppressedProviderMetadata(
  modelRuntime: ModelRuntime,
  providerMetadata: Record<string, unknown> | undefined,
  suppressedToolCalls: readonly { id: string; name: string }[],
  hasSurvivingToolCalls: boolean,
): Record<string, unknown> | undefined {
  if (providerMetadata === undefined || suppressedToolCalls.length === 0) {
    return providerMetadata;
  }

  const reconcile = modelRuntime._reconcileProviderMetadata;
  if (typeof reconcile !== "function") {
    return undefined;
  }

  const reconciled = (reconcile as ProviderMetadataReconciler).call(modelRuntime, {
    providerMetadata,
    suppressedToolCalls,
  });
  if (reconciled === undefined) {
    if (!hasSurvivingToolCalls) {
      return undefined;
    }
    throw new TypeError(
      "Model runtime did not preserve provider metadata for surviving tool calls",
    );
  }
  if (
    reconciled === null ||
    typeof reconciled !== "object" ||
    Array.isArray(reconciled)
  ) {
    throw new TypeError(
      "Model runtime returned invalid provider metadata after suppressing a tool call",
    );
  }
  return reconciled;
}
