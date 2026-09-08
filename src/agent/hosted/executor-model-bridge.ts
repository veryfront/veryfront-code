import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { createPrivateReadableStream } from "#veryfront/security/private-stream.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { executorModelFailure, throwExecutorModelFailure } from "./executor-model-errors.ts";
import type {
  ExecutorChannel,
  ExecutorOperation,
  ExecutorOperationContext,
} from "../executor/channel.ts";
import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverRevoker,
} from "../runtime/model-transport.ts";
import {
  executorModelIds,
  executorModelJson,
  type ExecutorModelMetadata,
  getExecutorModelCallSchema,
  getExecutorModelEmptySchema,
  getExecutorModelGenerateResultSchema,
  getExecutorModelMetadataSchema,
  getExecutorModelOptionsSchema,
  getExecutorModelReconciliationResultSchema,
  getExecutorModelReconciliationSchema,
  getExecutorModelRequestSchema,
  getExecutorModelStreamFrameSchema,
  parseExecutorModelData,
} from "./executor-model-schema.ts";

/** Broker-owned identity and owned snapshot for one validated model dispatch. */
export interface ExecutorModelDispatch {
  readonly identity: {
    readonly binding: ExecutorOperationContext["binding"];
    readonly sequence: number;
  };
  readonly mode: "generate" | "stream";
  readonly model: ExecutorModelMetadata;
  readonly options: Omit<ModelRuntimeCallOptions, "headers" | "abortSignal">;
}

/** Recheck owner authority synchronously at the provider invocation boundary. */
export interface ExecutorModelDispatchPermit {
  assertActive(): void;
}

/** Generic broker hook; hosted callers use the required persistence wrapper. */
export type ExecutorModelDispatchGate = (
  request: ExecutorModelDispatch,
  context: ExecutorOperationContext,
) => void | ExecutorModelDispatchPermit | Promise<void | ExecutorModelDispatchPermit>;

/** Synchronous trusted normalization before audit; the returned value is validated and copied. */
export type ExecutorModelCallNormalizer = (
  request: ExecutorModelDispatch,
  context: ExecutorOperationContext,
) => ExecutorModelDispatch["options"];

/**
 * Construct only in trusted ingress. The resolver closes over ingress-owned
 * authority; project discovery, extension registries, and credentials are not
 * part of this operation interface.
 */
