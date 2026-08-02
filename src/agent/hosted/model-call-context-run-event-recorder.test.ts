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
  type ModelCallContextMetricsSink,
  ModelCallContextPersistenceError,
  scopeAsyncIterableWithModelCallRecorder,
} from "./model-call-context-run-event-recorder.ts";
import type { ModelCallRecorder } from "../../runtime/model-call-context.ts";
import { getActiveModelCallRecorder } from "../../runtime/model-call-recorder-context.ts";
import { runWithModelCallRecorder } from "../../runtime/model-call-recorder-context.ts";
import { streamText } from "../../runtime/runtime-bridge.ts";
import { collectAsync, createStreamModel } from "../../runtime/runtime-bridge.test-helpers.ts";

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
    appendRequestCount: 0,
    ...overrides,
  };
}

function mirror(input: {
  before?: ConversationRunMirrorSnapshot;
  resolved?: ConversationRunMirrorSnapshot;
  current?: ConversationRunMirrorSnapshot;
  flush?: () => Promise<ConversationRunMirrorSnapshot>;
  append?: (events: unknown[]) => Promise<void>;
  snapshot?: () => ConversationRunMirrorSnapshot;
} = {}) {
  const appended: unknown[][] = [];
  let reads = 0;
  let disposed = false;
  const result: ConversationRunChunkMirror = {
    handleChunk: async () => {},
    appendEvents: async (events) => {
      appended.push(events);
      await input.append?.(events);
    },
    flush: input.flush ?? (async () => input.resolved ?? snapshot()),
    getSnapshot: () => {
      if (input.snapshot) return input.snapshot();
      reads += 1;
      return reads === 1 ? input.before ?? snapshot() : input.current ?? snapshot();
    },
    dispose: () => {
      disposed = true;
    },
  };
  return { result, appended, isDisposed: () => disposed };
}

