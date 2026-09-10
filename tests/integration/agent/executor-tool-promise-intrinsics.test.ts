import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { createExecutorToolBroker } from "#veryfront/agent/hosted/executor-tool-bridge.ts";
import { chainPrivatePromise, observePrivatePromise } from "#veryfront/security/private-promise.ts";

it("does not release admission when a source promise is hidden by hostile promise hooks", async () => {
  const done = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const binding = { allocationId: "allocation", generation: 1, invocationId: "invocation" };
  const signal = new AbortController().signal;
  const operations = createExecutorToolBroker({
    scope: { binding, signal, assertActive() {} },
    sources: new Map([["project", {
      context: {},
      allowedToolNames: new Set(["inspect"]),
      source: {
        id: "project",
        async listTools() {
          return [];
        },
        executeTool() {
          started.resolve();
          return done.promise;
        },
      },
    }]]),
    maxCalls: 8,
    maxConcurrent: 1,
  });
  const operation = operations.get("tool.execute");
  assert(operation?.mode === "stream");
  const iterator = operation.handle({ sourceId: "project", toolName: "inspect", args: {} }, {
    binding,
    signal,
    deadline: Date.now() + 10_000,
  })[Symbol.asyncIterator]();
  assert(iterator.return);
  const originalThen = Promise.prototype.then;
  const apply = Reflect.apply;
  const timer = new Promise<void>((resolve) => setTimeout(resolve, 20));
  let closed = false;
  let closing: Promise<IteratorResult<JsonValue>> | undefined;
  try {
    // Force assimilation only for the source promise. Broad constructor/then
    // replacement also affects the Node test runner's own scheduling.
    Object.defineProperty(done.promise, "constructor", {
      configurable: true,
      writable: true,
      value: function ProjectPromise() {},
    });
    Promise.prototype.then = function (this: Promise<unknown>, fulfilled, rejected) {
      if (this === done.promise) {
        if (typeof fulfilled === "function") fulfilled({ forged: true });
        return Promise.resolve();
      }
      return apply(originalThen, this, [fulfilled, rejected]);
    } as typeof originalThen;
    let observedHook = false;
    void done.promise.then(() => {
      observedHook = true;
    });
    assertEquals(observedHook, true);
    void iterator.next().catch(() => {});
    await started.promise;
    closing = iterator.return();
    void chainPrivatePromise(closing, () => {
      closed = true;
    }, () => {
      closed = true;
    });
    await observePrivatePromise(timer);
    assertEquals(closed, false);
    done.resolve();
  } finally {
    done.resolve();
    Promise.prototype.then = originalThen;
    delete (done.promise as { constructor?: unknown }).constructor;
  }
  await observePrivatePromise(closing!);
});
