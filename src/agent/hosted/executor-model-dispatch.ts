import { getPrivateAsyncIterator } from "#veryfront/security/private-iterator.ts";
import { forEachPrivateArray, mapPrivateArray } from "#veryfront/security/private-array.ts";
import { testPrivateRegExp } from "#veryfront/security/private-regexp.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import {
  buildModelCallContextRequest,
  resolveModelCallProvider,
  snapshotModelCallProviderOptions,
} from "#veryfront/runtime/model-call-context-request.ts";
import type {
  AgentRunEventSink,
  AgentRunModelCallContextEvent,
  ModelCallMessage,
} from "#veryfront/runtime/model-call-context.ts";
import type { AgentRunModelCallCaptureReceipt } from "#veryfront/runtime/model-call-capture-receipt.ts";
import { runWithVeryfrontCloudModelCallCapture } from "#veryfront/provider/veryfront-cloud/context.ts";
import {
  DurableRunEventPersistenceError,
  isPrivateConversationRunEvent,
} from "../conversation/private-run-event.ts";
import type { ExecutorOperation, ExecutorOperationContext } from "../executor/channel.ts";
import { type ExecutorBinding, getExecutorBindingSchema } from "../executor/protocol.ts";
import type { AgentModelRuntimeResolver } from "../runtime/model-transport.ts";
import { createExecutorModelBroker, type ExecutorModelDispatch } from "./executor-model-bridge.ts";
import { executorModelJson, parseExecutorModelData } from "./executor-model-schema.ts";
import { assertPersistedModelOptions } from "./executor-model-dispatch-options.ts";
import { createExecutorModelAdmission, type ExecutorModelGrant } from "./executor-model-grant.ts";
import { executorModelFailure } from "./executor-model-errors.ts";
import type { ExecutorSkillObservation } from "./executor-skill-observation.ts";

const cloneStructuredValue = globalThis.structuredClone;
const ArrayIsArray = Array.isArray;
const ObjectDefineProperty = Object.defineProperty;
const ObjectEntries = Object.entries;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const ObjectFreeze = Object.freeze;
const ReflectApply = Reflect.apply;
const SymbolIterator = Symbol.iterator;
const CaptureReceiptUuidPattern =
  /^(?:00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const CaptureReceiptFields = ["eventId", "projectId", "runId", "modelCallId"] as const;

const EmptyStructuredCloneTransferList: Transferable[] = [];
ReflectApply(ObjectDefineProperty, Object, [EmptyStructuredCloneTransferList, SymbolIterator, {
  configurable: false,
  enumerable: false,
  value() {
    return {
      next() {
        return { done: true, value: undefined };
      },
    };
  },
  writable: false,
}]);
const EmptyStructuredCloneOptions: StructuredSerializeOptions = {
  transfer: EmptyStructuredCloneTransferList,
};

function cloneStructured<T>(value: T): T {
  return ReflectApply(cloneStructuredValue, globalThis, [
    value,
    EmptyStructuredCloneOptions,
  ]) as T;
}

function objectEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return ReflectApply(ObjectEntries, Object, [value]) as Array<[string, unknown]>;
}

function objectKeys(value: Record<string, unknown>): string[] {
  return ReflectApply(ObjectKeys, Object, [value]) as string[];
}

function defineOwnDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  ReflectApply(ObjectDefineProperty, Object, [target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  }]);
}

function readOwnEnumerableDataString(
  value: Record<PropertyKey, unknown>,
  key: string,
): string | undefined {
  const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [value, key]) as
    | PropertyDescriptor
    | undefined;
  return descriptor?.enumerable === true && ObjectHasOwn(descriptor, "value") &&
      typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function readModelCallCaptureReceipt(
  value: unknown,
): AgentRunModelCallCaptureReceipt | undefined {
  if (!isRecord(value)) return undefined;
  const keys = ReflectApply(ObjectKeys, Object, [value]) as string[];
  if (keys.length !== CaptureReceiptFields.length) return undefined;
  for (let index = 0; index < CaptureReceiptFields.length; index++) {
    const field = CaptureReceiptFields[index];
    if (field === undefined || !ObjectHasOwn(value, field)) return undefined;
  }
  const eventId = readOwnEnumerableDataString(value, "eventId");
  const projectId = readOwnEnumerableDataString(value, "projectId");
  const runId = readOwnEnumerableDataString(value, "runId");
  const modelCallId = readOwnEnumerableDataString(value, "modelCallId");
  if (
    !eventId || !projectId || !runId || !modelCallId ||
    !testPrivateRegExp(CaptureReceiptUuidPattern, projectId) ||
    !testPrivateRegExp(CaptureReceiptUuidPattern, runId) ||
    !testPrivateRegExp(CaptureReceiptUuidPattern, modelCallId)
  ) {
    return undefined;
  }
  return { eventId, projectId, runId, modelCallId };
}