function metricsSink() {
  const writerOutcomes: string[] = [];
  const barrierOutcomes: string[] = [];
  const measurements: Array<Record<string, number>> = [];
  const result: ModelCallContextMetricsSink = {
    writerOutcome: (outcome) => writerOutcomes.push(outcome),
    barrierOutcome: (outcome) => barrierOutcomes.push(outcome),
    measurements: (input) => measurements.push(input),
  };
  return { result, writerOutcomes, barrierOutcomes, measurements };
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
    const metrics = metricsSink();
    const recorder = createModelCallContextRunEventRecorder({
      mirror: target.result,
      metrics: metrics.result,
    });
    await recorder({ prompt: [{ role: "system", content: "persist me" }] });
    assertEquals(target.appended.length, 1);
    assertEquals(target.isDisposed(), false);
    assertEquals(metrics.writerOutcomes, ["recorded"]);
    assertEquals(metrics.barrierOutcomes, []);
    assertEquals(metrics.measurements.length, 1);
    assertEquals((metrics.measurements[0]?.logicalByteLength ?? 0) > 0, true);
    assertEquals(metrics.measurements[0]?.partCount, 1);
    assertEquals(metrics.measurements[0]?.appendRequestCount, 0);
    assertEquals((metrics.measurements[0]?.durationMs ?? -1) >= 0, true);
  });

  it("reports every bounded writer outcome without sensitive values", async () => {
    const cases: Array<{
      outcome: string;
      target: ReturnType<typeof mirror>;
    }> = [
      { outcome: "disabled", target: mirror({ before: snapshot({ disabled: true }) }) },
      {
        outcome: "append_failed",
        target: mirror({ append: () => Promise.reject(new Error("append")) }),
      },
      {
        outcome: "retry_scheduled",
        target: mirror({ resolved: snapshot({ hasRetryTimer: true }) }),
      },
      { outcome: "stopped", target: mirror({ resolved: snapshot({ disabled: true }) }) },
      {
        outcome: "ambiguous_durable_replay",
        target: mirror({
          resolved: snapshot({ disabled: true, disableReason: "cursor_mismatch_ambiguous" }),
        }),
      },
      {
        outcome: "pending_after_flush",
        target: mirror({ resolved: snapshot({ pendingEventCount: 1 }) }),
      },
      {
        outcome: "successor_in_flight",
        target: mirror({ resolved: snapshot({ inFlight: true }) }),
      },
      {
        outcome: "partial_append_failed",
        target: mirror({
          append: () => Promise.reject(new Error("later append")),
          snapshot: (() => {
            let reads = 0;
            return () => snapshot({ appendRequestCount: reads++ === 0 ? 0 : 2 });
          })(),
        }),
      },
    ];

    for (const testCase of cases) {
      const metrics = metricsSink();
      const recorder = createModelCallContextRunEventRecorder({
        mirror: testCase.target.result,
        metrics: metrics.result,
      });
      await assertRejects(() =>
        Promise.resolve(
          recorder({ prompt: [{ role: "system", content: "SENSITIVE_SENTINEL" }] }),
        )
      );
      assertEquals(metrics.writerOutcomes, [testCase.outcome]);
      assertEquals(JSON.stringify(metrics).includes("SENSITIVE_SENTINEL"), false);
    }
  });

  it("keeps persistence fail-open when the metrics sink throws", async () => {
    const target = mirror();
    const fail = () => {
      throw new Error("metrics unavailable");
    };
    await createModelCallContextRunEventRecorder({
      mirror: target.result,
      metrics: { writerOutcome: fail, barrierOutcome: fail, measurements: fail },
    })({ prompt: [{ role: "system", content: "persisted" }] });
    assertEquals(target.appended.length, 1);
  });

  it("retains the pre-dispatch context when provider streaming fails", async () => {
    const target = mirror();
    let dispatches = 0;
    const model = createStreamModel("test", "test/failing-hosted-stream", async () => {
      dispatches += 1;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.error(new Error("provider stream failed"));
          },
        }),
      };
    });
    const recorder = createModelCallContextRunEventRecorder({ mirror: target.result });

    await assertRejects(
      () =>
        runWithModelCallRecorder(recorder, () =>
          collectAsync(
            streamText({
              model,
              system: "Child instructions",
              messages: [{ role: "user", content: "fail after dispatch" }],
            }).fullStream,
          )),
      Error,
      "provider stream failed",
    );

    assertEquals(dispatches, 1);
    assertEquals(target.appended.length, 1);
    const event = target.appended[0]?.[0] as Record<string, unknown>;
    assertEquals(Object.keys(event).sort(), [
      "contextId",
      "partCount",
      "partIndex",
      "serializedSegment",
      "sha256",
      "totalByteLength",
      "type",
    ]);
    assertEquals("error" in event, false);
    assertEquals("lifecycle" in event, false);
    assertEquals(JSON.parse(String(event.serializedSegment)), {
      prompt: [
        { role: "system", content: "Child instructions" },
        { role: "user", content: [{ type: "text", text: "fail after dispatch" }] },
      ],
    });
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
    const metrics = metricsSink();
    const recorder = createModelCallContextRunEventRecorder({
      mirror: target.result,
      timeoutMs: 5,
      metrics: metrics.result,
    });
    await assertRejects(
      () => Promise.resolve(recorder({ prompt: [{ role: "system", content: "timeout" }] })),
      ModelCallContextPersistenceError,
      "timed out",
    );
    assertEquals(target.isDisposed(), true);
    assertEquals(metrics.barrierOutcomes, ["timeout"]);
  });

  it("fails closed immediately when the active run aborts", async () => {
    const target = mirror({ flush: () => new Promise(() => {}) });
    const controller = new AbortController();
    const metrics = metricsSink();
    const recorder = createModelCallContextRunEventRecorder({
      mirror: target.result,
      abortSignal: controller.signal,
      metrics: metrics.result,
    });
    const recording = Promise.resolve(
      recorder({ prompt: [{ role: "system", content: "abort" }] }),
    );
    controller.abort();
    await assertRejects(() => recording, DOMException, "aborted");
    assertEquals(target.isDisposed(), true);
    assertEquals(metrics.barrierOutcomes, ["aborted"]);
  });
});
