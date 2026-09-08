import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
  type ExecutorOperationContext,
} from "./channel.ts";
import { createExecutorOperationGate } from "./operation-gate.ts";
import { EXECUTOR_STREAM_WINDOW, type ExecutorBinding } from "./protocol.ts";

const binding: ExecutorBinding = {
  allocationId: "allocation-test",
  generation: 1,
  invocationId: "invocation-test",
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function context(signal = new AbortController().signal): ExecutorOperationContext {
  return { binding, signal, deadline: Date.now() + 5_000 };
}

function pair(operations: ReadonlyMap<string, ExecutorOperation>, options: {
  maxConcurrentCalls?: number;
  channelBinding?: ExecutorBinding;
  preparationOperations?: ReadonlySet<string>;
} = {}) {
  const owner = new AbortController();
  const gate = createExecutorOperationGate({
    binding,
    signal: owner.signal,
    operations,
    preparationOperations: options.preparationOperations,
  });
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const channelOptions = {
    binding: options.channelBinding ?? binding,
    maxConcurrentCalls: options.maxConcurrentCalls,
  };
  const caller = createExecutorChannel({
    ...channelOptions,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const receiver = createExecutorChannel({
    ...channelOptions,
    operations: gate.operations,
    transport: { readable: forward.readable, writable: backward.writable },
  });
  return {
    gate,
    owner,
    caller,
    receiver,
    async close() {
      gate.revoke();
      caller.close();
      await receiver.closed;
      await gate.settled;
    },
  };
}

describe("executor operation gate", () => {
  it("allows readiness but requires local execution admission for privileged and new operations", async () => {
    const invoked: string[] = [];
    const readiness = ["model.metadata", "model.prepare", "tool.sources", "tool.list"];
    const execution = ["model.generate", "tool.execute", "model.reconcile", "new.operation"];
    const operations = new Map<string, ExecutorOperation>(
      [...readiness, ...execution].map((name) => [name, {
        mode: "unary",
        handle: (input) => {
          invoked.push(name);
          return input;
        },
      }]),
    );
    operations.set("model.stream", {
      mode: "stream",
      async *handle(input) {
        invoked.push("model.stream");
        yield input;
      },
    });
    const fixture = pair(operations);
    const { gate, caller } = fixture;
    try {
      for (const state of ["preparing", "prepared"] as const) {
        assertEquals(gate.state, state);
        for (const name of readiness) assertEquals(await caller.request(name, name), name);
        for (const name of execution) {
          await assertRejects(() => caller.request(name, null), Error, "operation-failed");
        }
        const denied = caller.stream("model.stream", null);
        await assertRejects(() => denied.next(), Error, "operation-failed");
        await denied.return!();
        for (const name of ["markPrepared", "beginExecution", "revoke"]) {
          await assertRejects(() => caller.request(name, null), Error, "operation-not-found");
        }
        assertEquals(invoked, state === "preparing" ? readiness : [...readiness, ...readiness]);
        if (state === "preparing") gate.markPrepared();
      }
      gate.beginExecution();
      for (const name of execution) assertEquals(await caller.request(name, name), name);
      const chunks = [];
      for await (const chunk of caller.stream("model.stream", { value: 1 })) chunks.push(chunk);
      assertEquals(chunks, [{ value: 1 }]);
      assertEquals(gate.operations.get("model.stream")?.mode, "stream");
      await assertRejects(() => caller.request("model.stream", null), Error, "mode-mismatch");
      assertEquals(caller.signal.aborted, false);
      gate.revoke();
      for (const name of [...readiness, ...execution]) {
        await assertRejects(() => caller.request(name, null), Error, "operation-failed");
      }
      const denied = caller.stream("model.stream", null);
      await assertRejects(() => denied.next(), Error, "operation-failed");
      await denied.return!();
    } finally {
      await fixture.close();
    }
  });

  it("accepts only explicit local preparation grants and snapshots registration", async () => {
    const operations = new Map<string, ExecutorOperation>([
      ["custom.read", { mode: "unary", handle: () => "read" }],
      ["custom.write", { mode: "unary", handle: () => "write" }],
    ]);
    const grants = new Set(["custom.read"]);
    const fixture = pair(operations, { preparationOperations: grants });
    try {
      grants.add("custom.write");
      operations.set("custom.read", { mode: "unary", handle: () => "replacement" });
      assertEquals(await fixture.caller.request("custom.read", null), "read");
      await assertRejects(
        () => fixture.caller.request("custom.write", null),
        Error,
        "operation-failed",
      );
      for (const name of ["model.generate", "model.stream", "tool.execute", "unregistered"]) {
        assertThrows(() =>
          createExecutorOperationGate({
            binding,
            signal: new AbortController().signal,
            operations: new Map<string, ExecutorOperation>([
              ["model.generate", { mode: "unary", handle: () => null }],
              ["model.stream", {
                mode: "stream",
                handle: async function* () {
                  yield null;
                },
              }],
              ["tool.execute", { mode: "unary", handle: () => null }],
            ]),
            preparationOperations: new Set([name]),
          }), TypeError);
      }
    } finally {
      await fixture.close();
    }
  });

  it("requires each local stage transition once and settles only after revocation", async () => {
    const gate = createExecutorOperationGate({
      binding,
      operations: new Map(),
      signal: new AbortController().signal,
    });
    let settled = false;
    void gate.settled.then(() => settled = true);
    assertThrows(() => gate.beginExecution(), TypeError);
    assertEquals(gate.state, "preparing");
    gate.markPrepared();
    assertThrows(() => gate.markPrepared(), TypeError);
    assertEquals(gate.state, "prepared");
    gate.beginExecution();
    assertThrows(() => gate.beginExecution(), TypeError);
    assertThrows(() => gate.markPrepared(), TypeError);
    assertEquals(gate.state, "executing");
    await tick();
    assertEquals(settled, false);
    gate.revoke();
    gate.revoke();
    assertEquals(gate.state, "revoked");
    assertThrows(() => gate.markPrepared(), TypeError);
    assertThrows(() => gate.beginExecution(), TypeError);
    await gate.settled;
    assertEquals(settled, true);

    for (const prepared of [false, true]) {
      const owner = new AbortController();
      if (!prepared) owner.abort();
      const gate = createExecutorOperationGate({
        binding,
        signal: owner.signal,
        operations: new Map(),
      });
      if (prepared) {
        gate.markPrepared();
        owner.abort();
      }
      assertEquals(gate.state, "revoked");
      await gate.settled;
    }
  });

  it("validates every binding field even on a channel with a valid different binding", async () => {
    let dispatched = 0;
    const operations = new Map<string, ExecutorOperation>([["model.metadata", {
      mode: "unary",
      handle: () => ++dispatched,
    }]]);
    for (
      const different of [
        { ...binding, allocationId: "other-allocation" },
        { ...binding, generation: 2 },
        { ...binding, invocationId: "other-invocation" },
      ]
    ) {
      const fixture = pair(operations, { channelBinding: different });
      try {
        await assertRejects(
          () => fixture.caller.request("model.metadata", null),
          Error,
          "operation-failed",
        );
        assertEquals(fixture.caller.signal.aborted, false);
      } finally {
        await fixture.close();
      }
    }
    assertEquals(dispatched, 0);
    assertThrows(() =>
      createExecutorOperationGate({
        binding: { ...binding, generation: 0 },
        signal: new AbortController().signal,
        operations,
      })
    );
  });

  it("preserves active results, errors and context while combining cancellation signals", async () => {
    const original = { result: [1, null] };
    const failure = new Error("synthetic private failure");
    let observed: ExecutorOperationContext | undefined;
    const owner = new AbortController();
    const gate = createExecutorOperationGate({
      binding,
      signal: owner.signal,
      operations: new Map([["model.metadata", {
        mode: "unary",
        handle(input, current) {
          observed = current;
          if (input) throw failure;
          return original;
        },
      }]]),
    });
    const operation = gate.operations.get("model.metadata")!;
    assert(operation.mode === "unary");
    const call = new AbortController();
    const current = context(call.signal);
    try {
      assertStrictEquals(await operation.handle(null, current), original);
      assertEquals(observed?.binding, binding);
      assertEquals(observed?.deadline, current.deadline);
      assert(observed?.signal !== call.signal);
      assertEquals(observed?.signal.aborted, false);
      assertStrictEquals(
        await assertRejects(async () => await operation.handle(true, current)),
        failure,
      );
      call.abort();
      assertEquals(observed?.signal.aborted, true);
      assertEquals(gate.signal.aborted, false);
      await assertRejects(async () => await operation.handle(null, current));
    } finally {
      gate.revoke();
      await gate.settled;
    }
  });

  it("revokes before abort listeners can reenter handlers or transitions", async () => {
    for (const fromOwner of [false, true]) {
      const release = Promise.withResolvers<void>();
      const started = Promise.withResolvers<AbortSignal>();
      let dispatched = 0;
      const fixture = pair(
        new Map([["model.generate", {
          mode: "unary",
          async handle(_, { signal }) {
            dispatched++;
            started.resolve(signal);
            await release.promise;
            return "late";
          },
        }]]),
      );
      const { gate, caller, owner } = fixture;
      gate.markPrepared();
      gate.beginExecution();
      const result = caller.request("model.generate", null);
      const rejected = assertRejects(() => result, Error, "operation-failed");
      const signal = await started.promise;
      let reentered: Promise<unknown> | undefined;
      signal.addEventListener("abort", () => {
        assertEquals(gate.state, "revoked");
        assertThrows(() => gate.beginExecution(), TypeError);
        gate.revoke();
        const operation = gate.operations.get("model.generate")!;
        assert(operation.mode === "unary");
        reentered = assertRejects(async () => await operation.handle(null, context()));
      }, { once: true });
      try {
        if (fromOwner) owner.abort();
        else gate.revoke();
        assertEquals(signal.aborted, true);
        assert(reentered);
        await reentered;
        assertEquals(dispatched, 1);
      } finally {
        release.resolve();
        await rejected;
        await fixture.close();
      }
    }
  });

  it("retains deferred unary work and channel capacity after cancellation notification", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<void>();
    const fixture = pair(
      new Map<string, ExecutorOperation>([
        ["model.generate", {
          mode: "unary",
          async handle(_, { signal }) {
            started.resolve(signal);
            await release.promise;
            return "late result";
          },
        }],
        ["model.metadata", { mode: "unary", handle: () => null }],
      ]),
      { maxConcurrentCalls: 1 },
    );
    const { gate, caller } = fixture;
    gate.markPrepared();
    gate.beginExecution();
    const call = new AbortController();
    const request = caller.request("model.generate", null, { signal: call.signal });
    let completed = false;
    const rejected = assertRejects(() => request, Error).then(() => completed = true);
    let settled = false;
    void gate.settled.then(() => settled = true);
    try {
      const signal = await started.promise;
      call.abort();
      await tick();
      assertEquals(signal.aborted, true);
      assertEquals(completed, false);
      await assertRejects(() => caller.request("model.metadata", null), Error, "concurrent");
      gate.revoke();
      await tick();
      assertEquals(settled, false);
      caller.close();
      await tick();
      assertEquals(settled, false);
    } finally {
      release.resolve();
      await rejected;
      await fixture.close();
    }
  });

  it("keeps a pending stream read and iterator return owned after revocation", async () => {
    const reading = Promise.withResolvers<void>();
    const read = Promise.withResolvers<IteratorResult<JsonValue>>();
    const cleaning = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    let reads = 0;
    let returns = 0;
    let signal: AbortSignal | undefined;
    const fixture = pair(
      new Map([["model.stream", {
        mode: "stream",
        handle(_, current) {
          signal = current.signal;
          return {
            [Symbol.asyncIterator]() {
              return {
                next() {
                  reads++;
                  reading.resolve();
                  return read.promise;
                },
                async return() {
                  returns++;
                  cleaning.resolve();
                  await cleanup.promise;
                  return { done: true, value: undefined };
                },
              };
            },
          };
        },
      }]]),
      { maxConcurrentCalls: 1 },
    );
    const { gate, caller } = fixture;
    gate.markPrepared();
    gate.beginExecution();
    const stream = caller.stream("model.stream", null);
    const rejected = assertRejects(() => stream.next(), Error, "operation-failed");
    let settled = false;
    void gate.settled.then(() => settled = true);
    try {
      await reading.promise;
      gate.revoke();
      assertEquals(signal?.aborted, true);
      await tick();
      assertEquals(settled, false);
      assertEquals(returns, 0);
      read.resolve({ done: false, value: "late chunk" });
      await cleaning.promise;
      assertEquals(settled, false);
      await assertRejects(() => caller.request("model.metadata", null), Error, "concurrent");
      cleanup.resolve();
      await rejected;
      await stream.return!();
      await gate.settled;
      assertEquals(reads, 1);
      assertEquals(returns, 1);
    } finally {
      read.resolve({ done: true, value: undefined });
      cleanup.resolve();
      await fixture.close();
    }
  });

  it("waits for every owned call after revocation", async () => {
    const started = Promise.withResolvers<void>();
    const releases = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    let calls = 0;
    const fixture = pair(
      new Map([["model.generate", {
        mode: "unary",
        async handle() {
          const release = releases[calls++]!;
          if (calls === 2) started.resolve();
          await release.promise;
          return "late result";
        },
      }]]),
    );
    const { gate, caller } = fixture;
    gate.markPrepared();
    gate.beginExecution();
    const results = releases.map(() =>
      assertRejects(() => caller.request("model.generate", null), Error, "operation-failed")
    );
    let settled = false;
    void gate.settled.then(() => settled = true);
    try {
      await started.promise;
      gate.revoke();
      releases[0]!.resolve();
      await results[0];
      assertEquals(settled, false);
      releases[1]!.resolve();
      await Promise.all(results);
      await gate.settled;
    } finally {
      for (const release of releases) release.resolve();
      await fixture.close();
    }
  });

  it("retains iterator cleanup and admission after the consumer cancels", async () => {
    const cleaning = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const fixture = pair(
      new Map<string, ExecutorOperation>([
        ["model.stream", {
          mode: "stream",
          async *handle() {
            try {
              while (true) yield 1;
            } finally {
              cleaning.resolve();
              await cleanup.promise;
            }
          },
        }],
        ["model.metadata", { mode: "unary", handle: () => "metadata" }],
      ]),
      { maxConcurrentCalls: 1 },
    );
    const { gate, caller } = fixture;
    gate.markPrepared();
    gate.beginExecution();
    try {
      const stream = caller.stream("model.stream", null);
      await stream.next();
      let completed = false;
      const returning = stream.return!().then(() => completed = true);
      await cleaning.promise;
      await tick();
      assertEquals(completed, false);
      await assertRejects(() => caller.request("model.metadata", null), Error, "concurrent");
      cleanup.resolve();
      await returning;
      assertEquals(await caller.request("model.metadata", null), "metadata");
    } finally {
      cleanup.resolve();
      await fixture.close();
    }
  });

  it("preserves stream completion when iterator cleanup fails", async () => {
    const fixture = pair(
      new Map([["model.stream", {
        mode: "stream",
        handle() {
          let read = false;
          return {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  if (read) return { done: true as const, value: undefined };
                  read = true;
                  return { done: false as const, value: "result" };
                },
                async return(): Promise<IteratorResult<JsonValue>> {
                  throw new Error("synthetic private cleanup failure");
                },
              };
            },
          };
        },
      }]]),
    );
    fixture.gate.markPrepared();
    fixture.gate.beginExecution();
    try {
      const values = [];
      for await (const value of fixture.caller.stream("model.stream", null)) values.push(value);
      assertEquals(values, ["result"]);
    } finally {
      await fixture.close();
    }
  });

  it("lets channel completion abort the call before awaiting iterator cleanup", async () => {
    for (const fails of [false, true]) {
      const cleaning = Promise.withResolvers<boolean>();
      const cleanup = Promise.withResolvers<void>();
      const fixture = pair(
        new Map([["model.stream", {
          mode: "stream",
          handle(_, { signal }) {
            return {
              [Symbol.asyncIterator]() {
                return {
                  async next(): Promise<IteratorResult<JsonValue>> {
                    if (fails) throw new Error("synthetic private stream failure");
                    return { done: true, value: undefined };
                  },
                  async return(): Promise<IteratorResult<JsonValue>> {
                    cleaning.resolve(signal.aborted);
                    await cleanup.promise;
                    return { done: true, value: undefined };
                  },
                };
              },
            };
          },
        }]]),
      );
      fixture.gate.markPrepared();
      fixture.gate.beginExecution();
      const stream = fixture.caller.stream("model.stream", null);
      const outcome = stream.next().then(() => "completed", () => "failed");
      try {
        assertEquals(await cleaning.promise, true);
        cleanup.resolve();
        assertEquals(await outcome, fails ? "failed" : "completed");
        await stream.return!();
      } finally {
        cleanup.resolve();
        await outcome;
        await fixture.close();
      }
    }
  });

  it("cleans up a stream at the credit window without waiting for more consumption", async () => {
    const cleaning = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const filled = Promise.withResolvers<void>();
    let produced = 0;
    const fixture = pair(
      new Map([["model.stream", {
        mode: "stream",
        async *handle() {
          try {
            while (true) {
              produced++;
              if (produced === EXECUTOR_STREAM_WINDOW) filled.resolve();
              yield produced;
            }
          } finally {
            cleaning.resolve();
            await cleanup.promise;
          }
        },
      }]]),
    );
    const { gate, caller } = fixture;
    gate.markPrepared();
    gate.beginExecution();
    const stream = caller.stream("model.stream", null);
    let settled = false;
    void gate.settled.then(() => settled = true);
    try {
      await filled.promise;
      await tick();
      gate.revoke();
      await cleaning.promise;
      assertEquals(settled, false);
      assertEquals(produced, EXECUTOR_STREAM_WINDOW);
      cleanup.resolve();
      await gate.settled;
      caller.close();
      await assertRejects(() => stream.next(), Error, "closed");
    } finally {
      cleanup.resolve();
      await fixture.close();
    }
  });
});