/** Ingress-owned invocation authority. The sink already owns its exact run identity. */
export interface HostedExecutorModelScope {
  readonly binding: ExecutorBinding;
  readonly signal: AbortSignal;
  /** Throws when owner authority is inactive, including while persistence is pending. */
  readonly assertActive: () => void;
}

interface HostedModelBrokerInput {
  resolveModelRuntime: AgentModelRuntimeResolver | undefined;
  allowedModelIds: ReadonlySet<string>;
  scope: HostedExecutorModelScope;
  grant: ExecutorModelGrant;
  /** Host-owned record updated with each prompt dispatched to the provider. */
  skillObservation?: ExecutorSkillObservation;
}

/**
 * Hosted model operations require a captured, acknowledging run event sink.
 * Use the durable run sink backed by the trusted root mirror. No handler reads
 * caller AsyncLocalStorage or accepts executor-authored event/run identity.
 * Metadata and preparation check invocation authority but emit no call event.
 */
export function createHostedExecutorModelBroker(
  input: HostedModelBrokerInput & {
    /** Canonical authenticated grant scope; null preserves the legacy projectless lane. */
    projectId: string | null;
    runEventSink: AgentRunEventSink | undefined;
    /** Trusted API rollout opt-in. Enable only when append returns exact capture receipts. */
    modelCallCaptureReceipts?: true;
  },
): ReadonlyMap<string, ExecutorOperation> {
  const sink = input.runEventSink;
  const projectId = input.projectId;
  if (projectId !== null && typeof projectId !== "string") {
    throw new TypeError("Hosted model dispatch requires an explicit project scope");
  }
  if (typeof sink !== "function") {
    throw new DurableRunEventPersistenceError("Hosted model dispatch requires a run event sink");
  }
  if (input.modelCallCaptureReceipts !== undefined && input.modelCallCaptureReceipts !== true) {
    throw new TypeError("Hosted model capture activation must be explicit");
  }
  if (input.modelCallCaptureReceipts && projectId === null) {
    throw new TypeError("Hosted model capture receipts require a project scope");
  }
  const captureEnabled = input.modelCallCaptureReceipts === true;
  return createScopedHostedModelBroker(input, async (request, context) => {
    const acknowledgement = await acknowledgePersistence(
      () => sink(createContextEvent(request, captureEnabled)),
      context.signal,
    );
    if (projectId === null || !captureEnabled) {
      if (acknowledgement !== undefined) {
        throw new DurableRunEventPersistenceError(
          projectId === null
            ? "Projectless model dispatch cannot accept a project capture receipt"
            : "Legacy model dispatch cannot accept a project capture receipt",
        );
      }
      return undefined;
    }
    const receipt = readModelCallCaptureReceipt(acknowledgement);
    if (
      receipt === undefined ||
      receipt.modelCallId.toLowerCase() !== request.identity.modelCallId.toLowerCase() ||
      receipt.projectId.toLowerCase() !== projectId.toLowerCase()
    ) {
      throw new DurableRunEventPersistenceError(
        "Hosted model capture receipt is missing or invalid",
      );
    }
    return ReflectApply(ObjectFreeze, Object, [receipt]) as AgentRunModelCallCaptureReceipt;
  });
}

/**
 * Broker-selected direct inference after verified preparation found neither a
 * conversation nor a canonical root. This factory grants no event append
 * authority. A canonical run missing its writer must use the durable failure
 * path; executor operation payloads cannot select or change this mode.
 */