export function createExecutorModelBroker(options: {
  resolveModelRuntime: AgentModelRuntimeResolver | undefined;
  allowedModelIds: ReadonlySet<string>;
  beforeModelDispatch?: ExecutorModelDispatchGate;
  normalizeModelCall?: ExecutorModelCallNormalizer;
}): ReadonlyMap<string, ExecutorOperation> {
  const resolve = options.resolveModelRuntime;
  if (typeof resolve !== "function") throw new TypeError("Managed model resolver is required");
  const allowed = executorModelIds(options.allowedModelIds);
  const models = new Map<string, ModelRuntime>();
  const beforeModelDispatch = options.beforeModelDispatch;
  const normalizeModelCall = options.normalizeModelCall;
  let sequence = 0;
  const getModel = (id: string): ModelRuntime => {
    if (!allowed.has(id)) throw new TypeError("Managed model is not allowed");
    const cached = models.get(id);
    if (cached) return cached;
    const model = resolve(id);
    if (!model) throw new TypeError("Managed model is unavailable");
    models.set(id, model);
    return model;
  };
  const parseCall = (input: JsonValue, context: ExecutorOperationContext) => {
    const call = parseExecutorModelData(getExecutorModelCallSchema(), input);
    context.signal.throwIfAborted();
    return {
      modelId: call.modelId,
      model: getModel(call.modelId),
      options: call.options satisfies Omit<ModelRuntimeCallOptions, "headers" | "abortSignal">,
    };
  };
  const authorizeDispatch = async (
    call: ReturnType<typeof parseCall>,
    mode: "generate" | "stream",
    context: ExecutorOperationContext,
  ) => {
    if (sequence === Number.MAX_SAFE_INTEGER) {
      throw new TypeError("Managed model call limit exceeded");
    }
    const callSequence = ++sequence;
    if (beforeModelDispatch || normalizeModelCall) {
      const metadata = parseExecutorModelData(
        getExecutorModelMetadataSchema(),
        executorModelJson([modelMetadata(call.modelId, call.model)]),
      )[0]!;
      const snapshot = (): ExecutorModelDispatch => ({
        identity: { binding: { ...context.binding }, sequence: callSequence },
        mode,
        model: parseExecutorModelData(
          getExecutorModelMetadataSchema(),
          executorModelJson([metadata]),
        )[0]!,
        // Neither normalization nor audit shares mutable options with provider dispatch.
        options: parseExecutorModelData(
          getExecutorModelOptionsSchema(),
          executorModelJson(call.options),
        ),
      });
      if (normalizeModelCall) {
        call.options = parseExecutorModelData(
          getExecutorModelOptionsSchema(),
          executorModelJson(normalizeModelCall(snapshot(), context)),
        );
        context.signal.throwIfAborted();
      }
      return await beforeModelDispatch?.(snapshot(), context);
    }
  };
  return new Map<string, ExecutorOperation>([
    ["model.metadata", {
      mode: "unary",
      handle(input, context) {
        parseExecutorModelData(getExecutorModelEmptySchema(), input);
        context.signal.throwIfAborted();
        const metadata = [...allowed].map((id) => modelMetadata(id, getModel(id)));
        return executorModelJson(
          parseExecutorModelData(getExecutorModelMetadataSchema(), executorModelJson(metadata)),
        );
      },
    }],
    ["model.prepare", {
      mode: "unary",
      async handle(input, context) {
        const { modelId } = parseExecutorModelData(getExecutorModelRequestSchema(), input);
        context.signal.throwIfAborted();
        try {
          await getModel(modelId).prepare?.(context.signal);
        } catch (error) {
          return modelFailureOrThrow(error, context);
        }
        return null;
      },
    }],
    ["model.reconcile", {
      mode: "unary",
      async handle(input, context) {
        const request = parseExecutorModelData(getExecutorModelReconciliationSchema(), input);
        context.signal.throwIfAborted();
        const model = getModel(request.modelId);
        const reconcile = model._reconcileProviderMetadata;
        if (typeof reconcile !== "function") {
          throw new TypeError("Managed model metadata reconciliation is unavailable");
        }
        const providerMetadata = await reconcile.call(model, {
          providerMetadata: request.providerMetadata,
          suppressedToolCalls: request.suppressedToolCalls,
          abortSignal: context.signal,
        });
        context.signal.throwIfAborted();
        return executorModelJson(parseExecutorModelData(
          getExecutorModelReconciliationResultSchema(),
          executorModelJson({ providerMetadata }),
        ));
      },
    }],
    ["model.generate", {
      mode: "unary",
      async handle(input, context) {
        const call = parseCall(input, context);
        let result;
        try {
          const permit = await authorizeDispatch(call, "generate", context);
          context.signal.throwIfAborted();
          permit?.assertActive();
          result = await call.model.doGenerate({ ...call.options, abortSignal: context.signal });
        } catch (error) {
          return modelFailureOrThrow(error, context);
        }
        // Only the neutral result fields leave the broker. Native request and
        // response objects, headers, and transport diagnostics are never copied.
        const data = executorModelJson({
          content: result.content,
          finishReason: result.finishReason,
          usage: result.usage,
          warnings: result.warnings,
          providerMetadata: result.providerMetadata,
        });
        return executorModelJson(
          parseExecutorModelData(getExecutorModelGenerateResultSchema(), data),
        );
      },
    }],
    ["model.stream", {
      mode: "stream",
      async *handle(input, context) {
        const call = parseCall(input, context);
        let result;
        try {
          const permit = await authorizeDispatch(call, "stream", context);
          context.signal.throwIfAborted();
          permit?.assertActive();
          result = await call.model.doStream({ ...call.options, abortSignal: context.signal });
        } catch (error) {
          yield modelFailureOrThrow(error, context);
          return;
        }
        const reader = result.stream.getReader();
        // Later reader.cancel() calls do not wait for the first call's provider cleanup.
        let cancellation: Promise<void> | undefined;
        const cancel = () => {
          if (!cancellation) {
            cancellation = reader.cancel();
            void cancellation.catch(() => {});
          }
          return cancellation;
        };
        context.signal.addEventListener("abort", cancel, { once: true });
        let complete = false;
        try {
          if (context.signal.aborted) {
            cancel();
            context.signal.throwIfAborted();
          }
          yield executorModelJson(
            parseExecutorModelData(
              getExecutorModelStreamFrameSchema(),
              executorModelJson({ type: "start", warnings: result.warnings }),
            ),
          );
          while (true) {
            context.signal.throwIfAborted();
            const next = await reader.read();
            context.signal.throwIfAborted();
            if (next.done) {
              complete = true;
              return;
            }
            throwProviderStreamError(next.value);
            const value = executorModelJson(next.value);
            yield { type: "chunk", value };
          }
        } catch (error) {
          yield modelFailureOrThrow(error, context);
        } finally {
          context.signal.removeEventListener("abort", cancel);
          if (!complete) await cancel().catch(() => {});
          reader.releaseLock();
        }
      },
    }],
  ]);
}

