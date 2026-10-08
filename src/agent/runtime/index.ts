import { runWithToolCallOccurrenceDispatch } from "#veryfront/runtime/tool-call-occurrence.ts";
import {
  observeAdmittedAgentToolCalls,
  observeGeneratedAgentMessage,
  observeGeneratedAgentTurn,
  observeRuntimeStream,
  withLocalChildRuntime,
} from "../composition/local-child-execution.ts";
import { forEachSequential } from "./sequential.ts";
import {
  type AgentManualPause,
  agentManualPauseBoundary,
  type AgentPauseCheckpoint,
  isAgentManualPauseBoundary,
  parseAgentPauseCheckpoint,
} from "./manual-pause.ts";
import { getAgentRuntimeToolCallPart } from "./message-adapter.ts";
import {
  admitTerminalDispatch,
  createTerminalRunControl,
  isTerminalRunControlError,
  isTerminalRunToolName,
  terminalCompletionResponse,
  terminalDispatchRecord,
  terminalReceiptPersistenceFailure,
} from "./terminal-run-control.ts";
import {
  appendPrivateArray,
  concatPrivateArrays,
  filterPrivateArray,
  flatMapPrivateArray,
  forEachPrivateArray,
  mapPrivateArray,
  pushPrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import {
  createPrivateTextDecoder,
  encodePrivateText,
  PrivateTextEncoder,
  privateTextSlice,
  privateTextStartsWith,
  privateTextTrim,
} from "#veryfront/security/private-text.ts";
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

import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import {
  createPrivateReadableStream,
  enqueuePrivateStream,
} from "#veryfront/security/private-stream.ts";

import { chainPrivatePromise, createPrivateDeferred } from "#veryfront/security/private-promise.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
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
import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED, isVeryfrontError } from "#veryfront/errors";
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
import { setActiveSpanAttributes as setOtelActiveSpanAttributes } from "#veryfront/observability/tracing/otlp-setup.ts";
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
  getRuntimeUnavailableOptionalRemoteTools,
} from "./mcp-server-tool-sources.ts";
import { runWithRuntimeRemoteToolSources } from "./remote-tool-source-context.ts";
import {
  hasRuntimeObservationCapability,
  type RuntimeObservationCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";

import {
  announceStreamedToolCallInput,
  createRuntimeStreamSource,
  createStreamState,
  processStream,
  resolveRelayableExecutionFailure,
  resolveRuntimeExecutionErrorEvent,
  type StreamingToolCall,
  type StreamingToolResult,
  withRuntimeProviderStreamErrorProvenance,
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
import type { Tool, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import {
  isLocalModelRuntime,
  supportsModelRuntimeToolCalling,
} from "#veryfront/provider/runtime-inspection.ts";
import { generateText, streamText } from "#veryfront/runtime/runtime-bridge.ts";
import { resolveAgentSystem } from "./effective-agent-system.ts";
import {
  resolveActiveProviderReplayProvider,
  resolveRuntimeGenAiProviderName,
} from "./provider-replay-protocol.ts";
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
  EMPTY_RESPONSE_RECOVERY_PROMPT,
  RuntimeEmptyResponseError,
} from "./empty-response-recovery.ts";
import {
  getProviderReplayInvokeAgentToolCallsSchema,
  getRuntimeAllowedRemoteTools,
  getRuntimeForwardedIntegrationToolDefs,
  getRuntimeProviderReplayCheckpointMessageId,
  getRuntimeProviderReplayCheckpointPersister,
  getRuntimeProviderReplayCheckpoints,
  getRuntimeProviderReplayCheckpointTurnComplete,
  getRuntimeProviderReplayCheckpointTurnFailed,
  getRuntimeProviderReplayInvokeAgentToolNames,
  getRuntimeProviderTools,
  getRuntimeSourceIntegrationPolicy,
  getRuntimeToolExposureCheckpoint,
  getRuntimeToolExposureCheckpointPersister,
  isRuntimeProviderReplayCheckpointPersistenceRequired,
  isRuntimeToolExposureCheckpointPersistenceRequired,
  type ProviderReplayInvokeAgentToolCall,
  type ProviderReplayInvokeAgentToolName,
  type ProviderReplayTurnFailure,
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
import {
  summarizeErrorCausesForLog,
  telemetryErrorType,
} from "#veryfront/observability/telemetry-error.ts";
import { resolveTemperatureParameter } from "./model-capabilities.ts";
import {
  applySkillDelegationOverridesToToolInput,
  type SkillDelegationOverrides,
} from "./skill-delegation-overrides.ts";
import {
  type AgentModelRuntimeResolver,
  createModelRuntimeResolverAbortGuard,
  createModelRuntimeResolverAbortScope,
  resolveAgentModelTransport,
  type ResolvedModelTransport,
  revokeModelRuntimeResolver,
} from "./model-transport.ts";
import { createProjectRunInferenceModelResolver } from "./project-run-inference-credential.ts";
import { buildRuntimeUsageTraceAttributes, type RuntimeUsageTraceInput } from "./trace-usage.ts";
import {
  pickDefinedUsageFields,
  RUNTIME_USAGE_OPTIONAL_TAIL_FIELDS,
} from "#veryfront/provider/runtime-usage.ts";
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
import { createToolResultContext, type ToolResultContext } from "./tool-result-context.ts";
import { createModelToolResultContextMessages } from "./tool-result-context-messages.ts";
import { createAgentKnowledgeTool } from "#veryfront/agent/runtime/knowledge-tools.ts";
import {
  createToolResultReadDefinition,
  GET_TOOL_RESULT_TOOL_NAME,
  readToolResultContext,
} from "./tool-result-context-tools.ts";

const ArrayIsArray = Array.isArray;
const cloneStructuredValue = globalThis.structuredClone;
const IntrinsicWeakMap = WeakMap;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicStructuredClone = globalThis.structuredClone;
const PromiseThen = Promise.prototype.then;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectIs = Object.is;
const ObjectKeys = Object.keys;
const ObjectValues = Object.values;
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

function avoidsAmbientMessagePartField(part: MessagePart, key: string): boolean {
  // Keep structural proxy fields and custom prototype fields compatible while
  // excluding accessors installed on the shared Object prototype.
  if (!ObjectHasOwn(ObjectPrototype, key)) return true;
  let current: object | null = part;
  while (current !== null && current !== ObjectPrototype) {
    if (ObjectHasOwn(current, key)) return true;
    current = ObjectGetPrototypeOf(current);
  }
  return false;
}

function cloneKnownMessagePartFields(part: MessagePart): MessagePart {
  const detached = ObjectCreate(ObjectPrototype) as Record<string, unknown>;
  const source = part as Record<string, unknown>;
  for (const key of PROVIDER_VISIBLE_MESSAGE_PART_FIELDS) {
    let value: unknown;
    try {
      if (!avoidsAmbientMessagePartField(part, key)) continue;
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
      if (!avoidsAmbientMessagePartField(part, key)) continue;
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
  const timestamp = ObjectHasOwn(message, "timestamp") ? message.timestamp : undefined;
  const metadata = ObjectHasOwn(message, "metadata") ? message.metadata : undefined;
  const snapshot = {
    __proto__: null,
    id: message.id,
    role: message.role,
    parts,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(metadata === undefined
      ? {}
      : { metadata: cloneStructuredValuePreservingOpaque(metadata, true) }),
  };
  return snapshot;
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
        pushPrivateArray(fingerprints, fingerprint);
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
  const payload = createPrivateTextDecoder().decode(chunk);
  if (!privateTextStartsWith(payload, "data: ")) {
    return false;
  }

  try {
    const event = privateJsonParse(privateTextSlice(payload, "data: ".length)) as {
      type?: unknown;
    };
    return event.type === "text-start" || event.type === "text-delta" ||
      event.type === "text-end";
  } catch {
    return false;
  }
}

function isTextEndSseChunk(chunk: Uint8Array): boolean {
  const payload = createPrivateTextDecoder().decode(chunk);
  if (!privateTextStartsWith(payload, "data: ")) {
    return false;
  }

  try {
    const event = privateJsonParse(privateTextSlice(payload, "data: ".length)) as {
      type?: unknown;
    };
    return event.type === "text-end";
  } catch {
    return false;
  }
}

function textDeltaFromSseChunk(chunk: Uint8Array): string | undefined {
  const payload = createPrivateTextDecoder().decode(chunk);
  if (!privateTextStartsWith(payload, "data: ")) {
    return undefined;
  }

  try {
    const event = privateJsonParse(privateTextSlice(payload, "data: ".length)) as Record<
      string,
      unknown
    >;
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
    text: privateTextSlice(text, consumedLength),
    remainingPrefixLength: remainingPrefixLength - consumedLength,
  };
}

function stripTextDeltaPrefixFromSseChunk(
  chunk: Uint8Array,
  remainingPrefixLength: number,
  encoder: TextEncoder,
): { chunk: Uint8Array | undefined; remainingPrefixLength: number } {
  const payload = createPrivateTextDecoder().decode(chunk);
  if (!privateTextStartsWith(payload, "data: ")) {
    return { chunk, remainingPrefixLength };
  }

  try {
    const event = privateJsonParse(privateTextSlice(payload, "data: ".length)) as Record<
      string,
      unknown
    >;
    if (event.type !== "text-delta" || typeof event.delta !== "string") {
      return { chunk, remainingPrefixLength };
    }
    const stripped = stripLeadingText(event.delta, remainingPrefixLength);
    if (stripped.text.length === 0) {
      return { chunk: undefined, remainingPrefixLength: stripped.remainingPrefixLength };
    }
    return {
      chunk: encodePrivateText(
        `data: ${privateJsonStringify({ ...event, delta: stripped.text })}\n\n`,
        encoder,
      ),
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
  const payload = createPrivateTextDecoder().decode(chunk);
  if (!privateTextStartsWith(payload, "data: ")) {
    return chunk;
  }

  try {
    const event = privateJsonParse(privateTextSlice(payload, "data: ".length)) as Record<
      string,
      unknown
    >;
    if (
      event.type !== "text-start" && event.type !== "text-delta" &&
      event.type !== "text-end"
    ) {
      return chunk;
    }
    const id = typeof event.id === "string" && event.id.length > 0
      ? `${event.id}:recovery`
      : fallbackId;
    return encodePrivateText(`data: ${privateJsonStringify({ ...event, id })}\n\n`, encoder);
  } catch {
    return chunk;
  }
}

function buildGeneratedAssistantMessage(
  response: RuntimeGenerateTextResult,
  metadata: { id: string; timestamp: number },
): Message {
  const parts: MessagePart[] = [];
  if (response.text) pushPrivateArray(parts, { type: "text", text: response.text });
  const responseToolCalls = response.toolCalls ?? [];
  for (let index = 0; index < responseToolCalls.length; index++) {
    if (!ObjectHasOwn(responseToolCalls, index)) continue;
    const toolCall = responseToolCalls[index]!;
    pushPrivateArray(parts, {
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
  const query = typeof input.args.query === "string" ? privateTextTrim(input.args.query) : "";
  if (!query) {
    throw new Error('tool_search requires a non-empty "query" string');
  }
  const result: ToolSearchResult = searchToolExposure({
    query,
    authorized: input.plan.deferred,
    available: filterPrivateArray(
      input.plan.visible,
      (tool) => tool.name !== TOOL_SEARCH_TOOL_NAME,
    ),
    state: input.state,
    maxLoadedTools: input.plan.maxLoadedTools,
  });
  const alreadyVisible =
    filterPrivateArray(result.matches, (match) => match.status === "available")[0];
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
  complete:
    | ((invokeAgentToolCalls?: ProviderReplayInvokeAgentToolCall[]) => void | Promise<void>)
    | undefined;
  invokeAgentToolNames: ReadonlySet<ProviderReplayInvokeAgentToolName>;
  fail: ((failure?: ProviderReplayTurnFailure) => void | Promise<void>) | undefined;
  failed: boolean;
  required: boolean;
};

function resolveRuntimeProviderReplayCheckpointEmission(
  config: AgentConfig,
): RuntimeProviderReplayCheckpointEmission {
  const messageId = getRuntimeProviderReplayCheckpointMessageId(config);
  const checkpoints = getRuntimeProviderReplayCheckpoints(config);
  let existingCheckpoint: ProviderReplayCheckpoint | undefined;
  if (messageId && checkpoints) {
    for (let index = 0; index < checkpoints.length; index++) {
      if (!ObjectHasOwn(checkpoints, index)) continue;
      const checkpoint = checkpoints[index];
      if (checkpoint?.messageId === messageId) {
        existingCheckpoint = checkpoint;
        break;
      }
    }
  }
  return {
    state: messageId
      ? createProviderReplayCheckpointEmissionState({ messageId, existingCheckpoint })
      : undefined,
    persist: getRuntimeProviderReplayCheckpointPersister(config),
    complete: getRuntimeProviderReplayCheckpointTurnComplete(config),
    invokeAgentToolNames: createPrivateSet(getRuntimeProviderReplayInvokeAgentToolNames(config)),
    fail: getRuntimeProviderReplayCheckpointTurnFailed(config),
    failed: false,
    required: isRuntimeProviderReplayCheckpointPersistenceRequired(config),
  };
}

async function failProviderReplayCheckpointTurn(
  emission: RuntimeProviderReplayCheckpointEmission,
  failure?: ProviderReplayTurnFailure,
): Promise<void> {
  if (emission.failed) return;
  emission.failed = true;
  await emission.fail?.(failure);
}

async function persistProviderReplayCheckpointAfterTurn(input: {
  emission: RuntimeProviderReplayCheckpointEmission;
  providerMetadata: Record<string, unknown> | undefined;
  invokeAgentToolCalls?: ProviderReplayInvokeAgentToolCall[];
  deferCompletion?: boolean;
}): Promise<void> {
  try {
    await persistProviderReplayCheckpointAfterTurnUnsafe(input);
  } catch (error) {
    await failProviderReplayCheckpointTurn(
      input.emission,
      resolveProviderReplayPersistenceFailure(error),
    );
    throw error;
  }
}

/**
 * Attribute a checkpoint persistence failure to Veryfront, not to the provider.
 *
 * Only the curated title and code of our own durable-run-event error cross the
 * boundary; anything else falls back to the relay's neutral default.
 */
function resolveProviderReplayPersistenceFailure(
  error: unknown,
): ProviderReplayTurnFailure | undefined {
  if (
    !isVeryfrontError(error) ||
    error.slug !== DURABLE_RUN_EVENT_PERSISTENCE_FAILED.slug
  ) {
    return undefined;
  }
  return {
    message: error.title,
    code: "DURABLE_RUN_EVENT_PERSISTENCE_FAILED",
  };
}

async function persistProviderReplayCheckpointAfterTurnUnsafe(input: {
  emission: RuntimeProviderReplayCheckpointEmission;
  providerMetadata: Record<string, unknown> | undefined;
  invokeAgentToolCalls?: ProviderReplayInvokeAgentToolCall[];
  deferCompletion?: boolean;
}): Promise<void> {
  if (!input.emission.state) {
    if (input.emission.required) {
      throw DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({
        detail: "provider replay checkpoint message identity is required",
      });
    }
    if (input.deferCompletion !== true) {
      await input.emission.complete?.(input.invokeAgentToolCalls);
    }
    return;
  }
  const checkpoint = captureProviderReplayCheckpoint(
    input.emission.state,
    input.providerMetadata,
  );
  if (!checkpoint) {
    if (input.deferCompletion !== true) {
      await input.emission.complete?.(input.invokeAgentToolCalls);
    }
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
  if (input.deferCompletion !== true) {
    await input.emission.complete?.(input.invokeAgentToolCalls);
  }
}

async function completeDeferredProviderReplayCheckpointTurn(
  emission: RuntimeProviderReplayCheckpointEmission,
  invokeAgentToolCalls: ProviderReplayInvokeAgentToolCall[] | undefined,
): Promise<void> {
  try {
    await emission.complete?.(invokeAgentToolCalls);
  } catch (error) {
    await failProviderReplayCheckpointTurn(
      emission,
      resolveProviderReplayPersistenceFailure(error),
    );
    throw error;
  }
}

type ProviderReplayDelegationArgsContext = {
  activeSkillDelegationOverrides: SkillDelegationOverrides | undefined;
  toolsConfig: AgentConfig["tools"];
  agentId: string;
  hasToolReplacements: boolean;
};

function applyProviderReplayDelegationOverrides(
  toolName: string,
  args: Record<string, unknown>,
  context: ProviderReplayDelegationArgsContext,
): Record<string, unknown> {
  if (toolName !== "invoke_agent") return args;
  return applySkillDelegationOverridesToToolInput(
    toolName,
    args,
    context.hasToolReplacements ? undefined : context.activeSkillDelegationOverrides,
    context.hasToolReplacements
      ? undefined
      : resolveConfiguredTool(context.toolsConfig, toolName, { agentId: context.agentId }) ??
        undefined,
  );
}

function collectGeneratedParallelInvokeAgentToolCalls(
  toolCalls: RuntimeGenerateTextResult["toolCalls"],
  toolResults: ReadonlyMap<string, RuntimeGenerateToolResult>,
  allowedToolNames: ReadonlySet<ProviderReplayInvokeAgentToolName>,
  plan: ToolExposurePlan,
  delegationArgsContext: ProviderReplayDelegationArgsContext,
): ProviderReplayInvokeAgentToolCall[] | undefined {
  const calls: ProviderReplayInvokeAgentToolCall[] = [];
  if (!toolCalls) return undefined;
  for (let index = 0; index < toolCalls.length; index++) {
    if (!ObjectHasOwn(toolCalls, index)) continue;
    const toolCall = toolCalls[index];
    if (
      !toolCall ||
      !IntrinsicReflectApply(IntrinsicSetHas, allowedToolNames, [
        toolCall.toolName as ProviderReplayInvokeAgentToolName,
      ]) ||
      !isToolVisibleForStep(toolCall.toolName, plan) ||
      (!delegationArgsContext.hasToolReplacements && toolResults.has(toolCall.toolCallId)) ||
      !toolCall.input || typeof toolCall.input !== "object" || ArrayIsArray(toolCall.input)
    ) {
      continue;
    }
    const effectiveArgs = applyProviderReplayDelegationOverrides(
      toolCall.toolName,
      toolCall.input as Record<string, unknown>,
      delegationArgsContext,
    );
    pushPrivateArray(calls, {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName as ProviderReplayInvokeAgentToolName,
      toolArgsJson: privateJsonStringify(effectiveArgs),
    });
  }
  return calls.length >= 2 ? getProviderReplayInvokeAgentToolCallsSchema().parse(calls) : undefined;
}

function collectStreamedParallelInvokeAgentToolCalls(
  toolCalls: readonly StreamingToolCall[],
  toolResults: ReadonlyMap<string, StreamingToolResult>,
  allowedToolNames: ReadonlySet<ProviderReplayInvokeAgentToolName>,
  shouldContinue: boolean,
  plan: ToolExposurePlan,
  delegationArgsContext: ProviderReplayDelegationArgsContext,
): ProviderReplayInvokeAgentToolCall[] | undefined {
  if (!shouldContinue) return undefined;
  const calls: ProviderReplayInvokeAgentToolCall[] = [];
  for (let index = 0; index < toolCalls.length; index++) {
    if (!ObjectHasOwn(toolCalls, index)) continue;
    const toolCall = toolCalls[index];
    if (
      !toolCall || toolCall.inputAvailable !== true || toolCall.providerExecuted === true ||
      !isToolVisibleForStep(toolCall.name, plan) ||
      toolResults.has(toolCall.id) ||
      !IntrinsicReflectApply(IntrinsicSetHas, allowedToolNames, [
        toolCall.name as ProviderReplayInvokeAgentToolName,
      ])
    ) {
      continue;
    }
    const materialized = materializeStreamedToolCall(toolCall);
    if (materialized.kind !== "complete") continue;
    const args = "args" in materialized.part ? materialized.part.args : {};
    const effectiveArgs = applyProviderReplayDelegationOverrides(
      toolCall.name,
      args,
      delegationArgsContext,
    );
    pushPrivateArray(calls, {
      toolCallId: toolCall.id,
      toolName: toolCall.name as ProviderReplayInvokeAgentToolName,
      toolArgsJson: privateJsonStringify(effectiveArgs),
    });
  }
  return calls.length >= 2 ? getProviderReplayInvokeAgentToolCallsSchema().parse(calls) : undefined;
}

type SameTurnSkillDelegationOrder = "prefix" | "interleaved" | undefined;

function generatedSameTurnSkillDelegationOrder(
  toolCalls: RuntimeGenerateTextResult["toolCalls"],
  toolResults: ReadonlyMap<string, RuntimeGenerateToolResult>,
  allowedToolNames: ReadonlySet<ProviderReplayInvokeAgentToolName>,
): SameTurnSkillDelegationOrder {
  let sawDelegation = false;
  let sawSkillAfterDelegation = false;
  let sawSkillBeforeDelegation = false;
  let sawOtherToolBeforeDelegation = false;
  for (let index = 0; index < (toolCalls?.length ?? 0); index++) {
    if (!ObjectHasOwn(toolCalls!, index)) continue;
    const toolCall = toolCalls![index]!;
    if (toolResults.has(toolCall.toolCallId)) continue;
    if (toolCall.toolName === LOAD_SKILL_TOOL_ID) {
      if (sawDelegation) sawSkillAfterDelegation = true;
      else sawSkillBeforeDelegation = true;
      continue;
    }
    if (
      IntrinsicReflectApply(IntrinsicSetHas, allowedToolNames, [
        toolCall.toolName as ProviderReplayInvokeAgentToolName,
      ])
    ) {
      if (sawSkillAfterDelegation) return "interleaved";
      sawDelegation = true;
    } else if (!sawDelegation) {
      sawOtherToolBeforeDelegation = true;
    }
  }
  if (!sawSkillBeforeDelegation || !sawDelegation) return undefined;
  // A deferred boundary holds every forwarded tool end, so another tool that
  // runs before the delegations (for example one that waits on the host)
  // could never complete. Keep that turn on the sequential path.
  return sawOtherToolBeforeDelegation ? "interleaved" : "prefix";
}

function streamedSameTurnSkillDelegationOrder(
  toolCalls: readonly StreamingToolCall[],
  toolResults: ReadonlyMap<string, StreamingToolResult>,
  allowedToolNames: ReadonlySet<ProviderReplayInvokeAgentToolName>,
): SameTurnSkillDelegationOrder {
  let sawDelegation = false;
  let sawSkillAfterDelegation = false;
  let sawSkillBeforeDelegation = false;
  let sawOtherToolBeforeDelegation = false;
  for (let index = 0; index < toolCalls.length; index++) {
    if (!ObjectHasOwn(toolCalls, index)) continue;
    const toolCall = toolCalls[index]!;
    if (toolCall.inputAvailable !== true) continue;
    // Execution folds a streamed load_skill result in call order, so a completed
    // skill call still orders its overrides relative to the delegations.
    if (toolCall.name === LOAD_SKILL_TOOL_ID) {
      if (sawDelegation) sawSkillAfterDelegation = true;
      else sawSkillBeforeDelegation = true;
      continue;
    }
    if (toolCall.providerExecuted === true || toolResults.has(toolCall.id)) continue;
    if (
      IntrinsicReflectApply(IntrinsicSetHas, allowedToolNames, [
        toolCall.name as ProviderReplayInvokeAgentToolName,
      ])
    ) {
      if (sawSkillAfterDelegation) return "interleaved";
      sawDelegation = true;
    } else if (!sawDelegation) {
      sawOtherToolBeforeDelegation = true;
    }
  }
  if (!sawSkillBeforeDelegation || !sawDelegation) return undefined;
  // A deferred boundary holds every forwarded tool end, so another tool that
  // runs before the delegations (for example one that waits on the host)
  // could never complete. Keep that turn on the sequential path.
  return sawOtherToolBeforeDelegation ? "interleaved" : "prefix";
}

function isToolVisibleForStep(toolName: string, plan: ToolExposurePlan): boolean {
  return intrinsicArraySome(plan.visible, (tool) => tool.name === toolName);
}

function isFrameworkToolSearch(toolName: string, plan: ToolExposurePlan): boolean {
  return toolName === TOOL_SEARCH_TOOL_NAME &&
    isToolVisibleForStep(toolName, plan) &&
    !intrinsicArraySome(plan.authorized, (tool) => tool.name === toolName);
}

function hasToolResultContextEnabled(
  config: Pick<AgentConfig, "toolResultContext">,
): boolean {
  return config.toolResultContext === true ||
    (typeof config.toolResultContext === "object" && config.toolResultContext !== null);
}

function createActiveToolResultContext(input: {
  config: Pick<AgentConfig, "toolResultContext">;
  hasToolReplacements?: boolean;
  supportsToolCalling?: boolean;
}): ToolResultContext | undefined {
  if (
    input.supportsToolCalling === false || input.hasToolReplacements ||
    !hasToolResultContextEnabled(input.config)
  ) {
    return undefined;
  }
  return createToolResultContext({
    limits: typeof input.config.toolResultContext === "object" &&
        input.config.toolResultContext !== null
      ? input.config.toolResultContext
      : undefined,
  });
}

function toolResultReaderHasNameConflict(plan: ToolExposurePlan): boolean {
  return intrinsicArraySome(plan.authorized, (tool) => tool.name === GET_TOOL_RESULT_TOOL_NAME) ||
    intrinsicArraySome(plan.visible, (tool) => tool.name === GET_TOOL_RESULT_TOOL_NAME) ||
    intrinsicArraySome(plan.deferred, (tool) => tool.name === GET_TOOL_RESULT_TOOL_NAME);
}

function canExposeToolResultReader(input: {
  plan: ToolExposurePlan;
  context: ToolResultContext | undefined;
}): boolean {
  return input.context !== undefined &&
    input.context.size > 0 &&
    !toolResultReaderHasNameConflict(input.plan);
}

function assertToolResultReaderNameAvailable(input: {
  plan: ToolExposurePlan;
  context: ToolResultContext | undefined;
}): void {
  if (input.context === undefined || !toolResultReaderHasNameConflict(input.plan)) {
    return;
  }
  throw new Error(toolResultReaderUnavailableError());
}

function withToolResultReaderTool(
  tools: readonly ToolDefinition[],
  exposeReader: boolean,
): ToolDefinition[] {
  const visible = mapPrivateArray(tools, (tool) => tool);
  if (exposeReader) pushPrivateArray(visible, createToolResultReadDefinition());
  return visible;
}

function getRequiredToolResultReaderNames(exposeReader: boolean): readonly string[] | undefined {
  return exposeReader ? [GET_TOOL_RESULT_TOOL_NAME] : undefined;
}

function shouldHandleToolResultRead(input: {
  toolName: string;
  plan: ToolExposurePlan;
  context: ToolResultContext | undefined;
}): boolean {
  return input.toolName === GET_TOOL_RESULT_TOOL_NAME &&
    input.context !== undefined &&
    input.context.size > 0 &&
    !toolResultReaderHasNameConflict(input.plan);
}

function shouldBlockToolResultReadName(input: {
  toolName: string;
  context: ToolResultContext | undefined;
}): boolean {
  return input.toolName === GET_TOOL_RESULT_TOOL_NAME &&
    input.context !== undefined &&
    input.context.size > 0;
}

function toolResultReaderUnavailableError(): string {
  return `Tool "${GET_TOOL_RESULT_TOOL_NAME}" is reserved for framework tool-result references but cannot be used because another tool with that name is in scope`;
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
    ...pickDefinedUsageFields(usage, RUNTIME_USAGE_OPTIONAL_TAIL_FIELDS),
  };
}

function getResponseFinishReason(response: AgentResponse): string | undefined {
  const finishReason = response.metadata?.finishReason;
  return typeof finishReason === "string" && finishReason.length > 0 ? finishReason : undefined;
}

const agentWriteArraySort = Array.prototype.sort;
const agentWriteApply = Reflect.apply;

const AGENT_WRITE_FINAL_RESPONSE_EXCLUDED_TOOL_NAMES = createPrivateSet([
  "create_agent",
  "update_agent",
]);

function shouldHideProjectToolAfterAgentWriteSuccess(toolName: string): boolean {
  return AGENT_WRITE_FINAL_RESPONSE_EXCLUDED_TOOL_NAMES.has(toolName);
}

function didReloadProjectAgentWriteTool(result: ToolSearchResult): boolean {
  return somePrivateArray(
    result.matches,
    (match) => match.status === "loaded" && shouldHideProjectToolAfterAgentWriteSuccess(match.name),
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
    const guardedTools = filterPrivateArray(plan.authorized, (tool) => !keep(tool));
    const visible = filterPrivateArray(plan.visible, keep);
    const deferredByName = createPrivateMap<string, ToolExposurePlan["deferred"][number]>();
    const deferredTools = concatPrivateArrays(plan.deferred, guardedTools);
    for (let index = 0; index < deferredTools.length; index++) {
      const tool = deferredTools[index]!;
      deferredByName.set(tool.name, tool);
    }
    if (
      guardedTools.length > 0 &&
      !somePrivateArray(visible, (tool) => tool.name === TOOL_SEARCH_TOOL_NAME)
    ) {
      pushPrivateArray(visible, createToolSearchDefinition());
    }
    return {
      ...plan,
      visible: agentWriteApply(agentWriteArraySort, visible, [compareToolNames]),
      deferred: agentWriteApply(agentWriteArraySort, [...deferredByName.values()], [
        compareToolNames,
      ]),
    };
  }
  return {
    ...plan,
    authorized: filterPrivateArray(plan.authorized, keep),
    visible: filterPrivateArray(plan.visible, keep),
    deferred: filterPrivateArray(plan.deferred, keep),
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
    return privateJsonParse(result);
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
  return somePrivateArray(
    ObjectValues(normalized),
    (value) => containsSubmittedFormInputExecutionResult(value, depth + 1),
  );
}

function isSubmittedFormInputExecutionResult(toolName: string, result: unknown): boolean {
  return toolName === FORM_INPUT_TOOL_ID && containsSubmittedFormInputExecutionResult(result);
}

type RuntimeTraceAttributes = Record<string, string | number | boolean | undefined | null>;

function estimateSerializedSizeBytes(value: unknown): number | undefined {
  try {
    const serialized = typeof value === "string" ? value : privateJsonStringify(value);
    if (serialized === undefined) return undefined;
    return utf8ByteLength(serialized);
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

const freezeAdmitted = Object.freeze;
const ownContextKeys = Reflect.ownKeys;
const contextDescriptor = Object.getOwnPropertyDescriptor;
const defineContextProperty = Object.defineProperty;
const readContextProperty = Reflect.get;

function applicationExecutionContext(
  context: ToolExecutionContext | undefined,
): ToolExecutionContext {
  const projected: ToolExecutionContext = {};
  if (!context) return projected;
  forEachPrivateArray(ownContextKeys(context), (key) => {
    if (key === "toolCallId" || key === "agentId") return;
    if (!contextDescriptor(context, key)?.enumerable) return;
    defineContextProperty(projected, key, {
      value: readContextProperty(context, key),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  return projected;
}

interface AdmittedToolTurn {
  readonly start: number;
  readonly calls: readonly {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }[];
}

function snapshotAdmittedToolTurn(message: Message, start: number): AdmittedToolTurn {
  const calls = flatMapPrivateArray(message.parts, (part) => {
    const call = getAgentRuntimeToolCallPart(part);
    return call
      ? [freezeAdmitted({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: cloneStructuredValuePreservingOpaque(call.input),
      })]
      : [];
  });
  return freezeAdmitted({ start, calls: freezeAdmitted(calls) });
}

function findAdmittedToolResult(
  messages: Message[],
  turn: AdmittedToolTurn,
  callId: string,
): ToolResultPart | undefined {
  for (let index = turn.start; index < messages.length; index++) {
    let result: ToolResultPart | undefined;
    const found = somePrivateArray(messages[index]!.parts, (part) => {
      if (part.type !== "tool-result" || part.toolCallId !== callId) return false;
      result = part as ToolResultPart;
      return true;
    });
    if (found) return result;
  }
  return undefined;
}

function createRuntimeFrameworkLocalTools(config: AgentConfig): Record<string, Tool> | undefined {
  const knowledgeTool = config.tools === true ? createAgentKnowledgeTool(config) : undefined;
  return knowledgeTool === undefined ? undefined : { search_knowledge: knowledgeTool };
}

async function traceConfiguredToolExecution(input: {
  mode: "generate" | "stream";
  agentId: string;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  admittedTurn: AdmittedToolTurn;
  owner: Message[];
  prepareTerminalDispatch: () => Promise<void>;
  toolsConfig: true | Record<string, ToolConfigEntry> | undefined;
  context: ToolExecutionContext;
  allowedRemoteToolNames: string[] | undefined;
  remoteToolSources: ReturnType<typeof getRuntimeRemoteToolSources>;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest | undefined;
  strictConfiguredToolsOnly?: boolean;
  frameworkLocalTools?: Record<string, Tool>;
}): Promise<unknown> {
  admitTerminalDispatch(input.context, {
    callId: input.toolCallId,
    callName: input.toolName,
    agentId: input.agentId,
    turn: input.admittedTurn,
    owner: input.owner,
  }, input.prepareTerminalDispatch);
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
              {
                strictConfiguredToolsOnly: input.strictConfiguredToolsOnly,
                frameworkLocalTools: input.frameworkLocalTools,
              },
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
  if (isTerminalRunControlError(error)) return false;
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
  /** Framework-owned continuation and pause capability for this exact dispatch. */
  manualPause?: AgentManualPause;
  resolveModelRuntime?: AgentModelRuntimeResolver;
  /** Preserve the factory caller's prevalidated catalog without implicit tools or delegates. */
  preserveToolCatalog?: boolean;
  /** Call controls for private models, independent of source transport hooks. */
  modelCallThinking?: RuntimeReasoningOption & { enabled: boolean };
  /** Observe original producer settlement before it starts, including its full cleanup. */
  onStreamCompletion?: (completion: Promise<void>) => void;
  /** Exact pending tool invocation trusted by the hosted control plane. */
  resumeToolCall?: { id: string; name: string; input: Record<string, unknown> };
  /** Host-owned authority required before context can request private runtime observations. */
  runtimeObservationCapability?: RuntimeObservationCapability;
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
  /**
   * Fires after every model call with the run's usage accumulated so far.
   *
   * A run that dies mid-stream never reaches {@link onFinish}, so callers that
   * report spend (billing, tracing) need the running total instead of waiting
   * for a final response that may never arrive.
   */
  onUsage?: (usage: RuntimeUsageTraceInput) => void;
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
  #manualPause: AgentManualPause | undefined;
  #modelResolverState: AgentRuntimeModelResolverState;
  #modelCallThinking: AgentRuntimeInternalOptions["modelCallThinking"];
  #onStreamCompletion: AgentRuntimeInternalOptions["onStreamCompletion"];
  #resumeToolCall: AgentRuntimeInternalOptions["resumeToolCall"];
  #runtimeObservationCapability: AgentRuntimeInternalOptions["runtimeObservationCapability"];
  private id: string;
  private config: AgentConfig;
  private memory: Memory<Message>;
  private status: AgentStatus = "idle";

  constructor(
    id: string,
    config: AgentConfig,
    internalOptions: AgentRuntimeInternalOptions = {},
  ) {
    // TypeScript private methods remain writable prototype properties at runtime.
    // Own captured operations keep project prototype hooks out of private turns,
    // while preserving public dispatch and existing custom memory behavior.
    for (let index = 0; index < agentRuntimePrivateMethodNames.length; index++) {
      const name = agentRuntimePrivateMethodNames[index]!;
      const descriptor = {
        __proto__: null,
        value: agentRuntimePrivateMethods[name]!.value,
      };
      ObjectDefineProperty(this, name, descriptor);
    }
    this.#modelCallThinking = internalOptions.modelCallThinking;
    this.#manualPause = internalOptions.manualPause;
    this.#onStreamCompletion = internalOptions.onStreamCompletion;
    this.#resumeToolCall = internalOptions.resumeToolCall;
    this.#runtimeObservationCapability = internalOptions.runtimeObservationCapability;
    this.#modelResolverState = internalOptions.resolveModelRuntime
      ? { status: "available", resolver: internalOptions.resolveModelRuntime }
      : { status: "absent" };
    this.id = id;
    this.config = { ...config };
    if (ObjectGetPrototypeOf(config) === null) ObjectSetPrototypeOf(this.config, null);

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
    const history = mapPrivateArray(await this.memory.getMessages(), cloneMessageForCommit);
    applyProviderReplayCheckpointsToMessages(
      concatPrivateArrays(history, inputMessages),
      checkpoints,
    );
  }

  private prepareTurnMessages(
    inputMessages: Message[],
    context?: AgentContext,
    abortSignal?: AbortSignal,
  ): Promise<{
    messages: Message[];
    addMessage: (message: Message) => Promise<void>;
    prepareTerminalDispatch: () => Promise<void>;
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
    const task = chainPrivatePromise(awaitAbortable(predecessor, abortSignal), async () => {
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
    const finalized = chainPrivatePromise(task, ({ finalized }) => finalized, () => undefined);
    // Cancellation releases this caller, not the preceding turn's queue slot.
    // Later turns must still wait until that predecessor has finalized.
    this.#turnCommitQueue = chainPrivatePromise(predecessor, () => finalized);
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
    prepareTerminalDispatch: () => Promise<void>;
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
      finalization ??= chainPrivatePromise(transaction, async (prepared) => {
        try {
          await prepared.commit();
        } catch (error) {
          rejection = { error: terminalReceiptPersistenceFailure(error, abortSignal) };
          validationState = "rejected";
          throw rejection.error;
        }
      });
      await finalization;
    };
    const rollback = async (): Promise<void> => {
      if (transaction === undefined) return;
      if (finalization !== undefined) {
        // The original caller observes commit or rollback errors. Cleanup must
        // still finish so streaming can report that error and close replay state.
        await chainPrivatePromise(finalization, () => undefined, () => undefined);
        return;
      }
      finalization = chainPrivatePromise(
        transaction,
        (prepared) => prepared.rollback(),
        () => undefined,
      );
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
        return chainPrivatePromise(transaction, ({ messages }) => messages);
      },
      commit,
      prepareTerminalDispatch: async () => {
        if (rejection) throw rejection.error;
        if (validationState !== "accepted") {
          throw new Error("Terminal dispatch requires an accepted turn");
        }
        try {
          await persistence.persist();
          await (await transaction!).prepareTerminalDispatch();
        } catch (error) {
          rejection = { error: terminalReceiptPersistenceFailure(error, abortSignal) };
          validationState = "rejected";
          await rollback();
          throw rejection.error;
        }
      },
      addMessage: async (message: Message) => {
        if (rejection) throw rejection.error;
        try {
          await persistence.persist();
          await (await transaction!).addMessage(message);
        } catch (error) {
          rejection = { error: terminalReceiptPersistenceFailure(error, abortSignal) };
          validationState = "rejected";
          await rollback();
          throw rejection.error;
        }
      },
      finalize: () => validationState === "accepted" ? commit() : rollback(),
      validationState: () => validationState,
      validateProviderRequest: async (providerSystem: AgentSystem, messages: Message[]) => {
        if (rejection) throw rejection.error;
        try {
          await getTurnProviderRequestValidator(context)?.(providerSystem, messages);
        } catch (error) {
          rejection = { error: terminalReceiptPersistenceFailure(error, abortSignal) };
          validationState = "rejected";
          await rollback();
          throw rejection.error;
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
    prepareTerminalDispatch: () => Promise<void>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    finalized: Promise<void>;
  }> {
    const committedInputMessages = mapPrivateArray(inputMessages, (message) => {
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
    let memoryTransaction =
      validateTurnMessages || validateProjectedMessages || validateProviderRequest
        ? await beginMemoryTransaction(this.memory)
        : undefined;
    let turnMemory = memoryTransaction ?? this.memory;
    let validated = committedInputMessages;
    let history: Message[] = [];
    let persisted: Message[];
    try {
      if (validateTurnMessages || validateProjectedMessages || validateProviderRequest) {
        history = await turnMemory.getMessages();
        if (history.length > 0) validated = concatPrivateArrays(history, committedInputMessages);
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
        validated = mapPrivateArray(validated, (message) => {
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
      for (let index = 0; index < committedInputMessages.length; index++) {
        await turnMemory.add(committedInputMessages[index]!);
      }
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
    const finalization = createPrivateDeferred<void>();
    return {
      messages: persisted.length > 0 ? persisted : committedInputMessages,
      addMessage: (message) => turnMemory.add(message),
      prepareTerminalDispatch: async () => {
        // Preserve validated admission before a terminal transport can commit.
        // Keep the turn queue held while receipts use a fresh transaction.
        if (
          this.memory instanceof NoMemory ||
          typeof this.memory.beginTransaction !== "function"
        ) return;
        if (isFinalized) throw new Error("Cannot dispatch a finalized turn");
        if (memoryTransaction) {
          await memoryTransaction.commit();
          memoryTransaction = undefined;
        }
        memoryTransaction = await beginMemoryTransaction(this.memory);
        turnMemory = memoryTransaction;
      },
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
    // A project-run execution scopes a signed inference credential to its
    // calls; an agent built without its own resolver draws one fresh resolver
    // from that scope per call, consumed and revoked like any private resolver.
    const projectRunResolver = resolverState.status === "absent"
      ? createProjectRunInferenceModelResolver()
      : undefined;
    const resolveModelRuntime = resolverState.status === "available"
      ? resolverState.resolver
      : projectRunResolver;
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
          modelCallThinking: this.#modelCallThinking,
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
    const structuredSystem = ArrayIsArray(systemPrompt) ? systemPrompt : undefined;
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
      messages: mapPrivateArray(messages, (message) => message),
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
    return withRuntimeTurnLineage(
      this,
      () => withLocalChildRuntime(this, () => this.#generateWithinTurn(...args)),
    );
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
    const outputSchema = this.resolveOutputSchema(options?.outputSchema);
    const terminalControl = createTerminalRunControl(
      context,
      abortSignal,
      outputSchema ? (output) => outputSchema.parseOutput(privateJsonStringify(output)) : undefined,
    );
    abortSignal = terminalControl.signal;
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
                    async (message) => {
                      await turnPersistence.addMessage(message);
                      await observeGeneratedAgentMessage(message);
                    },
                    turnPersistence.prepareTerminalDispatch,
                    {
                      ...terminalControl.binding,
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
              } catch (error) {
                const terminalResponse = terminalCompletionResponse(
                  error,
                  outputSchema !== undefined,
                );
                if (!terminalResponse) throw error;
                this.status = "completed";
                return attachOutputSchemaParser(terminalResponse, outputSchema);
              } finally {
                abortGuard.revoke();
              }
            },
          );
        } catch (error) {
          try {
            await turnPersistence.finalize();
            if (isAgentManualPauseBoundary(error)) this.#manualPause?.persisted?.(true);
          } catch (finalizationError) {
            if (isAgentManualPauseBoundary(error)) this.#manualPause?.persisted?.(false);
            throw finalizationError;
          }
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
        // A cancellation keeps the relay's neutral default: only a real
        // failure hands the relay the sanitized provider cause.
        // Same rule as the stream path: the relay writes a public RunError, so
        // only curated diagnostics cross it. A persistence failure keeps the
        // neutral boundary message rather than exposing its own text.
        const relayFailure = isAbortError(error, abortSignal)
          ? undefined
          : resolveRelayableExecutionFailure(error);
        await failProviderReplayCheckpointTurn(providerReplayCheckpointEmission, relayFailure);
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
    return withRuntimeTurnLineage(
      this,
      () => withLocalChildRuntime(this, () => this.#streamWithinTurn(...args)),
    );
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
    const callerAbortSignal = abortSignal;
    const outputSchema = this.resolveOutputSchema(options?.outputSchema);
    const terminalControl = createTerminalRunControl(
      context,
      abortSignal,
      outputSchema ? (output) => outputSchema.parseOutput(privateJsonStringify(output)) : undefined,
    );
    abortSignal = terminalControl.signal;
    const runRuntimeContext = captureAgentRunRuntimeContext();
    const runtimeObservationsEnabled = context?.runtimeObservations === true &&
      hasRuntimeObservationCapability(this.#runtimeObservationCapability);
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
      const requestedModel = transport.requestedModel;
      const resolvedModelString = transport.resolvedModelString;
      debugRuntimeModelRemap(requestedModel, resolvedModelString);

      const inputMessages = normalizeInput(messages);

      const systemPrompt = await this.resolveSystemPrompt(transport.providerOptionKey);

      const encoder = new PrivateTextEncoder();
      const streamAbortSignal = abortScope.signal;
      const streamCacheCtx = tryGetCacheKeyContext();
      const toolContext = {
        ...terminalControl.binding,
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

      const completion = createPrivateDeferred<void>();
      // The observer is optional; retain cleanup failure without an unhandled rejection.
      void chainPrivatePromise(completion.promise, () => {}, () => {});
      this.#onStreamCompletion?.(completion.promise);
      const runtimeStream = createPrivateReadableStream<Uint8Array>({
        start: async (controller) => {
          let streamedResponseText = "";
          let terminalCompleted = false;
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
              ...(runtimeObservationsEnabled
                ? {
                  privateRuntimeObservation: {
                    version: 1,
                    kind: "execution_entry",
                    occurrenceId: crypto.randomUUID(),
                  },
                }
                : {}),
            });
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
                      async (message) => {
                        await turnPersistence.addMessage(message);
                        await observeAdmittedAgentToolCalls(message);
                      },
                      turnPersistence.prepareTerminalDispatch,
                      controller,
                      encoder,
                      streamingCallbacks,
                      textPartId,
                      toolContext,
                      context,
                      runRuntimeContext,
                      runtimeObservationsEnabled,
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
                } catch (error) {
                  const terminalResponse = terminalCompletionResponse(
                    error,
                    outputSchema !== undefined,
                  );
                  if (!terminalResponse) throw error;
                  terminalCompleted = true;
                  this.status = "completed";
                  return attachOutputSchemaParser(terminalResponse, outputSchema);
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
            throwIfAborted(terminalCompleted ? callerAbortSignal : streamAbortSignal);
            if (
              response.text.length > 0 && (terminalCompleted || streamedResponseText.length === 0)
            ) {
              const responseTextId = terminalCompleted ? generateId("text") : textPartId;
              sendSSE(controller, encoder, { type: "text-start", id: responseTextId });
              sendSSE(controller, encoder, {
                type: "text-delta",
                id: responseTextId,
                delta: response.text,
              });
              callbacks?.onChunk?.(response.text);
              sendSSE(controller, encoder, { type: "text-end", id: responseTextId });
            }
            callbacks?.onFinish?.(response);
            throwIfAborted(terminalCompleted ? callerAbortSignal : streamAbortSignal);

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
            if (isAgentManualPauseBoundary(streamError)) {
              try {
                await turnPersistence.finalize();
                this.#manualPause?.persisted?.(true);
              } catch (finalizationError) {
                this.#manualPause?.persisted?.(false);
                logger.debug("Manual pause memory finalization failed", {
                  errorCauses: summarizeErrorCausesForLog(finalizationError),
                });
              }
              sendSSE(controller, encoder, { type: "data-veryfront.manual_pause", data: {} });
              closeSSEStream(controller);
              return;
            }
            let error = streamError;
            try {
              await turnPersistence.finalize();
            } catch (finalizationError) {
              error = finalizationError;
            }
            // Resolve the sanitized event first so the replay relay fails with
            // the same cause the stream reports, instead of a manufactured one.
            // A cancellation is not a provider failure: it keeps the relay's
            // neutral default rather than surfacing the raw abort reason.
            const aborted = isAbortError(
              error,
              terminalCompleted ? callerAbortSignal : streamAbortSignal,
            );
            const errorEvent = aborted ? undefined : resolveRuntimeExecutionErrorEvent(error);
            // The relay writes a PUBLIC RunError, so it takes only curated
            // diagnostics -- a persistence failure's raw message can carry
            // internal detail the SSE fallback path is allowed to show but a
            // durable client-visible error is not.
            const relayFailure = aborted ? undefined : resolveRelayableExecutionFailure(error);
            try {
              await failProviderReplayCheckpointTurn(
                providerReplayCheckpointEmission,
                relayFailure,
              );
            } catch (failureHookError) {
              logger.debug("Provider replay failure hook rejected", {
                error: failureHookError,
              });
            }
            if (!errorEvent) {
              closeSSEStream(controller);
              return;
            }

            this.status = "error";
            // A provider stream failure keeps its cause private, so the log
            // names the wrapped failures explicitly (bounded and redacted).
            const errorCauses = summarizeErrorCausesForLog(error);
            logger.error("Agent stream error", {
              error,
              ...(errorCauses ? { errorCauses } : {}),
            });
            sendSSE(controller, encoder, errorEvent);
            closeSSEStream(controller);
          } finally {
            let disposed = false;
            try {
              abortScope.dispose();
              disposed = true;
            } catch (cleanupError) {
              this.#manualPause?.persisted?.(false);
              completion.reject(cleanupError);
            } finally {
              if (disposed) completion.resolve();
            }
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
      return observeRuntimeStream(runtimeStream);
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
    prepareTerminalDispatch: () => Promise<void>,
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
      const currentMessages = mapPrivateArray(messages, (message) => message);
      applyProviderReplayCheckpointsToMessages(
        currentMessages,
        getRuntimeProviderReplayCheckpoints(this.config),
        { activeProvider: resolveActiveProviderReplayProvider(languageModel) },
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
      const frameworkLocalTools = hasToolReplacements
        ? undefined
        : createRuntimeFrameworkLocalTools(this.config);
      const toolLoadingResolution = resolveRuntimeToolLoading(this.config);
      const runConfig: RuntimeToolFilterConfig = {
        ...this.config,
        __vfToolLoadingMode: hasToolReplacements ? "eager" : toolLoadingResolution.mode,
      };
      if (ObjectGetPrototypeOf(this.config) === null) ObjectSetPrototypeOf(runConfig, null);
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
      if (ObjectGetPrototypeOf(this.config) === null) ObjectSetPrototypeOf(runtimeStepConfig, null);
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
      const unavailableOptionalRemoteTools = hasToolReplacements
        ? { names: [], prefixes: [] }
        : getRuntimeUnavailableOptionalRemoteTools(this.config, remoteToolSources);
      const sourceIntegrationPolicy = hasToolReplacements
        ? undefined
        : getRuntimeSourceIntegrationPolicy(this.config);
      const configuredProviderTools = hasToolReplacements
        ? []
        : getRuntimeProviderTools(this.config);
      const toolResultContext = createActiveToolResultContext({
        config: this.config,
        hasToolReplacements,
        supportsToolCalling,
      });
      const providerTools = sourceIntegrationPolicy
        ? applySourceIntegrationPolicy(configuredProviderTools, sourceIntegrationPolicy)
        : configuredProviderTools;
      let currentSystemPrompt = systemPrompt;
      let currentRuntimeContext = runtimeContext;
      let agentWriteFinalResponseToolGuardEnabled = false;
      let recoveredEmptyResponse = false;

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
          unavailableOptionalRemoteToolNames: unavailableOptionalRemoteTools.names,
          unavailableOptionalRemoteToolPrefixes: unavailableOptionalRemoteTools.prefixes,
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
          frameworkLocalTools,
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
        assertToolResultReaderNameAvailable({
          plan: effectiveToolExposurePlan,
          context: toolResultContext,
        });
        const modelMessages = toolResultContext
          ? createModelToolResultContextMessages(currentMessages, toolResultContext)
          : currentMessages;
        const exposeToolResultReader = canExposeToolResultReader({
          plan: effectiveToolExposurePlan,
          context: toolResultContext,
        });
        const tools = withToolResultReaderTool(
          effectiveToolExposurePlan.visible,
          exposeToolResultReader,
        );
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
          requiredToolNames: getRequiredToolResultReaderNames(exposeToolResultReader),
        });
        currentSystemPrompt = withIntegrationToolDiscoveryStatus(
          synchronizeRuntimeToolInventory(
            currentSystemPrompt,
            runtimeTools,
            agentWriteFinalResponseToolGuardEnabled
              ? filterPrivateArray(
                effectiveToolExposurePlan.deferred,
                (tool) => shouldHideProjectToolAfterAgentWriteSuccess(tool.name),
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
            modelMessages,
          );
          const result = await generateText({
            model: languageModel,
            system: providerSystemPrompt,
            messages: convertToTextGenerationRuntimeRequestMessages(modelMessages, {
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
            cacheCreation1hInputTokens: response.usage.cacheCreation1hInputTokens,
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

        const generatedToolResults = collectGeneratedToolResults(response.toolResults);
        const generatedInvokeAgentBatch = providerReplayCheckpointEmission.complete
          ? collectGeneratedParallelInvokeAgentToolCalls(
            response.toolCalls,
            generatedToolResults,
            providerReplayCheckpointEmission.invokeAgentToolNames,
            effectiveToolExposurePlan,
            {
              activeSkillDelegationOverrides: skillState.activeSkillDelegationOverrides,
              toolsConfig: runtimeToolsConfig,
              agentId: this.id,
              hasToolReplacements,
            },
          )
          : undefined;
        const generatedSkillDelegationOrder = generatedInvokeAgentBatch && !hasToolReplacements
          ? generatedSameTurnSkillDelegationOrder(
            response.toolCalls,
            generatedToolResults,
            providerReplayCheckpointEmission.invokeAgentToolNames,
          )
          : undefined;
        let generatedBatchCompletionDeferred = generatedSkillDelegationOrder === "prefix";
        const assistantMessage = buildGeneratedAssistantMessage(response, {
          id: `msg_${Date.now()}_${step}`,
          timestamp: Date.now(),
        });
        const admittedTurn = snapshotAdmittedToolTurn(assistantMessage, currentMessages.length);
        pushPrivateArray(currentMessages, assistantMessage);
        await persistMessage(assistantMessage);
        await observeGeneratedAgentTurn(assistantMessage.id, response);
        await persistProviderReplayCheckpointAfterTurn({
          emission: providerReplayCheckpointEmission,
          providerMetadata: readAttachedProviderMetadata(assistantMessage),
          invokeAgentToolCalls: generatedSkillDelegationOrder === "interleaved"
            ? undefined
            : generatedInvokeAgentBatch,
          deferCompletion: generatedBatchCompletionDeferred,
        });
        throwIfAborted(abortSignal);

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
          pushPrivateArray(currentMessages, toolResultMessage);
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
          pushPrivateArray(toolCalls, toolCall);
          const errorMessage = createToolErrorMessage(
            generatedToolResult.toolCallId,
            generatedToolResult.toolName,
            error,
          );
          pushPrivateArray(currentMessages, errorMessage);
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
          const stoppedEmptyAfterCompletedTool = response.finishReason === "stop" &&
            !hasSubstantiveAssistantText(response.text) &&
            generatedToolResults.size === 0 &&
            somePrivateArray(toolCalls, (toolCall) => toolCall.status === "completed");
          if (stoppedEmptyAfterCompletedTool) {
            if (recoveredEmptyResponse || step + 1 >= maxSteps) {
              throw new RuntimeEmptyResponseError();
            }
            recoveredEmptyResponse = true;
            pushPrivateArray(
              currentMessages,
              markRuntimeGeneratedUserMessage({
                id: `runtime_empty_response_${Date.now()}_${step}`,
                role: "user",
                parts: [{
                  type: "text",
                  text: EMPTY_RESPONSE_RECOVERY_PROMPT,
                }],
                timestamp: Date.now(),
              }),
            );
            continue;
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

        for (let toolCallIndex = 0; toolCallIndex < response.toolCalls.length; toolCallIndex++) {
          if (!ObjectHasOwn(response.toolCalls, toolCallIndex)) continue;
          const tc = response.toolCalls[toolCallIndex]!;
          throwIfAborted(abortSignal);
          const toolCall: ToolCall = {
            id: tc.toolCallId,
            name: tc.toolName,
            args: tc.input as Record<string, unknown>,
            status: "pending",
          };
          const generatedToolResult = generatedToolResults.get(tc.toolCallId);

          if (
            generatedBatchCompletionDeferred && generatedToolResult === undefined &&
            IntrinsicReflectApply(
              IntrinsicSetHas,
              providerReplayCheckpointEmission.invokeAgentToolNames,
              [tc.toolName as ProviderReplayInvokeAgentToolName],
            )
          ) {
            await completeDeferredProviderReplayCheckpointTurn(
              providerReplayCheckpointEmission,
              collectGeneratedParallelInvokeAgentToolCalls(
                response.toolCalls,
                generatedToolResults,
                providerReplayCheckpointEmission.invokeAgentToolNames,
                effectiveToolExposurePlan,
                {
                  activeSkillDelegationOverrides: skillState.activeSkillDelegationOverrides,
                  toolsConfig: runtimeToolsConfig,
                  agentId: this.id,
                  hasToolReplacements,
                },
              ),
            );
            generatedBatchCompletionDeferred = false;
          }

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
              generatedToolResult === undefined &&
              shouldHandleToolResultRead({
                toolName: tc.toolName,
                plan: effectiveToolExposurePlan,
                context: toolResultContext,
              })
            ) {
              try {
                if (toolResultContext === undefined) {
                  throw new ReferenceError("Tool result context is not available");
                }
                const result = readToolResultContext(toolResultContext, toolCall.args);
                toolCall.status = "completed";
                toolCall.result = result;
                setSpanAttributes(toolSpan, {
                  "tool.status": "completed",
                  "tool.output.size_bytes": estimateSerializedSizeBytes(result),
                });
                const toolResultMessage = createToolResultMessage(
                  tc.toolCallId,
                  tc.toolName,
                  result,
                );
                pushPrivateArray(currentMessages, toolResultMessage);
                await persistMessage(toolResultMessage);
              } catch (error) {
                toolCall.status = "error";
                toolCall.error = error instanceof Error ? error.message : String(error);
                const errorMessage = createToolErrorMessage(
                  tc.toolCallId,
                  tc.toolName,
                  toolCall.error,
                );
                pushPrivateArray(currentMessages, errorMessage);
                await persistMessage(errorMessage);
              }
              pushPrivateArray(toolCalls, toolCall);
              return;
            }
            if (
              generatedToolResult === undefined &&
              shouldBlockToolResultReadName({
                toolName: tc.toolName,
                context: toolResultContext,
              })
            ) {
              toolCall.status = "error";
              toolCall.error = toolResultReaderUnavailableError();
              const errorMessage = createToolErrorMessage(
                tc.toolCallId,
                tc.toolName,
                toolCall.error,
              );
              pushPrivateArray(currentMessages, errorMessage);
              await persistMessage(errorMessage);
              pushPrivateArray(toolCalls, toolCall);
              return;
            }
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
              pushPrivateArray(currentMessages, errorMessage);
              await persistMessage(errorMessage);
              pushPrivateArray(toolCalls, toolCall);
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
                pushPrivateArray(currentMessages, toolResultMessage);
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
                pushPrivateArray(currentMessages, errorMessage);
                await persistMessage(errorMessage);
                pushPrivateArray(toolCalls, toolCall);
                return;
              }
              await persistToolExposureCheckpointBeforeContinuation({
                checkpoint,
                persist: persistToolExposureCheckpoint,
                required: requireToolExposureCheckpointPersistence,
              });
              pushPrivateArray(toolCalls, toolCall);
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
              pushPrivateArray(toolCalls, toolCall);
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
              pushPrivateArray(currentMessages, errorMessage);
              await persistMessage(errorMessage);
              pushPrivateArray(toolCalls, toolCall);
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
              const executionContext = applicationExecutionContext(toolContext);
              executionContext.projectId = cacheCtx?.projectId ?? toolContext?.projectId;
              throwIfAborted(abortSignal);
              const result = await traceConfiguredToolExecution({
                mode: "generate",
                agentId: this.id,
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
                args: toolCall.args,
                admittedTurn,
                owner: currentMessages,
                prepareTerminalDispatch,
                toolsConfig: runtimeToolsConfig,
                context: executionContext,
                allowedRemoteToolNames,
                remoteToolSources,
                sourceIntegrationPolicy,
                strictConfiguredToolsOnly: hasToolReplacements,
                frameworkLocalTools,
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
              pushPrivateArray(currentMessages, toolResultMessage);
              await persistMessage(toolResultMessage);
            } catch (error) {
              await this.recordTerminalToolResult(
                error,
                toolCall,
                persistMessage,
                currentMessages,
                toolCalls,
                totalUsage,
              );
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
              pushPrivateArray(currentMessages, errorMessage);
              await persistMessage(errorMessage);
            }

            pushPrivateArray(toolCalls, toolCall);
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
    prepareTerminalDispatch: () => Promise<void>,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    callbacks: {
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
      onFinish?: (response: AgentResponse) => void;
      onUsage?: (usage: RuntimeUsageTraceInput) => void;
    } | undefined,
    textPartId: string | undefined,
    toolContextBase: Record<string, unknown> | undefined,
    runtimeContext: Record<string, unknown> | undefined,
    runRuntimeContext: AgentRunRuntimeContext,
    runtimeObservationsEnabled: boolean,
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

    const continuation = await this.#manualPause?.load();
    const checkpoint = continuation == null ? undefined : parseAgentPauseCheckpoint(continuation);
    if (checkpoint?.providerMetadata) {
      mapPrivateArray(checkpoint.messages, (message) => {
        const saved = filterPrivateArray(checkpoint.providerMetadata!, (entry) =>
          entry.messageId === message.id)[0];
        if (saved) {
          attachProviderMetadata(message, saved.metadata);
        }
      });
    }
    const toolCalls: ToolCall[] = checkpoint?.toolCalls ?? [];
    const currentMessages = mapPrivateArray(checkpoint?.messages ?? messages, (message) => message);
    const runtimeGeneratedMessageIds = createPrivateSet(
      checkpoint?.runtimeGeneratedMessageIds ?? [],
    );
    mapPrivateArray(currentMessages, (message) => {
      if (runtimeGeneratedMessageIds.has(message.id)) markRuntimeGeneratedUserMessage(message);
      return message;
    });
    applyProviderReplayCheckpointsToMessages(
      currentMessages,
      getRuntimeProviderReplayCheckpoints(this.config),
      { activeProvider: resolveActiveProviderReplayProvider(languageModel) },
    );
    const totalUsage = checkpoint?.usage ??
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    if (!supportsToolCalling && this.config.tools) {
      warnUnsupportedToolCalling(this.id, effectiveModel);
    }

    // Request-scoped skill policy (not class-level mutable state)
    const skillState = AgentLoopSkillState.hydrate(currentMessages, runtimeContext);
    if (checkpoint) {
      skillState.activeSkillDelegationOverrides = checkpoint.activeSkillDelegationOverrides;
      skillState.markFormInputSubmitted(checkpoint.hasSubmittedFormInput === true);
    }
    let finalFinishReason: string | undefined = checkpoint?.finishReason;
    let latestAssistantText = checkpoint?.latestAssistantText ?? "";
    let completedWithinStepBudget = checkpoint?.completed ?? false;
    const initialToolExposureCheckpoint = checkpoint?.toolExposureCheckpoint ??
      getRuntimeToolExposureCheckpoint(this.config);
    let pauseToolExposureAuthorized: readonly ToolDefinition[] | undefined;
    const toolExposureState = createToolExposureState();
    const persistToolExposureCheckpoint = getRuntimeToolExposureCheckpointPersister(this.config);
    const requireToolExposureCheckpointPersistence =
      isRuntimeToolExposureCheckpointPersistenceRequired(this.config);
    const toolLoadingResolution = resolveRuntimeToolLoading(this.config);
    const runtimeStepConfig: RuntimeToolFilterConfig = {
      ...this.config,
      __vfToolLoadingMode: toolLoadingResolution.mode,
    };
    if (ObjectGetPrototypeOf(this.config) === null) ObjectSetPrototypeOf(runtimeStepConfig, null);
    const allowedRemoteToolNames = getRuntimeAllowedRemoteTools(this.config);
    const forwardedRemoteToolDefinitions = getRuntimeForwardedIntegrationToolDefs(this.config);
    const remoteToolSources = getRuntimeRemoteToolSources(this.config, undefined, this.id);
    const unavailableOptionalRemoteTools = getRuntimeUnavailableOptionalRemoteTools(
      this.config,
      remoteToolSources,
    );
    const sourceIntegrationPolicy = getRuntimeSourceIntegrationPolicy(this.config);
    const frameworkLocalTools = createRuntimeFrameworkLocalTools(this.config);
    const configuredProviderTools = getRuntimeProviderTools(this.config);
    const toolResultContext = createActiveToolResultContext({
      config: this.config,
      supportsToolCalling,
    });
    const providerTools = sourceIntegrationPolicy
      ? applySourceIntegrationPolicy(configuredProviderTools, sourceIntegrationPolicy)
      : configuredProviderTools;
    let currentSystemPrompt = systemPrompt;
    let currentRuntimeContext = runtimeContext;
    let agentWriteFinalResponseToolGuardEnabled =
      checkpoint?.agentWriteFinalResponseToolGuardEnabled ?? false;
    let recoveredEmptyResponse = checkpoint?.recoveredEmptyResponse ?? false;
    // One retry gives the model a chance to reconstruct a transport-truncated
    // batch without allowing a repeatedly broken provider stream to loop.
    let recoveredInterruptedLocalToolBatch = checkpoint?.recoveredInterruptedLocalToolBatch ??
      false;
    let interruptedLocalToolBatchRecoveryStep = checkpoint?.interruptedLocalToolBatchRecoveryStep;
    let interruptedLocalToolBatchRecoveryText = checkpoint?.interruptedLocalToolBatchRecoveryText;
    let resumeToolCallExecuted = checkpoint?.resumeToolCallExecuted ?? false;

    const pauseAtBoundary = async (nextStep: number) => {
      if (!this.#manualPause) return;
      if (this.#manualPause.requested && !(await this.#manualPause.requested())) return;
      let saved: AgentPauseCheckpoint;
      try {
        saved = parseAgentPauseCheckpoint({
          version: 1,
          nextStep,
          messages: currentMessages,
          toolCalls,
          usage: totalUsage,
          latestAssistantText,
          completed: completedWithinStepBudget,
          ...(finalFinishReason ? { finishReason: finalFinishReason } : {}),
          recoveredEmptyResponse,
          recoveredInterruptedLocalToolBatch,
          hasSubmittedFormInput: skillState.hasSubmittedFormInput,
          activeSkillDelegationOverrides: skillState.activeSkillDelegationOverrides,
          resumeToolCallExecuted,
          agentWriteFinalResponseToolGuardEnabled,
          interruptedLocalToolBatchRecoveryStep,
          interruptedLocalToolBatchRecoveryText,
          providerMetadata: mapPrivateArray(
            filterPrivateArray(
              currentMessages,
              (message) => readAttachedProviderMetadata(message) !== undefined,
            ),
            (message) => ({
              messageId: message.id,
              metadata: readAttachedProviderMetadata(message)!,
            }),
          ),
          runtimeGeneratedMessageIds: mapPrivateArray(
            filterPrivateArray(currentMessages, isRuntimeGeneratedUserMessage),
            (message) => message.id,
          ),
          toolExposureCheckpoint: pauseToolExposureAuthorized
            ? createToolExposureCheckpoint(pauseToolExposureAuthorized, toolExposureState)
            : initialToolExposureCheckpoint,
        });
      } catch {
        if (this.#manualPause.release && !(await this.#manualPause.release())) return;
        logger.warn(
          "Agent is held at a safe boundary because its pause continuation cannot be saved",
        );
        throw agentManualPauseBoundary();
      }
      if (await this.#manualPause.acknowledge(saved)) throw agentManualPauseBoundary();
    };
    if (this.#manualPause) {
      await validateProviderRequest(
        withAgentRunRuntimeContext(systemPrompt, runRuntimeContext),
        currentMessages,
      );
      if (checkpoint) {
        const persistedIds = createPrivateSet(mapPrivateArray(messages, (message) => message.id));
        for (let index = 0; index < currentMessages.length; index++) {
          const message = currentMessages[index]!;
          if (persistedIds.has(message.id)) continue;
          await persistMessage(message);
          persistedIds.add(message.id);
        }
      }
    }
    await pauseAtBoundary(checkpoint?.nextStep ?? 0);
    for (
      let step = checkpoint?.nextStep ?? 0;
      !completedWithinStepBudget && step < maxSteps;
      step++
    ) {
      throwIfAborted(abortSignal);
      const runtimeObservationStepId = runtimeObservationsEnabled ? crypto.randomUUID() : undefined;
      const runtimeObservationMessageSpanId = runtimeObservationStepId !== undefined
        ? crypto.randomUUID()
        : undefined;
      sendSSE(controller, encoder, {
        type: "step-start",
        ...(runtimeObservationStepId
          ? {
            privateRuntimeObservation: {
              version: 1,
              kind: "step_started",
              stepId: runtimeObservationStepId,
            },
          }
          : {}),
      });
      const currentStepToolResults = createPrivateMap<string, ToolResultPart>();
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
        unavailableOptionalRemoteToolNames: unavailableOptionalRemoteTools.names,
        unavailableOptionalRemoteToolPrefixes: unavailableOptionalRemoteTools.prefixes,
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
        frameworkLocalTools,
        toolExposureState,
        toolExposureCheckpoint: step === (checkpoint?.nextStep ?? 0)
          ? initialToolExposureCheckpoint
          : undefined,
      });
      pauseToolExposureAuthorized = preparedStep.toolExposurePlan.authorized;
      currentSystemPrompt = preparedStep.systemPrompt;
      currentRuntimeContext = preparedStep.runtimeContext;
      const toolContext = preparedStep.toolContext;
      const effectiveToolExposurePlan = agentWriteFinalResponseToolGuardEnabled
        ? applyAgentWriteFinalResponseGuard(preparedStep.toolExposurePlan, {
          reloadable: toolLoadingResolution.mode === "deferred",
        })
        : preparedStep.toolExposurePlan;
      assertToolResultReaderNameAvailable({
        plan: effectiveToolExposurePlan,
        context: toolResultContext,
      });

      if (!resumeToolCallExecuted && this.#resumeToolCall) {
        // A resumed finalize can terminate before any provider call. Validate
        // the staged turn first so accepted terminal results commit and
        // rejected turns roll back without dispatching the parked action.
        if (isTerminalRunToolName(this.#resumeToolCall.name)) {
          await validateProviderRequest(
            withAgentRunRuntimeContext(currentSystemPrompt, runRuntimeContext),
            currentMessages,
          );
        }
        const resumeToolCall = this.#resumeToolCall;
        resumeToolCallExecuted = true;
        const inputText = privateJsonStringify(resumeToolCall.input);
        const streamedCall: StreamingToolCall = {
          id: resumeToolCall.id,
          name: resumeToolCall.name,
          arguments: inputText,
          inputDeltas: [inputText],
          inputAvailable: true,
        };
        announceStreamedToolCallInput(controller, encoder, streamedCall);
        sendSSE(controller, encoder, {
          type: "tool-input-available",
          toolCallId: resumeToolCall.id,
          toolName: resumeToolCall.name,
          input: resumeToolCall.input,
          ...(isDynamicTool(resumeToolCall.name) ? { dynamic: true } : {}),
        });

        const assistantToolCallMessage: Message = {
          id: generateMessageId(),
          role: "assistant",
          parts: [{
            type: `tool-${resumeToolCall.name}`,
            toolCallId: resumeToolCall.id,
            toolName: resumeToolCall.name,
            args: resumeToolCall.input,
          }],
        };
        let admittedTurn = snapshotAdmittedToolTurn(
          assistantToolCallMessage,
          currentMessages.length,
        );
        for (let index = currentMessages.length - 1; index >= 0; index--) {
          const message = currentMessages[index]!;
          if (message.role !== "assistant") continue;
          const candidate = snapshotAdmittedToolTurn(message, index);
          if (
            somePrivateArray(
              candidate.calls,
              (call) =>
                call.toolCallId === resumeToolCall.id && call.toolName === resumeToolCall.name &&
                providerValuesEqual(call.input, resumeToolCall.input, new IntrinsicWeakMap()),
            )
          ) admittedTurn = candidate;
          // A newer assistant envelope is a turn boundary, never inferred replay provenance.
          break;
        }
        if (admittedTurn.start === currentMessages.length) {
          pushPrivateArray(currentMessages, assistantToolCallMessage);
          await persistMessage(assistantToolCallMessage);
        }

        const toolCall: ToolCall = {
          id: resumeToolCall.id,
          name: resumeToolCall.name,
          args: resumeToolCall.input,
          status: "executing",
        };
        const executionContext = applicationExecutionContext(toolContext);
        try {
          // The trusted parked call was already exposed in the prior segment.
          // Recheck current authorization without requiring its lost step visibility.
          if (
            !intrinsicArraySome(
              effectiveToolExposurePlan.authorized,
              (tool) => tool.name === resumeToolCall.name,
            )
          ) {
            throw new Error(toolNotVisibleError(resumeToolCall.name));
          }
          const policyCheck = enforceSkillPolicy(resumeToolCall.name, {
            activeSkillId: skillState.activeSkillId,
            hasSubmittedFormInput: skillState.hasSubmittedFormInput,
            skillToolAvailability: skillState.activeSkillToolAvailability,
            toolInput: toolCall.args,
          });
          if (!policyCheck.allowed) throw new Error(policyCheck.error);

          toolCall.args = applySkillDelegationOverridesToToolInput(
            resumeToolCall.name,
            toolCall.args,
            skillState.activeSkillDelegationOverrides,
            resolveConfiguredTool(this.config.tools, resumeToolCall.name, { agentId: this.id }) ??
              undefined,
          );
          callbacks?.onToolCall?.(toolCall);
          const startTime = Date.now();
          const result = await runWithToolCallOccurrenceDispatch(
            streamedCall,
            () =>
              traceConfiguredToolExecution({
                mode: "stream",
                agentId: this.id,
                toolName: resumeToolCall.name,
                toolCallId: resumeToolCall.id,
                args: toolCall.args,
                admittedTurn,
                owner: currentMessages,
                prepareTerminalDispatch,
                toolsConfig: this.config.tools,
                context: executionContext,
                allowedRemoteToolNames,
                remoteToolSources,
                sourceIntegrationPolicy,
                frameworkLocalTools,
              }),
          );
          throwIfAborted(abortSignal);
          await this.notifyToolResult({
            mode: "stream",
            toolName: resumeToolCall.name,
            toolCallId: resumeToolCall.id,
            input: toolCall.args,
            result,
            context: executionContext,
          });
          const resultError = getToolResultError(result);
          toolCall.status = resultError === undefined ? "completed" : "error";
          toolCall.result = result;
          toolCall.error = resultError;
          toolCall.executionTime = Date.now() - startTime;
          pushPrivateArray(toolCalls, toolCall);
          if (resultError === undefined) {
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: resumeToolCall.id,
              output: result,
              ...(isDynamicTool(resumeToolCall.name) ? { dynamic: true } : {}),
            });
          } else {
            sendSSE(controller, encoder, {
              type: "tool-output-error",
              toolCallId: resumeToolCall.id,
              errorText: resultError,
              ...(isDynamicTool(resumeToolCall.name) ? { dynamic: true } : {}),
            });
          }
          const toolResultMessage = createToolResultMessage(
            resumeToolCall.id,
            resumeToolCall.name,
            result,
          );
          pushPrivateArray(currentMessages, toolResultMessage);
          await persistMessage(toolResultMessage);
        } catch (error) {
          await this.recordTerminalToolResult(
            error,
            toolCall,
            persistMessage,
            currentMessages,
            toolCalls,
            totalUsage,
            { controller, encoder },
          );
          throwIfAborted(abortSignal);
          await this.recordToolError(
            persistMessage,
            toolCall,
            error instanceof Error ? error.message : String(error),
            { controller, encoder },
            currentMessages,
            toolCalls,
          );
        }
      }

      const modelMessages = toolResultContext
        ? createModelToolResultContextMessages(currentMessages, toolResultContext)
        : currentMessages;
      const exposeToolResultReader = canExposeToolResultReader({
        plan: effectiveToolExposurePlan,
        context: toolResultContext,
      });
      const tools = withToolResultReaderTool(
        effectiveToolExposurePlan.visible,
        exposeToolResultReader,
      );
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
        requiredToolNames: getRequiredToolResultReaderNames(exposeToolResultReader),
      });
      currentSystemPrompt = withIntegrationToolDiscoveryStatus(
        synchronizeRuntimeToolInventory(
          currentSystemPrompt,
          runtimeTools,
          agentWriteFinalResponseToolGuardEnabled
            ? filterPrivateArray(
              effectiveToolExposurePlan.deferred,
              (tool) => shouldHideProjectToolAfterAgentWriteSuccess(tool.name),
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
        modelMessages,
      );
      const streamLifecycleMode = resolveStreamLifecycleModeFromEnv();
      const streamModel = withRuntimeProviderStreamErrorProvenance(languageModel);
      const providerMessages = convertToTextGenerationRuntimeRequestMessages(
        modelMessages,
        // A server-local runtime fetches attachments from this machine,
        // where a loopback or private-network URL resolves; only a remote
        // provider needs the URL to be reachable from the internet.
        { requireInternetReachableAttachments: !isLocalModelRuntime(languageModel) },
      );
      const streamSource = createRuntimeStreamSource((streamSignal) =>
        streamText({
          model: streamModel,
          system: providerSystemPrompt,
          messages: providerMessages,
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
        privateTextSlice(previousRecoveryText, suppressedRecoveryReplayTextLength);
      const flushDeferredRecoveryOutput = (
        interruptedRecoveryPrefixLength: number,
        repeatsInterruptedRecoveryText: boolean,
        useReplacementTextPartId: boolean,
      ): void => {
        if (deferredRecoveryOutput === undefined) return;

        let remainingSsePrefixLength = interruptedRecoveryPrefixLength;
        let remainingCallbackPrefixLength = interruptedRecoveryPrefixLength;
        for (let outputIndex = 0; outputIndex < deferredRecoveryOutput.length; outputIndex++) {
          if (!ObjectHasOwn(deferredRecoveryOutput, outputIndex)) continue;
          const output = deferredRecoveryOutput[outputIndex]!;
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
              enqueuePrivateStream(controller, stripped.chunk);
            }
          }
        }
        deferredRecoveryOutput.length = 0;
      };
      const releaseDeferredRecoveryOutputAfterDivergence = (): void => {
        if (deferredRecoveryOutput === undefined || releasedDeferredRecoveryOutput) return;

        const expectedReplayText = remainingRecoveryReplayText();
        const sseDiverged = !privateTextStartsWith(expectedReplayText, deferredRecoverySseText);
        const callbackDiverged = callbacks?.onChunk === undefined ||
          !privateTextStartsWith(expectedReplayText, deferredRecoveryCallbackText);
        if (!sseDiverged || !callbackDiverged) return;

        const observedRecoveryText = callbacks?.onChunk === undefined
          ? deferredRecoverySseText
          : deferredRecoveryCallbackText;
        const extendsPreviousRecoveryText = privateTextStartsWith(
          observedRecoveryText,
          expectedReplayText,
        );
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

        const retainedOutput = filterPrivateArray(
          deferredRecoveryOutput,
          (output) => output.kind === "callback" || output.isTextEvent,
        );
        for (let outputIndex = 0; outputIndex < deferredRecoveryOutput.length; outputIndex++) {
          if (!ObjectHasOwn(deferredRecoveryOutput, outputIndex)) continue;
          const output = deferredRecoveryOutput[outputIndex]!;
          if (output.kind === "sse" && !output.isTextEvent) {
            enqueuePrivateStream(controller, output.chunk);
          }
        }
        deferredRecoveryOutput.length = 0;
        appendPrivateArray(deferredRecoveryOutput, retainedOutput);
      };
      const reconcileDeferredRecoveryTextSegment = (
        isTextEndEvent: boolean,
      ): void => {
        if (
          !isTextEndEvent || deferredRecoveryOutput === undefined ||
          releasedDeferredRecoveryOutput ||
          !privateTextStartsWith(remainingRecoveryReplayText(), deferredRecoverySseText) ||
          (callbacks?.onChunk !== undefined &&
            !privateTextStartsWith(remainingRecoveryReplayText(), deferredRecoveryCallbackText))
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
            enqueuePrivateStream(
              controller,
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
          pushPrivateArray(deferredRecoveryOutput, {
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
            pushPrivateArray(deferredRecoveryOutput, { kind: "callback", chunk });
          }
          releaseDeferredRecoveryOutputAfterDivergence();
        },
        ...(runtimeObservationStepId !== undefined && runtimeObservationMessageSpanId !== undefined
          ? {
            runtimeObservationStepId,
            runtimeObservationMessageSpanId,
          }
          : {}),
        onUsage: (usage) => {
          accumulateUsage(totalUsage, usage);
          // Snapshot, not the live object: a later step must not mutate a total
          // a caller has already recorded on a span.
          callbacks?.onUsage?.({ ...totalUsage });
        },
        requireProviderFinish:
          languageModel.runtimeCapabilities?.toolCallStreamRequiresFinish === true,
        providerExecutedToolNames: getProviderExecutedToolNames(runtimeTools),
        availableToolNames: runtimeToolNames,
        streamLifecycleMode,
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
        : privateTextStartsWith(state.accumulatedText, previousRecoveryText)
        ? previousRecoveryText.length
        : privateTextStartsWith(previousRecoveryText, state.accumulatedText)
        ? state.accumulatedText.length
        : 0;
      const recoveryPresentationPrefixLength = suppressedRecoveryReplayTextLength > 0
        ? suppressedRecoveryReplayTextLength
        : interruptedRecoveryPrefixLength;
      const recoveryPresentationText = privateTextSlice(
        state.accumulatedText,
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

      const streamedToolCalls: StreamingToolCall[] = [];
      for (const toolCall of state.toolCalls.values()) {
        pushPrivateArray(streamedToolCalls, toolCall);
      }
      const finalToolResults = collectFinalStreamToolResults(state);
      // Recovery replays the whole step, so it also re-emits this step's
      // reasoning — duplicating it in the live stream and in history, with a
      // signature that no longer matches the replayed content. Reasoning that
      // was persisted is reasoning the client already saw, so fail closed.
      // This is a stopgap: reasoning is default-on across the hosted catalog,
      // which makes recovery inert on most hosted paths. See #3736 for the
      // reconciliation protocol that would let it run again.
      const persistedReasoningParts = filterPrivateArray(
        state.reasoningParts,
        isPersistedReasoningPart,
      );
      const hasExposedReasoning = persistedReasoningParts.length > 0;
      const canRecoverInterruptedLocalToolBatch = !recoveredInterruptedLocalToolBatch &&
        step + 1 < maxSteps &&
        !hasExposedReasoning;
      const shouldContinue = shouldContinueAfterStreamStep(state, {
        recoverInterruptedToolCalls: canRecoverInterruptedLocalToolBatch,
      });
      const stoppedEmptyAfterCompletedTool = state.finishReason === "stop" &&
        !hasSubstantiveAssistantText(state.accumulatedText) &&
        state.toolCalls.size === 0 &&
        finalToolResults.size === 0 &&
        (state.suppressedToolCalls?.length ?? 0) === 0 &&
        somePrivateArray(toolCalls, (toolCall) => toolCall.status === "completed");
      const shouldRecoverInterruptedLocalToolBatch = canRecoverInterruptedLocalToolBatch &&
        shouldContinue &&
        somePrivateArray(streamedToolCalls, isInterruptedClientToolCall);
      const exhaustedStepBudgetDuringInterruptedLocalToolRecovery =
        !recoveredInterruptedLocalToolBatch &&
        step + 1 >= maxSteps &&
        !hasExposedReasoning &&
        somePrivateArray(streamedToolCalls, isInterruptedClientToolCall) &&
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
        somePrivateArray(streamedToolCalls, isInterruptedClientToolCall) &&
        shouldContinueAfterStreamStep(state, { recoverInterruptedToolCalls: true });
      if (declinedRecoveryForExposedReasoning) {
        logger.warn("Declined interrupted local tool batch recovery after exposed reasoning", {
          step,
          toolName: filterPrivateArray(streamedToolCalls, isInterruptedClientToolCall)[0]?.name,
          reasoningPartCount: persistedReasoningParts.length,
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
        await reconcileSuppressedProviderMetadata(
          languageModel,
          state.providerMetadata,
          state.suppressedToolCalls,
          state.toolCalls.size > 0,
          abortSignal,
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
        latestAssistantText = privateTextStartsWith(previousRecoveryText, state.accumulatedText)
          ? previousRecoveryText
          : state.accumulatedText;
      } else if (
        hasSubstantiveAssistantText(stepAssistantText) ||
        step !== interruptedLocalToolBatchRecoveryStep
      ) {
        latestAssistantText = stepAssistantText;
      }
      const streamedInvokeAgentBatch = providerReplayCheckpointEmission.complete
        ? collectStreamedParallelInvokeAgentToolCalls(
          streamedToolCalls,
          finalToolResults,
          providerReplayCheckpointEmission.invokeAgentToolNames,
          shouldContinue,
          effectiveToolExposurePlan,
          {
            activeSkillDelegationOverrides: skillState.activeSkillDelegationOverrides,
            toolsConfig: this.config.tools,
            agentId: this.id,
            hasToolReplacements: false,
          },
        )
        : undefined;
      const streamedSkillDelegationOrder = streamedInvokeAgentBatch
        ? streamedSameTurnSkillDelegationOrder(
          streamedToolCalls,
          finalToolResults,
          providerReplayCheckpointEmission.invokeAgentToolNames,
        )
        : undefined;
      let streamedBatchCompletionDeferred = streamedSkillDelegationOrder === "prefix";
      const admittedTurn = snapshotAdmittedToolTurn(assistantMessage, currentMessages.length);
      pushPrivateArray(currentMessages, assistantMessage);
      await persistMessage(assistantMessage);
      await persistProviderReplayCheckpointAfterTurn({
        emission: providerReplayCheckpointEmission,
        providerMetadata: readAttachedProviderMetadata(assistantMessage),
        invokeAgentToolCalls: streamedSkillDelegationOrder === "interleaved"
          ? undefined
          : streamedInvokeAgentBatch,
        deferCompletion: streamedBatchCompletionDeferred,
      });

      if (stoppedEmptyAfterCompletedTool) {
        sendSSE(controller, encoder, {
          type: "step-end",
          ...(runtimeObservationStepId
            ? {
              privateRuntimeObservation: {
                version: 1,
                kind: "step_ended",
                stepId: runtimeObservationStepId,
              },
            }
            : {}),
        });
        if (recoveredEmptyResponse || step + 1 >= maxSteps) {
          throw new RuntimeEmptyResponseError();
        }
        recoveredEmptyResponse = true;
        pushPrivateArray(
          currentMessages,
          markRuntimeGeneratedUserMessage({
            id: `runtime_empty_response_${Date.now()}_${step}`,
            role: "user",
            parts: [{
              type: "text",
              text: EMPTY_RESPONSE_RECOVERY_PROMPT,
            }],
            timestamp: Date.now(),
          }),
        );
        await pauseAtBoundary(step + 1);
        this.status = "thinking";
        continue;
      }

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
        pushPrivateArray(currentMessages, toolResultMessage);
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
          { controller, encoder },
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
        for (let toolCallIndex = 0; toolCallIndex < streamedToolCalls.length; toolCallIndex++) {
          if (!ObjectHasOwn(streamedToolCalls, toolCallIndex)) continue;
          const toolCall = streamedToolCalls[toolCallIndex]!;
          // Terminal. Every incomplete local call recorded here is also
          // terminalized into history, so announce unconditionally and let the
          // wire carry the same failure. `recordIncompleteLocalToolError`
          // guards on `providerExecuted`, completeness and a final result, so
          // only genuinely truncated local calls are announced, and
          // `announceStreamedToolCallInput` is idempotent for any already
          // surfaced upstream.
          await recordIncompleteLocalToolError(toolCall, { announceInput: true });
        }
        sendSSE(controller, encoder, {
          type: "step-end",
          ...(runtimeObservationStepId
            ? {
              privateRuntimeObservation: {
                version: 1,
                kind: "step_ended",
                stepId: runtimeObservationStepId,
              },
            }
            : {}),
        });
        completedWithinStepBudget = !exhaustedStepBudgetDuringInterruptedLocalToolRecovery;
        if (!completedWithinStepBudget) await pauseAtBoundary(step + 1);
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

      for (let toolCallIndex = 0; toolCallIndex < streamedToolCalls.length; toolCallIndex++) {
        if (!ObjectHasOwn(streamedToolCalls, toolCallIndex)) continue;
        const tc = streamedToolCalls[toolCallIndex]!;
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
            { controller, encoder },
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

        if (
          streamedBatchCompletionDeferred && tc.providerExecuted !== true && !matchingResult &&
          !persistedResult &&
          IntrinsicReflectApply(
            IntrinsicSetHas,
            providerReplayCheckpointEmission.invokeAgentToolNames,
            [tc.name as ProviderReplayInvokeAgentToolName],
          )
        ) {
          await completeDeferredProviderReplayCheckpointTurn(
            providerReplayCheckpointEmission,
            collectStreamedParallelInvokeAgentToolCalls(
              streamedToolCalls,
              finalToolResults,
              providerReplayCheckpointEmission.invokeAgentToolNames,
              shouldContinue,
              effectiveToolExposurePlan,
              {
                activeSkillDelegationOverrides: skillState.activeSkillDelegationOverrides,
                toolsConfig: this.config.tools,
                agentId: this.id,
                hasToolReplacements: false,
              },
            ),
          );
          streamedBatchCompletionDeferred = false;
        }

        if (matchingResult) {
          await persistToolResult(matchingResult);
          toolCall.status = matchingResult.error === undefined ? "completed" : "error";
          toolCall.result = matchingResult.output;
          toolCall.error = matchingResult.error === undefined
            ? undefined
            : stringifyToolError(matchingResult.error);
          pushPrivateArray(toolCalls, toolCall);

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
          pushPrivateArray(toolCalls, toolCall);
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
          pushPrivateArray(toolCalls, toolCall);
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
            { controller, encoder },
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
            pushPrivateArray(toolCalls, toolCall);
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
            pushPrivateArray(currentMessages, toolResultMessage);
            await persistMessage(toolResultMessage);
            checkpoint = search.checkpoint;
            currentStepToolResults.set(tc.id, toolResultMessage.parts[0] as ToolResultPart);
          } catch (error) {
            await this.recordToolError(
              persistMessage,
              toolCall,
              error instanceof Error ? error.message : String(error),
              { controller, encoder },
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
        if (
          shouldHandleToolResultRead({
            toolName: tc.name,
            plan: effectiveToolExposurePlan,
            context: toolResultContext,
          })
        ) {
          try {
            callbacks?.onToolCall?.(toolCall);
            if (toolResultContext === undefined) {
              throw new ReferenceError("Tool result context is not available");
            }
            const result = readToolResultContext(toolResultContext, toolCall.args);
            toolCall.status = "completed";
            toolCall.result = result;
            pushPrivateArray(toolCalls, toolCall);
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: toolCall.id,
              output: result,
            });
            const toolResultMessage = createToolResultMessage(tc.id, tc.name, result);
            pushPrivateArray(currentMessages, toolResultMessage);
            await persistMessage(toolResultMessage);
            currentStepToolResults.set(tc.id, toolResultMessage.parts[0] as ToolResultPart);
          } catch (error) {
            await this.recordToolError(
              persistMessage,
              toolCall,
              error instanceof Error ? error.message : String(error),
              { controller, encoder },
              currentMessages,
              toolCalls,
            );
          }
          continue;
        }
        if (
          shouldBlockToolResultReadName({
            toolName: tc.name,
            context: toolResultContext,
          })
        ) {
          await this.recordToolError(
            persistMessage,
            toolCall,
            toolResultReaderUnavailableError(),
            { controller, encoder },
            currentMessages,
            toolCalls,
          );
          continue;
        }
        if (executionAuthority === undefined) {
          await this.recordToolError(
            persistMessage,
            toolCall,
            toolNotVisibleError(tc.name),
            { controller, encoder },
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
            { controller, encoder },
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

          const executionContext = applicationExecutionContext(toolContext);
          const result = await runWithToolCallOccurrenceDispatch(
            tc,
            () =>
              traceConfiguredToolExecution({
                mode: "stream",
                agentId: this.id,
                toolName: tc.name,
                toolCallId: tc.id,
                args: toolCall.args,
                admittedTurn,
                owner: currentMessages,
                prepareTerminalDispatch,
                toolsConfig: this.config.tools,
                context: executionContext,
                allowedRemoteToolNames,
                remoteToolSources,
                sourceIntegrationPolicy,
                frameworkLocalTools,
              }),
          );
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
          pushPrivateArray(toolCalls, toolCall);

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
            pushPrivateArray(currentMessages, toolResultMessage);
            await persistMessage(toolResultMessage);
            currentStepToolResults.set(tc.id, toolResultMessage.parts[0] as ToolResultPart);
          }
        } catch (error) {
          await this.recordToolError(
            persistMessage,
            toolCall,
            undefined,
            { controller, encoder },
            currentMessages,
            toolCalls,
            { terminal: { error, usage: totalUsage, abortSignal } },
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
        pushPrivateArray(
          currentMessages,
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
      sendSSE(controller, encoder, {
        type: "step-end",
        ...(runtimeObservationStepId
          ? {
            privateRuntimeObservation: {
              version: 1,
              kind: "step_ended",
              stepId: runtimeObservationStepId,
            },
          }
          : {}),
      });
      await pauseAtBoundary(step + 1);
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
  private async recordTerminalToolResult(
    error: unknown,
    toolCall: ToolCall,
    persistMessage: (message: Message) => Promise<void>,
    currentMessages: Message[],
    toolCalls: ToolCall[],
    usage: NonNullable<AgentResponse["usage"]>,
    stream?: { controller: ReadableStreamDefaultController; encoder: TextEncoder },
  ): Promise<void> {
    const dispatch = terminalDispatchRecord(error, currentMessages);
    if (
      !isTerminalRunControlError(error) || !dispatch || error.terminalToolCallId !== dispatch.callId
    ) return;
    toolCall = { ...toolCall, id: dispatch.callId, name: dispatch.callName };
    const admittedTurn = dispatch.turn as AdmittedToolTurn;
    const { controller, encoder } = stream ?? {};
    const acknowledged = error.acknowledgedResult !== undefined;
    const priorResult = findAdmittedToolResult(currentMessages, admittedTurn, dispatch.callId);
    toolCall.status = acknowledged ? "completed" : "error";
    if (acknowledged) toolCall.result = priorResult?.result ?? error.acknowledgedResult;
    else toolCall.error = error.message;
    pushPrivateArray(toolCalls, toolCall);
    if (!priorResult) {
      const message = acknowledged
        ? createToolResultMessage(toolCall.id, toolCall.name, error.acknowledgedResult)
        : createToolErrorMessage(toolCall.id, toolCall.name, error.message);
      await persistMessage(message);
      pushPrivateArray(currentMessages, message);
    }
    const siblings = this.unresolvedTerminalSiblings(currentMessages, admittedTurn);
    await forEachSequential(siblings, async (sibling) => {
      const reason = acknowledged
        ? "Run finalized before this tool was dispatched"
        : "Run outcome could not be confirmed; further tool dispatch stopped";
      const skipped = createToolErrorMessage(sibling.toolCallId, sibling.toolName, reason);
      await persistMessage(skipped);
      pushPrivateArray(currentMessages, skipped);
      pushPrivateArray(toolCalls, {
        id: sibling.toolCallId,
        name: sibling.toolName,
        args: sibling.input,
        status: "error",
        error: reason,
      });
      if (controller && encoder) {
        sendSSE(controller, encoder, {
          type: "tool-output-error",
          toolCallId: sibling.toolCallId,
          errorText: reason,
          ...(isDynamicTool(sibling.toolName) ? { dynamic: true } : {}),
        });
      }
    });
    error.executionState = {
      messages: [...currentMessages],
      toolCalls: [...toolCalls],
      usage: { ...usage },
    };
    if (controller && encoder) {
      sendSSE(controller, encoder, {
        type: acknowledged ? "tool-output-available" : "tool-output-error",
        toolCallId: toolCall.id,
        ...(acknowledged ? { output: error.acknowledgedResult } : { errorText: error.message }),
        ...(isDynamicTool(toolCall.name) ? { dynamic: true } : {}),
      });
    }
  }

  private unresolvedTerminalSiblings(currentMessages: Message[], turn: AdmittedToolTurn) {
    const resolvedIds = createPrivateSet<string>();
    for (let index = turn.start; index < currentMessages.length; index++) {
      forEachPrivateArray(currentMessages[index]!.parts, (part) => {
        if (part.type === "tool-result") resolvedIds.add(part.toolCallId);
      });
    }
    return filterPrivateArray(turn.calls, (call) => !resolvedIds.has(call.toolCallId));
  }

  private async recordToolError(
    persistMessage: (message: Message) => Promise<void>,
    toolCall: ToolCall,
    errorStr: string | undefined,
    stream: { controller: ReadableStreamDefaultController; encoder: TextEncoder },
    currentMessages: Message[],
    toolCalls: ToolCall[],
    options: {
      emitSse?: boolean;
      includeInResponse?: boolean;
      terminal?: {
        error: unknown;
        usage: NonNullable<AgentResponse["usage"]>;
        abortSignal?: AbortSignal;
      };
    } = {},
  ): Promise<void> {
    const { controller, encoder } = stream;
    if (options.terminal) {
      await this.recordTerminalToolResult(
        options.terminal.error,
        toolCall,
        persistMessage,
        currentMessages,
        toolCalls,
        options.terminal.usage,
        { controller, encoder },
      );
      throwIfAborted(options.terminal.abortSignal);
      const error = options.terminal.error;
      errorStr = error instanceof Error ? error.message : String(error);
    }
    errorStr ??= "Tool execution failed";
    toolCall.status = "error";
    toolCall.error = errorStr;
    if (options.includeInResponse !== false) {
      pushPrivateArray(toolCalls, toolCall);
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
    pushPrivateArray(currentMessages, errorMessage);
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

const agentRuntimePrivateMethodNames = [
  "restoreInputReplayMetadata",
  "prepareTurnMessages",
  "createTurnPersistence",
  "resolveRuntimeState",
  "notifyToolResult",
  "createGenerateReplacementTools",
  "resolveOutputSchema",
  "recordToolError",
  "recordTerminalToolResult",
  "unresolvedTerminalSiblings",
  "resolveSystemPrompt",
  "computeMaxSteps",
  "resolveTemperature",
  "resolveMaxOutputTokens",
] as const;
const agentRuntimePrivateMethods = ObjectGetOwnPropertyDescriptors(AgentRuntime.prototype);

type ProviderMetadataReconciler = (input: {
  providerMetadata: Record<string, unknown>;
  suppressedToolCalls: readonly { id: string; name: string }[];
  abortSignal?: AbortSignal;
}) => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;

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

async function reconcileSuppressedProviderMetadata(
  modelRuntime: ModelRuntime,
  providerMetadata: Record<string, unknown> | undefined,
  suppressedToolCalls: readonly { id: string; name: string }[],
  hasSurvivingToolCalls: boolean,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  throwIfAborted(abortSignal);
  if (providerMetadata === undefined || suppressedToolCalls.length === 0) {
    return providerMetadata;
  }

  const reconcile = modelRuntime._reconcileProviderMetadata;
  if (typeof reconcile !== "function") {
    return undefined;
  }

  const reconciled = await (reconcile as ProviderMetadataReconciler).call(modelRuntime, {
    providerMetadata,
    suppressedToolCalls,
    abortSignal,
  });
  throwIfAborted(abortSignal);
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
    ArrayIsArray(reconciled)
  ) {
    throw new TypeError(
      "Model runtime returned invalid provider metadata after suppressing a tool call",
    );
  }
  return reconciled;
}
