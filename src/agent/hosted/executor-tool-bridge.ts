import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool/types.ts";
import type {
  ExecutorOperation,
  ExecutorOperationContext,
} from "#veryfront/agent/executor/channel.ts";
import {
  type ExecutorBinding,
  getExecutorBindingSchema,
} from "#veryfront/agent/executor/protocol.ts";
import { createExecutorModelFailure } from "#veryfront/agent/hosted/executor-model-errors.ts";
import {
  executorToolBytes,
  type ExecutorToolCall,
  executorToolDefinition,
  executorToolFailure,
  executorToolJson,
  executorToolLimit,
  type ExecutorToolLimits,
  executorToolLimits,
  executorToolProgress,
  getExecutorToolCallSchema,
  getExecutorToolEmptySchema,
  getExecutorToolIdSchema,
  getExecutorToolListSchema,
  parseExecutorToolData,
} from "#veryfront/agent/hosted/executor-tool-schema.ts";

/** Already-scoped capabilities. The source owns exact project, run, and skill policy. */
export interface ExecutorToolCapability {
  readonly source: RemoteToolSource;
  readonly allowedToolNames: ReadonlySet<string>;
  readonly context: ToolExecutionContext;
}

/**
 * Construct once per invocation in trusted ingress. No endpoint, credential,
 * project loader, or caller-authored authority is accepted by these operations.
 * The owner must abort the lifetime and close the channel when it revokes access.
 */
