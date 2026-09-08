import type { JsonValue } from "#veryfront/schemas/index.ts";
import type {
  ExecutorOperation,
  ExecutorOperationContext,
} from "#veryfront/agent/executor/channel.ts";
import {
  type ExecutorBinding,
  getExecutorBindingSchema,
} from "#veryfront/agent/executor/protocol.ts";

export type ExecutorOperationGateState = "preparing" | "prepared" | "executing" | "revoked";

export interface ExecutorOperationGateOptions {
  binding: ExecutorBinding;
  /** Broker-owned invocation lifetime. Aborting it permanently revokes the gate. */
  signal: AbortSignal;
  operations: ReadonlyMap<string, ExecutorOperation>;
  /** Additional registered read-only operations granted by trusted local construction. */
  preparationOperations?: ReadonlySet<string>;
}

export interface ExecutorOperationGate {
  /** Register this map on the broker's channel. Lifecycle methods stay local. */
  readonly operations: ReadonlyMap<string, ExecutorOperation>;
  readonly state: ExecutorOperationGateState;
  readonly signal: AbortSignal;
  /** Resolves after revocation and completion of original calls, reads and iterator cleanup. */
  readonly settled: Promise<void>;
  markPrepared(): void;
  beginExecution(): void;
  revoke(): void;
}

/**
 * Wrap an invocation's trusted operation map without changing channel encoding.
 * Preparation permits model.metadata, model.prepare, tool.sources and tool.list.
 * Other operations require execution unless explicitly granted for preparation;
 * model.generate, model.stream and tool.execute always require execution.
 *
 * The broker calls markPrepared after runtime preparation, then beginExecution
 * immediately before its agent.stream request. Revoke before closing the session
 * and await settled to release owned resources. Cancellation never races away
 * original work, so noncooperative handlers keep settled pending.
 */
export function createExecutorOperationGate(
  options: ExecutorOperationGateOptions,
): ExecutorOperationGate {
  const parsed = getExecutorBindingSchema().safeParse(options.binding);
  if (!parsed.success) throw new TypeError("Invalid executor operation gate binding");
  const binding = Object.freeze(parsed.data);
  const owner = options.signal;
  if (!(owner instanceof AbortSignal)) {
    throw new TypeError("Executor operation gate requires an owner signal");
  }
  const registered = new Map(options.operations);
  const preparation = new Set(["model.metadata", "model.prepare", "tool.sources", "tool.list"]);
  for (const name of options.preparationOperations ?? []) {
    if (
      !registered.has(name) ||
      name === "model.generate" || name === "model.stream" || name === "tool.execute"
    ) throw new TypeError("Invalid executor preparation operation grant");
    preparation.add(name);
  }
  const controller = new AbortController();
  const settled = Promise.withResolvers<void>();
  let state: ExecutorOperationGateState = "preparing";
  let owned = 0;

  function settle(): void {
    if (state === "revoked" && owned === 0) settled.resolve();
  }

  function release(): void {
    owned--;
    settle();
  }

  function revoke(): void {
    if (state === "revoked") return;
    // Change authority before invoking any handler's synchronous abort listeners.
    state = "revoked";
    owner.removeEventListener("abort", revoke);
    controller.abort(new Error("Executor operation gate revoked"));
    settle();
  }

  function assertActive(): void {
    if (owner.aborted) revoke();
    if (state === "revoked") throw new TypeError("Executor operation gate revoked");
  }

  function admit(name: string, context: ExecutorOperationContext): ExecutorOperationContext {
    assertActive();
    const current = getExecutorBindingSchema().safeParse(context.binding);
    if (
      !current.success || current.data.allocationId !== binding.allocationId ||
      current.data.generation !== binding.generation ||
      current.data.invocationId !== binding.invocationId
    ) throw new TypeError("Executor operation gate binding mismatch");
    if (state !== "executing" && !preparation.has(name)) {
      throw new TypeError("Executor operation requires execution");
    }
    const signal = AbortSignal.any([controller.signal, context.signal]);
    signal.throwIfAborted();
    return { binding, signal, deadline: context.deadline };
  }

  const operations = new Map<string, ExecutorOperation>();
  for (const [name, operation] of registered) {
    if (operation.mode === "unary") {
      const handle = operation.handle.bind(operation);
      operations.set(name, {
        mode: "unary",
        async handle(input, context) {
          const bound = admit(name, context);
          owned++;
          try {
            const result = await handle(input, bound);
            assertActive();
            bound.signal.throwIfAborted();
            return result;
          } finally {
            release();
          }
        },
      });
    } else {
      const handle = operation.handle.bind(operation);
      operations.set(name, {
        mode: "stream",
        handle(input, context) {
          const bound = admit(name, context);
          owned++;
          try {
            const iterator = handle(input, bound)[Symbol.asyncIterator]();
            return ownIterator(iterator, bound.signal, assertActive, release);
          } catch (error) {
            release();
            throw error;
          }
        },
      });
    }
  }
  owner.addEventListener("abort", revoke, { once: true });
  if (owner.aborted) revoke();

  return {
    operations,
    get state() {
      return state;
    },
    signal: controller.signal,
    settled: settled.promise,
    markPrepared() {
      assertActive();
      if (state !== "preparing") throw new TypeError("Executor operation gate is not preparing");
      state = "prepared";
    },
    beginExecution() {
      assertActive();
      if (state !== "prepared") throw new TypeError("Executor operation gate is not prepared");
      state = "executing";
    },
    revoke,
  };
}

function ownIterator(
  iterator: AsyncIterator<JsonValue>,
  signal: AbortSignal,
  assertActive: () => void,
  release: () => void,
): AsyncIterableIterator<JsonValue> {
  let pending: Promise<IteratorResult<JsonValue>> | undefined;
  let closing: Promise<void> | undefined;
  let reading = false;

  function close(): Promise<void> {
    // Publish cleanup before invoking user code, and serialize it after the
    // original next(), even for iterators that do not serialize their methods.
    closing ??= Promise.resolve().then(async () => {
      try {
        await pending?.catch(() => {});
        await iterator.return?.();
      } catch {
        /* Match the channel's opaque, best-effort iterator cleanup. */
      } finally {
        signal.removeEventListener("abort", abort);
        release();
      }
    });
    return closing;
  }

  function abort(): void {
    // Also clean up while the channel is waiting for consumption credit.
    void close().catch(() => {});
  }

  function assertReadable(): void {
    assertActive();
    signal.throwIfAborted();
  }

  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();

  return {
    async next() {
      if (reading) throw new TypeError("Executor stream permits one pending consumer read");
      reading = true;
      try {
        assertReadable();
        if (closing) {
          await closing;
          assertReadable();
          return { done: true, value: undefined };
        }
        pending = Promise.resolve().then(() => {
          assertReadable();
          return closing ? { done: true, value: undefined } : iterator.next();
        });
        const next = await pending;
        pending = undefined;
        assertReadable();
        // The channel aborts on completion or failure before calling return().
        // Keep ownership until that cleanup; awaiting it here can deadlock a
        // return() implementation that waits for the call's abort signal.
        return next;
      } finally {
        reading = false;
      }
    },
    async return() {
      await close();
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
