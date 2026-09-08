import { getPrivateAsyncIterator } from "#veryfront/security/private-iterator.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import {
  buildModelCallContextRequest,
  resolveModelCallProvider,
} from "#veryfront/runtime/model-call-context-request.ts";
import type {
  AgentRunEventSink,
  AgentRunModelCallContextEvent,
  ModelCallMessage,
} from "#veryfront/runtime/model-call-context.ts";
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
}

/**
 * Hosted model operations require a captured, acknowledging run event sink.
 * Use the durable run sink backed by the trusted root mirror. No handler reads
 * caller AsyncLocalStorage or accepts executor-authored event/run identity.
 * Metadata and preparation check invocation authority but emit no call event.
 */
export function createHostedExecutorModelBroker(
  input: HostedModelBrokerInput & {
    runEventSink: AgentRunEventSink | undefined;
  },
): ReadonlyMap<string, ExecutorOperation> {
  const sink = input.runEventSink;
  if (typeof sink !== "function") {
    throw new DurableRunEventPersistenceError("Hosted model dispatch requires a run event sink");
  }
  return createScopedHostedModelBroker(input, async (request, context) => {
    await acknowledgePersistence(() => sink(createContextEvent(request)), context.signal);
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
  persist?: (request: ExecutorModelDispatch, context: ExecutorOperationContext) => Promise<void>,
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
      return admission.normalize(request);
    },
    async beforeModelDispatch(request, context) {
      assertScope(context);
      assertPersistedModelOptions(request);
      // Durable callers provide the acknowledging sink. Ephemeral callers
      // perform the same authority/control checks without fabricating events.
      if (persist) await persist(request, context);
      assertScope(context);
      return { assertActive: () => assertScope(context) };
    },
  });
  const bindContext = (context: ExecutorOperationContext): ExecutorOperationContext => {
    assertScope(context);
    return { ...context, signal: AbortSignal.any([lifetime, context.signal]) };
  };
  return new Map([...operations].map(([name, operation]): [string, ExecutorOperation] => [
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
  ]));
}

async function acknowledgePersistence(
  persist: () => void | Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const aborted = Promise.withResolvers<never>();
  const onAbort = () => aborted.reject(new TypeError("Hosted model persistence cancelled"));
  signal.addEventListener("abort", onAbort, { once: true });
  const persistence = Promise.resolve().then(persist);
  try {
    await Promise.race([persistence, aborted.promise]);
    signal.throwIfAborted();
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
 * subset; toolChoice, responseFormat, and userId are not durable event fields.
 * Reasoning and provider-result assistant content
 * cannot be represented by that contract and refuse hosted dispatch.
 * The broker's local call sequence is not a new durable event field.
 */
function createContextEvent(call: ExecutorModelDispatch): AgentRunModelCallContextEvent {
  const options = call.options;
  const modelProvider = resolveModelCallProvider(call.model);
  const request = buildModelCallContextRequest(call.model, options);
  const event: AgentRunModelCallContextEvent = {
    type: "AGENT_RUN_MODEL_CALL_CONTEXT",
    ...(call.model.modelId
      ? {
        model: { id: call.model.modelId, ...(modelProvider ? { modelProvider } : {}) },
      }
      : {}),
    messages: options.prompt.map(projectMessage),
    ...(options.tools ? { tools: [...options.tools] } : {}),
    ...(request ? { request } : {}),
  };
  const snapshot = structuredClone(event);
  if (!isPrivateConversationRunEvent(executorModelJson(snapshot))) {
    throw new DurableRunEventPersistenceError("Hosted model context cannot be persisted");
  }
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectSystemOptions(
  options: Record<string, unknown> | undefined,
): Record<string, JsonValue> | undefined {
  if (!options) return undefined;
  const projected: Record<string, JsonValue> = {};
  for (const [name, bucket] of Object.entries(options)) {
    if (!name || !isRecord(bucket) || !isRecord(bucket.cacheControl)) continue;
    const { type, ttl } = bucket.cacheControl;
    if (type !== "ephemeral" || (ttl !== undefined && ttl !== "5m" && ttl !== "1h")) continue;
    Object.defineProperty(projected, name, {
      value: { cacheControl: { type, ...(ttl ? { ttl } : {}) } },
      enumerable: true,
    });
  }
  return Object.keys(projected).length ? projected : undefined;
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
      return { role: "user", content: message.content.map((part) => ({ ...part })) };
    case "tool":
      return { role: "tool", content: message.content.map((part) => ({ ...part })) };
    case "assistant":
      return {
        role: "assistant",
        content: message.content.map((part) => {
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