export function createExecutorToolBroker(options: {
  scope: {
    binding: ExecutorBinding;
    signal: AbortSignal;
    assertActive(): void;
  };
  sources: ReadonlyMap<string, ExecutorToolCapability>;
  /** Shared by source enumeration, listing, and execution, including admitted failures. */
  maxCalls: number;
  maxConcurrent: number;
  limits?: Partial<ExecutorToolLimits>;
}): ReadonlyMap<string, ExecutorOperation> {
  const limits = executorToolLimits(options.limits);
  const maxCalls = executorToolLimit(options.maxCalls, 4096);
  const maxConcurrent = executorToolLimit(options.maxConcurrent, 32);
  const binding = parseExecutorToolData(getExecutorBindingSchema(), options.scope.binding);
  const lifetime = options.scope.signal;
  const assertActive = options.scope.assertActive.bind(options.scope);
  if (!(lifetime instanceof AbortSignal) || options.sources.size > limits.maxSources) {
    throw new TypeError("Invalid executor tool authority");
  }
  const sources = new Map<string, {
    source: RemoteToolSource;
    list: RemoteToolSource["listTools"];
    execute: RemoteToolSource["executeTool"];
    allowed: Set<string>;
    context: ToolExecutionContext;
    publisher: ToolExecutionContext["publishDataEvent"];
    publisherReceiver: ToolExecutionContext;
  }>();
  let allowedTools = 0;
  let sourceCount = 0;
  let metadataBytes = 0;
  let metadataTools = 0;
  const accountMetadata = (data: JsonValue) => {
    metadataBytes += executorToolBytes(data);
    if (metadataBytes > limits.maxMetadataBytes) {
      throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
    }
  };
  for (const [id, capability] of options.sources) {
    if (
      ++sourceCount > limits.maxSources || sources.has(id) || !capability.context ||
      capability.source.id !== id || typeof capability.source.listTools !== "function" ||
      typeof capability.source.executeTool !== "function" ||
      capability.allowedToolNames.size > limits.maxToolsPerSource
    ) {
      throw new TypeError("Invalid executor tool capability");
    }
    parseExecutorToolData(getExecutorToolIdSchema(), id);
    const allowed = new Set<string>();
    for (const name of capability.allowedToolNames) {
      if (++allowedTools > limits.maxTotalTools || allowed.size >= limits.maxToolsPerSource) {
        throw new TypeError("Executor tool allowlist exceeds its limit");
      }
      allowed.add(parseExecutorToolData(getExecutorToolIdSchema(), name));
    }
    sources.set(id, {
      source: capability.source,
      list: capability.source.listTools,
      execute: capability.source.executeTool,
      allowed,
      context: { ...capability.context },
      publisher: capability.context.publishDataEvent,
      publisherReceiver: capability.context,
    });
  }
  let calls = 0;
  let active = 0;
  const assertScope = (context: ExecutorOperationContext) => {
    if (
      context.binding.allocationId !== binding.allocationId ||
      context.binding.generation !== binding.generation ||
      context.binding.invocationId !== binding.invocationId
    ) {
      throw new TypeError("Executor tool invocation binding mismatch");
    }
    assertActive();
    lifetime.throwIfAborted();
    context.signal.throwIfAborted();
    if (Date.now() >= context.deadline) throw new TypeError("Executor tool deadline exceeded");
  };

  async function* handle(
    mode: "sources" | "list" | "execute",
    value: JsonValue,
    operation: ExecutorOperationContext,
  ): AsyncGenerator<JsonValue> {
    let admitted = false;
    try {
      assertScope(operation);
      if (calls >= maxCalls || active >= maxConcurrent) {
        throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
      }
      calls++;
      active++;
      admitted = true;
      if (mode === "sources") {
        parseExecutorToolData(getExecutorToolEmptySchema(), value);
        for (const sourceId of sources.keys()) {
          assertScope(operation);
          const frame = { type: "source", sourceId };
          accountMetadata(frame);
          yield frame;
        }
        assertScope(operation);
        yield { type: "complete" };
        return;
      }
      const call = mode === "execute"
        ? parseExecutorToolData(getExecutorToolCallSchema(), value)
        : undefined;
      const request = call ?? parseExecutorToolData(getExecutorToolListSchema(), value);
      const capability = sources.get(request.sourceId);
      if (!capability) throw new TypeError("Executor tool source is not allowed");
      const assertCall = () => {
        assertScope(operation);
        capability.context.abortSignal?.throwIfAborted();
      };
      if (call) {
        if (!capability.allowed.has(call.toolName)) {
          throw new TypeError("Executor tool is not allowed");
        }
        executorToolJson(call.args, limits.maxArgumentBytes);
      }
      const result = yield* callWithProgress({
        invoke: (context) =>
          call
            ? capability.execute.call(capability.source, call.toolName, call.args, context)
            : capability.list.call(capability.source, context),
        context: capability.context,
        publisher: capability.publisher,
        publisherReceiver: capability.publisherReceiver,
        correlation: request,
        signal: AbortSignal.any([
          lifetime,
          operation.signal,
          ...(capability.context.abortSignal ? [capability.context.abortSignal] : []),
        ]),
        assertActive: assertCall,
        limits,
      });
      assertCall();
      if (mode === "execute") {
        yield executorToolJson({
          type: "result",
          result: executorToolJson(result, limits.maxResultBytes),
        });
      } else {
        if (
          !Array.isArray(result) || result.length > limits.maxToolsPerSource ||
          metadataTools + result.length > limits.maxTotalTools
        ) {
          throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
        }
        metadataTools += result.length;
        const names = new Set<string>();
        const frames: JsonValue[] = [];
        // Snapshot the bounded catalog before the first yield. A stateful
        // source may reuse or mutate its array while the consumer is paused.
        for (const raw of result) {
          const definition = executorToolDefinition(raw, limits);
          if (names.has(definition.name)) throw new TypeError("Duplicate executor tool definition");
          names.add(definition.name);
          const frame = executorToolJson({ type: "tool", definition });
          accountMetadata(frame);
          if (capability.allowed.has(definition.name)) frames.push(frame);
        }
        for (const frame of frames) {
          assertCall();
          yield frame;
        }
        assertCall();
        yield { type: "complete" };
      }
    } catch (error) {
      // Cancellation belongs to the channel, and revocation never releases late data.
      assertScope(operation);
      yield executorToolJson(executorToolFailure(error));
    } finally {
      if (admitted) active--;
    }
  }

  return new Map([
    ["tool.sources", {
      mode: "stream",
      handle: (value, context) => handle("sources", value, context),
    }],
    ["tool.list", { mode: "stream", handle: (value, context) => handle("list", value, context) }],
    ["tool.execute", {
      mode: "stream",
      handle: (value, context) => handle("execute", value, context),
    }],
  ]);
}

