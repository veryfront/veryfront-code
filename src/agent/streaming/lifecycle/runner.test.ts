import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StreamAlreadyConsumedError } from "./errors.ts";
import { runStreamLifecycle } from "./runner.ts";
import { createScriptedStreamProvider } from "./testing.ts";
import type { StreamDiagnosticEvent } from "./types.ts";

describe("runStreamLifecycle", () => {
  it("opens lazily and rejects a second frame consumer", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    assertEquals(provider.openCount, 0);
    const first = run.frames[Symbol.asyncIterator]();
    assertEquals(provider.openCount, 0);
    assertThrows(
      () => run.frames[Symbol.asyncIterator](),
      StreamAlreadyConsumedError,
    );
    await first.next();
    assertEquals(provider.openCount, 1);
  });

  it("keeps outcome pending until frame iteration starts", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    let settled = false;
    void run.outcome.then(() => settled = true);
    await Promise.resolve();
    assertEquals(settled, false);
    await run.frames[Symbol.asyncIterator]().next();
    assertEquals((await run.outcome).status, "failed");
  });

  it("uses pre-aborted source precedence and records phase", async () => {
    const user = new AbortController();
    const parent = new AbortController();
    parent.abort("parent");
    user.abort("user");
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({
      provider,
      cancellations: [
        { source: "parent", signal: parent.signal },
        { source: "user", signal: user.signal },
      ],
    });
    await run.frames[Symbol.asyncIterator]().next();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") assertEquals(outcome.source, "user");
    assertEquals(outcome.phase, "cancelled");
    assertEquals(outcome.snapshot.phase, "cancelled");
  });

  it("turns consumer return into one cleanup request", async () => {
    const provider = createScriptedStreamProvider([
      { kind: "protocol", event: { type: "text_content", delta: "hello" } },
    ]);
    const run = runStreamLifecycle({ provider });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(provider.returnCount, 1);
  });

  it("records an abort after run creation but before first next without opening the provider", async () => {
    const controller = new AbortController();
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({
      provider,
      cancellations: [{ source: "runtime", signal: controller.signal }],
    });

    controller.abort("runtime stop");
    assertEquals(provider.openCount, 0);
    await run.frames[Symbol.asyncIterator]().next();
    const outcome = await run.outcome;

    assertEquals(provider.openCount, 0);
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") assertEquals(outcome.source, "runtime");
  });

  it("reports cleanup failure without replacing the committed outcome", async () => {
    const cleanupError = new Error("cleanup sentinel");
    const reported: StreamDiagnosticEvent[] = [];
    const provider = createScriptedStreamProvider([
      { kind: "protocol", event: { type: "text_content", delta: "hello" } },
    ], { returnError: cleanupError });
    const run = runStreamLifecycle({
      provider,
      diagnosticSink: { report: (event) => reported.push(event) },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    await Promise.resolve();

    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(reported.map((event) => event.type), [
      "provider_cleanup_failed",
    ]);
    assertEquals(
      JSON.stringify(reported).includes(cleanupError.message),
      false,
    );
  });

  it("can stop before the first read without opening the provider", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.return?.();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(provider.openCount, 0);
    assertEquals(provider.returnCount, 0);
  });
});