export function createEphemeralHostedExecutorModelBroker(
  input: HostedModelBrokerInput & {
    prepared: { conversationId: string | null | undefined; canonicalRootRun: unknown };
  },
): ReadonlyMap<string, ExecutorOperation> {
  if (input.prepared.conversationId !== null || input.prepared.canonicalRootRun !== null) {
    throw new TypeError("Ephemeral model dispatch requires verified non-canonical preparation");
  }
  return createScopedHostedModelBroker(input);
}

function createScopedHostedModelBroker(
  input: HostedModelBrokerInput,
  persist?: (
    request: ExecutorModelDispatch,
    context: ExecutorOperationContext,
  ) => Promise<AgentRunModelCallCaptureReceipt | undefined>,
): ReadonlyMap<string, ExecutorOperation> {
  const binding = parseExecutorModelData(getExecutorBindingSchema(), input.scope.binding);
  const lifetime = input.scope.signal;
  const assertActive = input.scope.assertActive;
  const admission = createExecutorModelAdmission(input.grant, input.allowedModelIds);
  const admit = admission.admit;
  if (!(lifetime instanceof AbortSignal) || typeof assertActive !== "function") {
    throw new TypeError("Hosted model dispatch requires invocation authority");
  }
  const assertScope = (context: ExecutorOperationContext) => {
    if (
      context.binding.allocationId !== binding.allocationId ||
      context.binding.generation !== binding.generation ||
      context.binding.invocationId !== binding.invocationId
    ) throw new TypeError("Hosted model invocation binding mismatch");
    assertActive();
    lifetime.throwIfAborted();
    context.signal.throwIfAborted();
    if (Date.now() >= context.deadline) {
      throw new TypeError("Hosted model dispatch deadline exceeded");
    }
  };
  const operations = createExecutorModelBroker({
    resolveModelRuntime: input.resolveModelRuntime,
    allowedModelIds: input.allowedModelIds,
    normalizeModelCall(request, context) {
      assertScope(context);
      const snapshot = {
        ...request,
        options: snapshotModelCallProviderOptions(request.model, request.options),
      };
      return admission.normalize(snapshot);
    },
    async beforeModelDispatch(request, context) {
      assertScope(context);
      assertPersistedModelOptions(request);
      // Durable callers provide the acknowledging sink. Ephemeral callers
      // perform the same authority/control checks without fabricating events.
      const receipt = await persist?.(request, context);
      assertScope(context);
      const assertActive = () => assertScope(context);
      return {
        assertActive,
        run<T>(operation: () => T): T {
          return runWithVeryfrontCloudModelCallCapture({ receipt, assertActive }, operation);
        },
        dispatchSucceeded() {
          input.skillObservation?.observePrompt(request.options.prompt);
        },
      };
    },
  });
  const bindContext = (context: ExecutorOperationContext): ExecutorOperationContext => {
    assertScope(context);
    return { ...context, signal: AbortSignal.any([lifetime, context.signal]) };
  };
  return new Map(
    mapPrivateArray([...operations], ([name, operation]): [string, ExecutorOperation] => [
      name,
      operation.mode === "unary"
        ? {
          mode: "unary",
          async handle(value, context) {
            const boundContext = bindContext(context);
            let admission: ReturnType<typeof admit> | undefined;
            try {
              admission = name === "model.generate" ? admit(value) : undefined;
              return await operation.handle(admission?.input ?? value, boundContext);
            } catch (error) {
              boundContext.signal.throwIfAborted();
              const failure = executorModelFailure(error);
              if (failure?.code === "RESOURCE_LIMIT_EXCEEDED") return failure;
              throw error;
            } finally {
              admission?.release();
            }
          },
        }
        : {
          mode: "stream",
          async *handle(value, context) {
            const boundContext = bindContext(context);
            let admission: ReturnType<typeof admit> | undefined;
            try {
              admission = name === "model.stream" ? admit(value) : undefined;
              yield* getPrivateAsyncIterator(
                operation.handle(admission?.input ?? value, boundContext),
              );
            } catch (error) {
              boundContext.signal.throwIfAborted();
              const failure = executorModelFailure(error);
              if (failure?.code !== "RESOURCE_LIMIT_EXCEEDED") throw error;
              yield failure;
            } finally {
              admission?.release();
            }
          },
        },
    ]),
  );
}