/** Keep original execution and publisher promises inside the channel handler lifetime. */
async function* callWithProgress(options: {
  invoke(context: ToolExecutionContext): Promise<unknown>;
  context: ToolExecutionContext;
  publisher: ToolExecutionContext["publishDataEvent"];
  publisherReceiver: ToolExecutionContext;
  correlation: Pick<ExecutorToolCall, "toolCallId" | "progressToken">;
  signal: AbortSignal;
  assertActive(): void;
  limits: ExecutorToolLimits;
}): AsyncGenerator<JsonValue, unknown> {
  const abort = new AbortController();
  const signal = AbortSignal.any([options.signal, abort.signal]);
  type Acknowledgement = ReturnType<typeof Promise.withResolvers<void>>;
  const queue: {
    frame: JsonValue;
    bytes: number;
    work: Promise<void>;
    acknowledgement: Acknowledgement;
  }[] = [];
  const pending = new Set<Promise<void>>();
  const acknowledgements = new Set<Acknowledgement>();
  let wake: (() => void) | undefined;
  let accepting = true;
  let settled = false;
  let failed = false;
  let failure: unknown;
  let result: unknown;
  let count = 0;
  let totalBytes = 0;
  let retainedCount = 0;
  let retainedBytes = 0;
  const fail = (error: unknown) => {
    if (!failed) {
      failed = true;
      failure = error;
    }
    accepting = false;
    abort.abort();
    wake?.();
  };
  const check = () => {
    options.assertActive();
    signal.throwIfAborted();
  };
  const rejectAcknowledgements = () => {
    const reason = failed ? failure : new TypeError("Executor tool publication cancelled");
    for (const acknowledgement of acknowledgements) acknowledgement.reject(reason);
    acknowledgements.clear();
  };
  const notifyAbort = () => {
    accepting = false;
    rejectAcknowledgements();
    wake?.();
  };
  signal.addEventListener("abort", notifyAbort, { once: true });
  const context: ToolExecutionContext = {
    ...options.context,
    toolCallId: options.correlation.toolCallId,
    progressToken: options.correlation.progressToken,
    abortSignal: signal,
    publishDataEvent(event) {
      // Throw synchronously after closure or overflow: ignored calls cannot
      // allocate an unbounded collection of rejected publisher promises.
      try {
        if (!accepting) throw new TypeError("Executor tool publisher is closed");
        check();
        const snapshot = executorToolProgress(event, options.limits);
        const frame = executorToolJson({ type: "progress", event: snapshot });
        const bytes = executorToolBytes(frame);
        if (
          ++count > options.limits.maxProgressEvents ||
          (totalBytes += bytes) > options.limits.maxProgressBytes ||
          retainedCount >= options.limits.maxQueuedProgress ||
          retainedBytes + bytes > options.limits.maxQueuedProgressBytes
        ) {
          throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
        }
        retainedCount++;
        retainedBytes += bytes;
        const publication = Promise.withResolvers<void>();
        const work = publication.promise;
        const acknowledgement = Promise.withResolvers<void>();
        acknowledgements.add(acknowledgement);
        // Ignored publications still have an observed, bounded acknowledgement.
        void acknowledgement.promise.catch(() => {});
        pending.add(work);
        void work.then(() => pending.delete(work), (error) => {
          pending.delete(work);
          fail(error);
        });
        queue.push({ frame, bytes, work, acknowledgement });
        try {
          // Start the original callback synchronously, after reserving space.
          // Keep its promise joined even if the next publication overflows.
          // A separate snapshot prevents it from changing queued wire data.
          const original = options.publisher?.call(options.publisherReceiver, snapshot);
          void Promise.resolve(original).then(() => {
            try {
              check();
              publication.resolve();
            } catch (error) {
              publication.reject(error);
            }
          }, publication.reject);
        } catch (error) {
          fail(error);
          publication.reject(error);
        }
        wake?.();
        return acknowledgement.promise;
      } catch (error) {
        fail(error);
        throw error;
      }
    },
  };
  const execution = Promise.resolve().then(() => {
    check();
    return options.invoke(context);
  }).then((value) => {
    result = value;
  }, fail).finally(() => {
    accepting = false;
    settled = true;
    wake?.();
  });
  try {
    while (true) {
      if (failed) throw failure;
      check();
      const next = queue.shift();
      if (next) {
        await next.work;
        if (failed) throw failure;
        check();
        yield next.frame;
        check();
        retainedCount--;
        retainedBytes -= next.bytes;
        // Resuming after yield means the channel drained this frame. Release
        // its slot before waking a cooperative producer for the next event.
        acknowledgements.delete(next.acknowledgement);
        next.acknowledgement.resolve();
      } else if (settled) break;
      else {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
    return result;
  } catch (error) {
    // A publisher finishing after overflow observes abort too. Preserve the
    // first failure rather than replacing it with that secondary rejection.
    throw failed ? failure : error;
  } finally {
    accepting = false;
    abort.abort();
    // A source can be awaiting publication when the iterator returns. Release
    // those waits before joining it, while keeping original publisher work owned.
    rejectAcknowledgements();
    signal.removeEventListener("abort", notifyAbort);
    await execution;
    await Promise.allSettled(pending);
    queue.length = 0;
  }
}
