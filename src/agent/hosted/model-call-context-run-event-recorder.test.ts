import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { ConversationRunMirrorSnapshot } from "../conversation/run-mirror.ts";
import {
  createModelCallContextRunEventRecorder,
  createModelCallContextRunEvents,
  MAX_CHUNKED_MODEL_CALL_CONTEXT_EVENT_BYTES,
  MAX_MODEL_CALL_CONTEXT_BYTES,
  ModelCallContextPersistenceError,
  scopeAsyncIterableWithModelCallRecorder,
} from "./model-call-context-run-event-recorder.ts";
import type { ModelCallRecorder } from "../../runtime/model-call-context.ts";
import { getActiveModelCallRecorder } from "../../runtime/model-call-recorder-context.ts";

const encoder = new TextEncoder();

function snapshot(
  overrides: Partial<ConversationRunMirrorSnapshot> = {},
): ConversationRunMirrorSnapshot {
  return {
    latestEventId: 1,
    latestExternalEventSequence: 1,
    pendingEventCount: 0,
    consecutiveFailures: 0,
    disabled: false,
    hasFlushTimer: false,
    hasRetryTimer: false,
    inFlight: false,
    ...overrides,
  };
}

function mirror(input: {
  before?: ConversationRunMirrorSnapshot;
  resolved?: ConversationRunMirrorSnapshot;
  current?: ConversationRunMirrorSnapshot;
  flush?: () => Promise<ConversationRunMirrorSnapshot>;
} = {}) {
  const appended: unknown[][] = [];
  let reads = 0;
  let disposed = false;
  const result: ConversationRunChunkMirror = {
    handleChunk: async () => {},
    appendEvents: async (events) => {
      appended.push(events);
    },
    flush: input.flush ?? (async () => input.resolved ?? snapshot()),
    getSnapshot: () => {
      reads += 1;
      return reads === 1 ? input.before ?? snapshot() : input.current ?? snapshot();
    },
    dispose: () => {
      disposed = true;
    },
  };
  return { result, appended, isDisposed: () => disposed };
}

describe("agent/hosted/model-call-context-run-event-recorder", () => {
  it("keeps the recorder active while a lazy hosted stream is consumed", async () => {
    const recorder: ModelCallRecorder = () => {};
    const seen: Array<ModelCallRecorder | undefined> = [];
    const source = (async function* () {
      seen.push(getActiveModelCallRecorder());
      await Promise.resolve();
      seen.push(getActiveModelCallRecorder());
      yield "done";
    })();

    const values: string[] = [];
    for await (const value of scopeAsyncIterableWithModelCallRecorder(recorder, source)) {
      values.push(value);
    }
    assertEquals(values, ["done"]);
    assertEquals(seen, [recorder, recorder]);
    assertEquals(getActiveModelCallRecorder(), undefined);
  });

  it("serializes once into a reconstructable envelope with an exact UTF-8 hash", async () => {
    const context = { prompt: [{ role: "system" as const, content: "héllo 😀" }] };
    const events = await createModelCallContextRunEvents(context);
    const serialized = events.map((event) => event.serializedSegment).join("");
    const expected = JSON.stringify(context);
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(expected));
    const expectedHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    assertEquals(serialized, expected);
    assertEquals(events[0]?.totalByteLength, encoder.encode(expected).byteLength);
    assertEquals(events[0]?.sha256, expectedHash);
  });

  it("chunks large escape-heavy unicode contexts losslessly within the per-row limit", async () => {
    const content = `${'"'.repeat(1_100_000)}${"😀".repeat(300_000)}`;
    const events = await createModelCallContextRunEvents({
      prompt: [{ role: "system", content }],
    });

    assertEquals(events.length > 1, true);
    assertEquals(
      events.map((event) => event.serializedSegment).join(""),
      JSON.stringify({ prompt: [{ role: "system", content }] }),
    );
    for (const event of events) {
      assertEquals(
        encoder.encode(JSON.stringify(event)).byteLength <
          MAX_CHUNKED_MODEL_CALL_CONTEXT_EVENT_BYTES,
        true,
      );
    }
  });

  it("rejects contexts larger than 4 MiB before append", async () => {
    await assertRejects(
      () =>
        createModelCallContextRunEvents({
          prompt: [{ role: "system", content: "x".repeat(MAX_MODEL_CALL_CONTEXT_BYTES) }],
        }),
      ModelCallContextPersistenceError,
      "4 MiB",
    );
  });

  it("rejects escape-heavy contexts that would require more than 32 parts", async () => {
    await assertRejects(
      () =>
        createModelCallContextRunEvents({
          prompt: [{ role: "system", content: '"'.repeat(2_097_000) }],
        }),
      ModelCallContextPersistenceError,
      "too many parts",
    );
  });

  it("appends and verifies both resolved and immediate snapshots before returning", async () => {
    const target = mirror();
    const recorder = createModelCallContextRunEventRecorder({ mirror: target.result });
    await recorder({ prompt: [{ role: "system", content: "persist me" }] });
    assertEquals(target.appended.length, 1);
    assertEquals(target.isDisposed(), false);
  });

  for (
    const [name, target] of [
      ["disabled before append", mirror({ before: snapshot({ disabled: true }) })],
      ["pending before append", mirror({ before: snapshot({ pendingEventCount: 1 }) })],
      ["disabled in the resolved flush", mirror({ resolved: snapshot({ disabled: true }) })],
      ["pending in the resolved flush", mirror({ resolved: snapshot({ pendingEventCount: 1 }) })],
      ["retry after flush", mirror({ current: snapshot({ hasRetryTimer: true }) })],
      ["successor in flight", mirror({ current: snapshot({ inFlight: true }) })],
    ] as const
  ) {
    it(`fails closed when the mirror is ${name}`, async () => {
      const recorder = createModelCallContextRunEventRecorder({ mirror: target.result });
      await assertRejects(
        () => Promise.resolve(recorder({ prompt: [{ role: "system", content: "no dispatch" }] })),
        ModelCallContextPersistenceError,
      );
      assertEquals(target.isDisposed(), true);
    });
  }

  it("fails closed when the required append exceeds its deadline", async () => {
    const target = mirror({ flush: () => new Promise(() => {}) });
    const recorder = createModelCallContextRunEventRecorder({
      mirror: target.result,
      timeoutMs: 5,
    });
    await assertRejects(
      () => Promise.resolve(recorder({ prompt: [{ role: "system", content: "timeout" }] })),
      ModelCallContextPersistenceError,
      "timed out",
    );
    assertEquals(target.isDisposed(), true);
  });

  it("fails closed immediately when the active run aborts", async () => {
    const target = mirror({ flush: () => new Promise(() => {}) });
    const controller = new AbortController();
    const recorder = createModelCallContextRunEventRecorder({
      mirror: target.result,
      abortSignal: controller.signal,
    });
    const recording = Promise.resolve(
      recorder({ prompt: [{ role: "system", content: "abort" }] }),
    );
    controller.abort();
    await assertRejects(() => recording, DOMException, "aborted");
    assertEquals(target.isDisposed(), true);
  });
});