async function acknowledgePersistence<T>(
  persist: () => T | Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  const aborted = Promise.withResolvers<never>();
  const onAbort = () => aborted.reject(new TypeError("Hosted model persistence cancelled"));
  signal.addEventListener("abort", onAbort, { once: true });
  const persistence = Promise.resolve().then(persist);
  try {
    const result = await Promise.race([persistence, aborted.promise]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", onAbort);
    // The channel notifies cancelled callers independently. Keep the original
    // write inside handler settlement so admission and cleanup deadlines still
    // account for persistence that has not acknowledged or failed yet.
    await persistence.catch(() => {});
  }
}

/**
 * Match the existing durable projection: neutral messages/tools/controls and
 * validated system cache metadata. Provider options and assistant replay
 * metadata remain excluded. The request uses the existing ModelCallRequest
 * subset; toolChoice and userId are not durable event fields.
 * Provider-result assistant content cannot be represented by that contract and
 * refuses hosted dispatch. The broker's local call sequence is not a new
 * durable event field.
 */
function createContextEvent(
  call: ExecutorModelDispatch,
  captureEnabled: boolean,
): AgentRunModelCallContextEvent {
  const options = call.options;
  const modelProvider = resolveModelCallProvider(call.model);
  const request = buildModelCallContextRequest(call.model, options);
  const event: AgentRunModelCallContextEvent = {
    type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED",
    ...(captureEnabled ? { modelCallId: call.identity.modelCallId } : {}),
    ...(call.model.modelId
      ? {
        model: { id: call.model.modelId, ...(modelProvider ? { modelProvider } : {}) },
      }
      : {}),
    messages: mapPrivateArray(options.prompt, projectMessage),
    ...(options.tools ? { tools: mapPrivateArray(options.tools, (tool) => tool) } : {}),
    ...(request ? { request } : {}),
  };
  const snapshot = cloneStructured(event);
  if (!isPrivateConversationRunEvent(executorModelJson(snapshot))) {
    throw new DurableRunEventPersistenceError("Hosted model context cannot be persisted");
  }
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !ArrayIsArray(value);
}

function projectSystemOptions(
  options: Record<string, unknown> | undefined,
): Record<string, JsonValue> | undefined {
  if (!options) return undefined;
  const projected: Record<string, JsonValue> = {};
  forEachPrivateArray(objectEntries(options), ([name, bucket]) => {
    if (!name || !isRecord(bucket) || !isRecord(bucket.cacheControl)) return;
    const { type, ttl } = bucket.cacheControl;
    if (type !== "ephemeral" || (ttl !== undefined && ttl !== "5m" && ttl !== "1h")) return;
    defineOwnDataProperty(projected, name, { cacheControl: { type, ...(ttl ? { ttl } : {}) } });
  });
  return objectKeys(projected).length ? projected : undefined;
}

function projectMessage(message: ModelRuntimeCallOptions["prompt"][number]): ModelCallMessage {
  switch (message.role) {
    case "system": {
      const providerOptions = projectSystemOptions(message.providerOptions);
      return {
        role: "system",
        content: message.content,
        ...(providerOptions ? { providerOptions } : {}),
      };
    }
    case "user":
      return { role: "user", content: mapPrivateArray(message.content, (part) => ({ ...part })) };
    case "tool":
      return { role: "tool", content: mapPrivateArray(message.content, (part) => ({ ...part })) };
    case "assistant":
      return {
        role: "assistant",
        content: mapPrivateArray(message.content, (part) => {
          if (part.type === "text") return { type: "text", text: part.text };
          if (part.type === "tool-call") {
            return {
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
              ...(part.providerExecuted === undefined
                ? {}
                : { providerExecuted: part.providerExecuted }),
            };
          }
          throw new DurableRunEventPersistenceError("Hosted assistant content cannot be persisted");
        }),
      };
  }
}
