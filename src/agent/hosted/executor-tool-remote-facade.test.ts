import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { defineError } from "#veryfront/errors/types.ts";
import type { ExecutorChannel } from "../executor/channel.ts";
import { ExecutorAgentError } from "./executor-agent-schema.ts";
import { createExecutorRemoteToolSources } from "./executor-tool-remote-facade.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function scriptedChannel(
  respond: (operation: string) => AsyncIterableIterator<JsonValue>,
  sources: JsonValue[] = [{ type: "source", sourceId: "source-test" }, { type: "complete" }],
) {
  const controller = new AbortController();
  const calls: { operation: string; input: JsonValue }[] = [];
  const channel: ExecutorChannel = {
    ready: Promise.resolve(),
    closed: Promise.withResolvers<Error>().promise,
    signal: controller.signal,
    close() {
      controller.abort();
    },
    async request() {
      throw new Error("Unexpected unary request");
    },
    stream(operation, input) {
      calls.push({ operation, input });
      if (operation === "tool.sources") {
        return (async function* (): AsyncGenerator<JsonValue> {
          yield* sources;
        })();
      }
      return respond(operation);
    },
  };
  return { channel, calls };
}

describe("executor remote tool facade", () => {
  it("rejects duplicate, oversized, extended, and incomplete source discovery", async () => {
    const entry = { type: "source", sourceId: "source-test" };
    for (
      const sources of [
        [entry],
        [entry, entry, { type: "complete" }],
        [entry, { type: "source", sourceId: "second" }, { type: "complete" }],
        [{ ...entry, url: "https://example.test" }, { type: "complete" }],
      ]
    ) {
      const f = scriptedChannel(async function* () {}, sources);
      await assertRejects(() =>
        createExecutorRemoteToolSources({ ...f, limits: { maxSources: 1 } })
      );
      assertEquals(f.calls.length, 1);
    }
    const f = scriptedChannel(async function* () {});
    await assertRejects(() =>
      createExecutorRemoteToolSources({ ...f, limits: { maxMetadataBytes: 10 } })
    );
  });
  it("returns a result only after normal stream completion and local publication", async () => {
    const finished = Promise.withResolvers<void>();
    const published = Promise.withResolvers<void>();
    const arrived = Promise.withResolvers<void>();
    let sourceFinished = false;
    const f = scriptedChannel(async function* (): AsyncGenerator<JsonValue> {
      yield { type: "progress", event: { type: "data", arbitrary: { count: 1 } } };
      yield { type: "result", result: { ok: true } };
      await finished.promise;
      sourceFinished = true;
    });
    const [source] = await createExecutorRemoteToolSources(f);
    let settled = false;
    const result = source!.executeTool("lookup", {}, {
      async publishDataEvent() {
        arrived.resolve();
        await published.promise;
      },
    }).finally(() => {
      settled = true;
    });
    await arrived.promise;
    await tick();
    assertEquals(settled, false);
    published.resolve();
    await tick();
    assertEquals(settled, false);
    finished.resolve();
    assertEquals(await result, { ok: true });
    assert(sourceFinished);
  });

  it("rejects missing, duplicate, misplaced and followed-by-error terminal results without replay", async () => {
    const result = { type: "result", result: "synthetic" };
    for (
      const frames of [
        [],
        [result, result],
        [{ type: "complete" }],
        [result, { type: "progress", event: { type: "late" } }],
        [{ type: "tool", definition: {} }],
        [{ type: "failure", code: "UNKNOWN" }],
        [{ type: "failure", message: "Synthetic private detail" }],
      ]
    ) {
      const f = scriptedChannel(async function* () {
        yield* frames;
      });
      const [source] = await createExecutorRemoteToolSources(f);
      const error = await assertRejects(() => source!.executeTool("lookup", {}), TypeError);
      assert(error instanceof TypeError);
      assertEquals(error.message, "Executor tool operation failed");
      assertEquals(f.calls.filter((call) => call.operation === "tool.execute").length, 1);
    }
    const f = scriptedChannel(async function* () {
      yield result;
      throw new Error("Synthetic transport detail");
    });
    const [source] = await createExecutorRemoteToolSources(f);
    await assertRejects(
      () => source!.executeTool("lookup", {}),
      TypeError,
      "Executor tool operation failed",
    );
    assertEquals(f.calls.length, 2);
  });

  it("reconstructs only exact curated failure frames with fixed local diagnostics", async () => {
    const f = scriptedChannel(async function* () {
      yield { type: "failure", code: "PERMISSION_DENIED" };
    });
    const [source] = await createExecutorRemoteToolSources(f);
    const error = await assertRejects(() => source!.executeTool("lookup", {}), ExecutorAgentError);
    assert(error instanceof ExecutorAgentError);
    assertEquals(error.code, "PERMISSION_DENIED");
    assertEquals(error.message, "PERMISSION_DENIED");
  });

  it("preserves registered local publisher failures with fixed diagnostics and no replay", async () => {
    const registered = defineError({
      slug: "durable-run-event-persistence-failed",
      category: "AGENT",
      status: 500,
      title: "Synthetic private publisher diagnostic",
    }).create();
    for (const asynchronous of [false, true]) {
      let cleaned = false;
      const f = scriptedChannel(async function* (): AsyncGenerator<JsonValue> {
        try {
          yield { type: "progress", event: { type: "progress" } };
          yield { type: "result", result: "unexpected" };
        } finally {
          cleaned = true;
        }
      });
      const [source] = await createExecutorRemoteToolSources(f);
      const error = await assertRejects(() =>
        source!.executeTool("lookup", {}, {
          publishDataEvent() {
            if (asynchronous) return Promise.reject(registered);
            throw registered;
          },
        }), ExecutorAgentError);
      assert(error instanceof ExecutorAgentError);
      assertEquals(error.code, "DURABLE_RUN_EVENT_PERSISTENCE_FAILED");
      assertEquals(error.slug, "durable-run-event-persistence-failed");
      assertEquals(error.message, "DURABLE_RUN_EVENT_PERSISTENCE_FAILED");
      assertEquals(cleaned, true);
      assertEquals(f.calls.length, 2);
    }
  });

  it("keeps unknown local publisher errors and classified transport diagnostics opaque", async () => {
    const registered = defineError({
      slug: "durable-run-event-persistence-failed",
      category: "AGENT",
      status: 500,
      title: "Synthetic private transport diagnostic",
    }).create();
    for (const origin of ["publisher", "transport"] as const) {
      const f = scriptedChannel(async function* (): AsyncGenerator<JsonValue> {
        if (origin === "transport") throw registered;
        yield { type: "progress", event: { type: "progress" } };
        yield { type: "result", result: "unexpected" };
      });
      const [source] = await createExecutorRemoteToolSources(f);
      const error = await assertRejects(() =>
        source!.executeTool("lookup", {}, {
          publishDataEvent() {
            throw new Error("Synthetic private local diagnostic");
          },
        }), TypeError);
      assert(error instanceof TypeError);
      assertEquals(error.message, "Executor tool operation failed");
      assertEquals(f.calls.length, 2);
    }
  });

  it("bounds received metadata and progress and joins stream cancellation", async () => {
    for (const mode of ["metadata", "progress"] as const) {
      const released = Promise.withResolvers<void>();
      const cancelled = Promise.withResolvers<void>();
      const f = scriptedChannel(async function* (): AsyncGenerator<JsonValue> {
        try {
          for (let index = 0; index < 3; index++) {
            if (mode === "metadata") {
              yield {
                type: "tool",
                definition: { name: `tool-${index}`, description: "Synthetic", parameters: {} },
              };
            } else yield { type: "progress", event: { type: "progress" } };
          }
        } finally {
          cancelled.resolve();
          await released.promise;
        }
      });
      const [source] = await createExecutorRemoteToolSources({
        ...f,
        limits: { maxToolsPerSource: 1, maxProgressEvents: 1 },
      });
      let settled = false;
      const result = (mode === "metadata" ? source!.listTools() : source!.executeTool("lookup", {}))
        .finally(() => {
          settled = true;
        });
      void result.catch(() => {});
      await cancelled.promise;
      await tick();
      assertEquals(settled, false);
      released.resolve();
      await assertRejects(() => result, TypeError);
    }
  });

  it("sends only IDs, JSON arguments and correlation, and fixes source identity in the closure", async () => {
    const f = scriptedChannel(async function* () {
      yield { type: "result", result: null };
    });
    const [source] = await createExecutorRemoteToolSources(f);
    await source!.executeTool.call({ id: "substituted" }, "lookup", { url: "data-only" }, {
      url: "https://example.test",
      headers: { auth: "<TOKEN>" },
      projectId: "substituted",
      userId: "substituted",
      runId: "substituted",
      arbitrary: {},
      toolCallId: "call-test",
      progressToken: "progress-test",
    });
    assertEquals(f.calls[1], {
      operation: "tool.execute",
      input: {
        sourceId: "source-test",
        toolName: "lookup",
        args: { url: "data-only" },
        toolCallId: "call-test",
        progressToken: "progress-test",
      },
    });
    f.channel.close();
    await assertRejects(() => source!.executeTool("lookup", {}));
    assertEquals(f.calls.length, 2);
  });
});
