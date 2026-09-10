import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import {
  createExecutorToolBroker,
  type ExecutorToolCapability,
} from "#veryfront/agent/hosted/executor-tool-bridge.ts";
import { createExecutorRemoteToolSources } from "#veryfront/agent/hosted/executor-tool-remote-facade.ts";

const binding = { allocationId: "allocation", invocationId: "invocation", generation: 1 };
type Outcome =
  | "typed-failure"
  | "untyped-failure"
  | "missing"
  | "malformed"
  | "oversized"
  | "extra"
  | "failure-transport"
  | "transport";

async function fixture(outcome: Outcome, spoofRetirement = false) {
  const outward = new TransformStream<Uint8Array, Uint8Array>();
  const inward = new TransformStream<Uint8Array, Uint8Array>();
  const callerLifetime = new AbortController();
  const retired = Promise.withResolvers<void>();
  let retirementHookCalls = 0;
  if (spoofRetirement) {
    Object.defineProperty(retired.promise, "then", {
      value(release: () => void) {
        retirementHookCalls++;
        release();
        release();
        return Promise.resolve();
      },
    });
  }
  const peer = createExecutorChannel({
    binding,
    operations: new Map<string, ExecutorOperation>([
      ["tool.sources", {
        mode: "stream",
        async *handle(): AsyncGenerator<JsonValue> {
          yield { type: "source", sourceId: "project" };
          yield { type: "complete" };
        },
      }],
      ["tool.execute", {
        mode: "stream",
        async *handle(): AsyncGenerator<JsonValue> {
          if (outcome === "transport") throw new Error("Synthetic remote operation failure");
          if (outcome === "missing") return;
          if (outcome === "malformed") yield { type: "unexpected" };
          else if (outcome === "oversized") yield { type: "result", result: "x".repeat(64) };
          else {
            yield outcome === "untyped-failure"
              ? { type: "failure" }
              : { type: "failure", code: "PERMISSION_DENIED" };
            if (outcome === "extra") yield { type: "result", result: null };
            if (outcome === "failure-transport") {
              throw new Error("Synthetic failure without normal end");
            }
          }
        },
      }],
    ]),
    transport: { readable: outward.readable, writable: inward.writable },
  });
  const channel = createExecutorChannel({
    binding,
    transport: { readable: inward.readable, writable: outward.writable },
  });
  const [project] = await createExecutorRemoteToolSources({
    channel,
    limits: { maxResultBytes: 16 },
  });
  assert(project);
  let hostCalls = 0;
  const operations = createExecutorToolBroker({
    scope: { binding, signal: callerLifetime.signal, assertActive() {} },
    maxCalls: 8,
    maxConcurrent: 1,
    sources: new Map<string, ExecutorToolCapability>([
      ["project", {
        source: project,
        context: {},
        allowedToolNames: new Set(["inspect"]),
        retired: retired.promise,
      }],
      ["host", {
        source: {
          id: "host",
          async listTools() {
            return [];
          },
          async executeTool() {
            hostCalls++;
            return null;
          },
        },
        context: {},
        allowedToolNames: new Set(["inspect"]),
      }],
    ]),
  });
  const operation = operations.get("tool.execute");
  assert(operation?.mode === "stream");
  return {
    callerLifetime,
    retired,
    get retirementHookCalls() {
      return retirementHookCalls;
    },
    get hostCalls() {
      return hostCalls;
    },
    execute(sourceId: string): Promise<JsonValue[]> {
      return Array.fromAsync(operation.handle({ sourceId, toolName: "inspect", args: {} }, {
        binding,
        signal: callerLifetime.signal,
        deadline: Date.now() + 10_000,
      }));
    },
    async close() {
      retired.resolve();
      channel.close();
      peer.close();
      await Promise.all([channel.settled, peer.settled]);
    },
  };
}

describe("remote tool retirement evidence", () => {
  it("observes actual retirement without invoking a replaced promise method", async () => {
    const f = await fixture("missing", true);
    try {
      await f.execute("project");
      assertEquals(f.retirementHookCalls, 0);
      assertEquals(await f.execute("host"), [{ type: "failure", code: "RESOURCE_LIMIT_EXCEEDED" }]);
      assertEquals(f.hostCalls, 0);
      f.retired.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(await f.execute("host"), [{ type: "result", result: null }]);
      assertEquals(f.hostCalls, 1);
    } finally {
      await f.close();
    }
  });

  for (
    const outcome of [
      "missing",
      "malformed",
      "oversized",
      "extra",
      "transport",
      "failure-transport",
    ] as const
  ) {
    it(`retains admission after ${outcome} with a live caller signal`, async () => {
      const f = await fixture(outcome);
      try {
        const result = await f.execute("project");
        assertEquals(result.length, 1);
        assert(result[0] && typeof result[0] === "object" && !Array.isArray(result[0]));
        assertEquals(result[0].type, "failure");
        assertEquals(f.callerLifetime.signal.aborted, false);
        assertEquals(await f.execute("host"), [{
          type: "failure",
          code: "RESOURCE_LIMIT_EXCEEDED",
        }]);
        assertEquals(f.hostCalls, 0);
        f.retired.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        assertEquals(await f.execute("host"), [{ type: "result", result: null }]);
        assertEquals(f.hostCalls, 1);
      } finally {
        await f.close();
      }
    });
  }
  for (const outcome of ["typed-failure", "untyped-failure"] as const) {
    it(`releases admission after a confirmed ${outcome}`, async () => {
      const f = await fixture(outcome);
      try {
        assertEquals(await f.execute("project"), [
          outcome === "typed-failure"
            ? { type: "failure", code: "PERMISSION_DENIED" }
            : { type: "failure" },
        ]);
        assertEquals(await f.execute("host"), [{ type: "result", result: null }]);
        assertEquals(f.hostCalls, 1);
      } finally {
        await f.close();
      }
    });
  }
});