function modelMetadata(id: string, model: ModelRuntime) {
  return {
    id,
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    modelProvider: model.modelProvider,
    executionMode: model.executionMode,
    runtimeCapabilities: model.runtimeCapabilities,
    _generateViaStream: model._generateViaStream,
    ...(typeof model._reconcileProviderMetadata === "function"
      ? { reconcilesProviderMetadata: true }
      : {}),
  };
}

function modelFailureOrThrow(error: unknown, context: ExecutorOperationContext) {
  context.signal.throwIfAborted();
  const failure = executorModelFailure(error);
  if (failure) return failure;
  throw new TypeError("Managed model operation failed");
}

function throwProviderStreamError(value: unknown, rawEnvelope = false): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const type = Object.getOwnPropertyDescriptor(value, "type")?.value;
  // Normalized provider-tool failures are recoverable results, never transport failures.
  if (type === "tool-error" && !rawEnvelope) return;
  const error = Object.getOwnPropertyDescriptor(value, "error");
  if (type === "error" || error) throw error && "value" in error ? error.value : value;
  const rawValue = Object.getOwnPropertyDescriptor(value, "rawValue")?.value;
  if (type === "raw" && rawValue !== undefined) throwProviderStreamError(rawValue, true);
}

/** Received chunks cannot classify failures or expose peer-supplied diagnostics. */
function rejectReceivedStreamError(value: JsonValue, rawEnvelope = false): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  if (value.type === "tool-error" && !rawEnvelope) return;
  if (value.type === "error" || Object.hasOwn(value, "error")) {
    throw new TypeError("Invalid managed model stream chunk");
  }
  if (value.type === "raw" && value.rawValue !== undefined) {
    rejectReceivedStreamError(value.rawValue, true);
  }
}

/**
 * Fetch and validate the complete allowlisted metadata before project runtime
 * preparation. The returned resolver is synchronous, as required by the agent
 * runtime. Unknown managed IDs throw so runtime resolution cannot fall back to
 * project extensions or the global model registry.
 */
export async function createExecutorModelRuntimeResolver(options: {
  channel: ExecutorChannel;
  allowedModelIds: ReadonlySet<string>;
  signal?: AbortSignal;
}): Promise<AgentModelRuntimeResolver> {
  const allowed = executorModelIds(options.allowedModelIds);
  const data = await options.channel.request("model.metadata", {}, { signal: options.signal });
  const metadata = parseExecutorModelData(getExecutorModelMetadataSchema(), data);
  const ids = new Set(metadata.map((entry) => entry.id));
  if (
    metadata.length !== allowed.size || ids.size !== allowed.size ||
    [...ids].some((id) => !allowed.has(id))
  ) {
    throw new TypeError("Invalid managed model metadata");
  }
  const authority = new AbortController();
  let revoked = false;
  const assertActive = () => {
    if (revoked) throw new TypeError("Managed model resolver is revoked");
  };
  const models = new Map(
    metadata.map((
      entry,
    ) => [
      entry.id,
      createExecutorModelRuntime(options.channel, entry, authority.signal, assertActive),
    ]),
  );
  const resolver: AgentModelRuntimeResolver = (id) => {
    const model = models.get(id);
    if (model || id.startsWith("veryfront-cloud/")) assertActive();
    if (model) return model;
    if (id.startsWith("veryfront-cloud/")) throw new TypeError("Managed model is not allowed");
    return undefined;
  };
  // Revoke before abort dispatch, independently of mutable executor abort APIs.
  // The signal cooperatively cancels in-flight calls. Broker-owned revocation
  // and channel closure remain the authority fence for a compromised executor.
  registerModelRuntimeResolverRevoker(resolver, () => {
    revoked = true;
    authority.abort();
  });
  return resolver;
}

function createExecutorModelRuntime(
  channel: ExecutorChannel,
  descriptor: ExecutorModelMetadata,
  authoritySignal: AbortSignal,
  assertActive: () => void,
): ModelRuntime<ModelRuntimeCallOptions> {
  const { id, reconcilesProviderMetadata, ...metadata } = descriptor;
  const withAuthority = (signal?: AbortSignal) =>
    signal ? AbortSignal.any([authoritySignal, signal]) : authoritySignal;
  const makeCall = (options: ModelRuntimeCallOptions) => {
    assertActive();
    if (options.headers !== undefined) {
      throw new TypeError("Managed model header overrides are forbidden");
    }
    const { abortSignal, headers: _headers, ...neutral } = options;
    const data = executorModelJson(neutral);
    parseExecutorModelData(getExecutorModelOptionsSchema(), data);
    return { input: { modelId: id, options: data }, signal: withAuthority(abortSignal) };
  };
  return Object.freeze({
    ...metadata,
    ...(reconcilesProviderMetadata
      ? {
        async _reconcileProviderMetadata(input: {
          providerMetadata: Record<string, unknown>;
          suppressedToolCalls: readonly { id: string; name: string }[];
          abortSignal?: AbortSignal;
        }) {
          assertActive();
          const request = executorModelJson({
            modelId: id,
            providerMetadata: input.providerMetadata,
            suppressedToolCalls: input.suppressedToolCalls,
          });
          parseExecutorModelData(getExecutorModelReconciliationSchema(), request);
          const result = await channel.request("model.reconcile", request, {
            signal: withAuthority(input.abortSignal),
          });
          return parseExecutorModelData(getExecutorModelReconciliationResultSchema(), result)
            .providerMetadata;
        },
      }
      : {}),
    async prepare(signal?: AbortSignal) {
      assertActive();
      const combinedSignal = withAuthority(signal);
      assertActive();
      const result = await channel.request("model.prepare", { modelId: id }, {
        signal: combinedSignal,
      });
      throwExecutorModelFailure(result);
      if (result !== null) throw new TypeError("Invalid managed model preparation result");
    },
    async doGenerate(options: ModelRuntimeCallOptions) {
      const call = makeCall(options);
      assertActive();
      const result = await channel.request("model.generate", call.input, { signal: call.signal });
      throwExecutorModelFailure(result);
      return parseExecutorModelData(getExecutorModelGenerateResultSchema(), result);
    },
    async doStream(options: ModelRuntimeCallOptions) {
      const call = makeCall(options);
      assertActive();
      const iterator = channel.stream("model.stream", call.input, { signal: call.signal });
      try {
        const first = await iterator.next();
        if (first.done) throw new TypeError("Managed model stream start is missing");
        const start = parseExecutorModelData(getExecutorModelStreamFrameSchema(), first.value);
        throwExecutorModelFailure(start);
        if (start.type !== "start") throw new TypeError("Invalid managed model stream start");
        const stream = createPrivateReadableStream<unknown>({
          async pull(controller) {
            try {
              const next = await iterator.next();
              if (next.done) {
                controller.close();
                return;
              }
              const frame = parseExecutorModelData(getExecutorModelStreamFrameSchema(), next.value);
              throwExecutorModelFailure(frame);
              if (frame.type !== "chunk") throw new TypeError("Invalid managed model stream chunk");
              rejectReceivedStreamError(frame.value);
              controller.enqueue(frame.value);
            } catch (error) {
              controller.error(error);
              await iterator.return?.();
            }
          },
          async cancel() {
            await iterator.return?.();
          },
        }, { highWaterMark: 0 });
        return { stream, ...(start.warnings === undefined ? {} : { warnings: start.warnings }) };
      } catch (error) {
        await iterator.return?.();
        throw error;
      }
    },
  });
}
