import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createManagedBrokerPersistence } from "#veryfront/agent/hosted/managed-broker-persistence.ts";
import { FakeTime } from "#std/testing/time";

const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const run = {
  runId: "run-1",
  conversationId,
  messageId,
  latestEventId: 0,
  latestExternalEventSequence: 0,
  waitingToolCallId: null,
  waitingToolName: null,
  status: "running" as const,
  streamProtocolVersion: 2 as const,
};

function successfulFetch(calls: Record<string, unknown>[]) {
  let cursor = 0;
  return async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push(body);
    if (Array.isArray(body.events)) {
      cursor += body.events.length;
      return Response.json({
        latest_event_id: cursor,
        latest_external_event_sequence: cursor,
        appended_count: body.events.length,
        run: {
          run_id: run.runId,
          conversation_id: conversationId,
          latest_event_id: cursor,
          latest_external_event_sequence: cursor,
        },
      });
    }
    return Response.json({ completed: true, run: { runId: run.runId, status: body.status } });
  };
}

describe("managed broker persistence", () => {
  it("persists output, audit, parent events, checkpoints, and terminal completion", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetch = successfulFetch(calls);
    await withMockFetch(
      () => Promise.reject(new Error("external fetch must not be used")),
      async () => {
        const persistence = createManagedBrokerPersistence({
          apiUrl: "https://api.example.test",
          runEventToken: "run-event-token",
          run,
          modelId: "veryfront-cloud/openai/synthetic",
          resolveProvider: () => "openai",
          fetch,
        });
        await persistence.output.write({ type: "text-delta", id: "message", delta: "hello" });
        await persistence.modelRunEventSink({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
          tools: [],
        });
        await persistence.publishParentRunEvents([{ type: "STEP_STARTED" }]);
        await persistence.persistToolExposureCheckpoint({
          version: 2,
          loadedToolNames: ["search"],
        });
        await persistence.persistProviderReplayCheckpoint({
          version: 1,
          messageId,
          provider: "anthropic",
          providerBlocks: [{
            type: "provider-block",
            provider: "anthropic",
            block: { type: "redacted_thinking", data: "synthetic" },
          }],
          providerBlockPositions: [0],
          providerMessageBlockCounts: [1],
          totalPartCount: 1,
        });
        await persistence.output.finish({
          completed: true,
          metadata: {
            modelId: "veryfront-cloud/openai/synthetic",
            usage: { inputTokens: 12, outputTokens: 7, cachedInputTokens: 3 },
            usageCaptureStatus: "complete",
          },
        });
        await assertRejects(() => persistence.publishParentRunEvents([{ type: "STEP_FINISHED" }]));
        await persistence.cleanup();
      },
    );
    const events = calls.flatMap((call) => Array.isArray(call.events) ? call.events : []);
    assertEquals(events.some((event) => event.type === "TEXT_MESSAGE_CONTENT"), true);
    assertEquals(events.some((event) => event.type === "AGENT_RUN_MODEL_CALL_CONTEXT"), true);
    assertEquals(events.some((event) => event.type === "STEP_STARTED"), true);
    assertEquals(events.some((event) => event.type === "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT"), true);
    assertEquals(
      events.some((event) => event.type === "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT"),
      true,
    );
    assertEquals(calls.at(-1)?.status, "completed");
    assertEquals(calls.at(-1)?.metadata, {
      provider: "openai",
      model: "veryfront-cloud/openai/synthetic",
      inputTokens: 12,
      outputTokens: 7,
      usageCaptureStatus: "complete",
      finishReason: "stop",
    });
  });

  it("retains a queued cancellation finish until the original output write settles", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    const calls: Record<string, unknown>[] = [];
    const fallback = successfulFetch(calls);
    let first = true;
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first) {
        first = false;
        entered.resolve();
        return await release.promise;
      }
      return await fallback(input, init);
    };
    await withMockFetch(fetch, async () => {
      const persistence = createManagedBrokerPersistence({
        apiUrl: "https://api.example.test",
        runEventToken: "run-event-token",
        run,
        modelId: "model",
        resolveProvider: () => "provider",
        fetch,
      });
      const write = persistence.output.write({
        type: "text-delta",
        id: "message",
        delta: "pending",
      });
      await entered.promise;
      let finished = false;
      const finish = persistence.output.finish({ completed: false }).then(() => finished = true);
      await Promise.resolve();
      assertEquals(finished, false);
      release.resolve(Response.json({
        latest_event_id: 1,
        latest_external_event_sequence: 1,
        appended_count: 1,
        run: {
          run_id: run.runId,
          conversation_id: conversationId,
          latest_event_id: 1,
          latest_external_event_sequence: 1,
        },
      }));
      await write;
      await finish;
      assertEquals(calls.at(-1)?.status, "cancelled");
      await persistence.cleanup();
    });
  });

  it("preserves a poisoned write error while independently finalizing the run as failed", async () => {
    const calls: Record<string, unknown>[] = [];
    const fallback = successfulFetch(calls);
    let failEventAppend = true;
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (failEventAppend && Array.isArray(body.events)) {
        failEventAppend = false;
        calls.push(body);
        return new Response("failed", { status: 500 });
      }
      return await fallback(input, init);
    };
    await withMockFetch(fetch, async () => {
      const persistence = createManagedBrokerPersistence({
        apiUrl: "https://api.example.test",
        runEventToken: "run-event-token",
        run,
        modelId: "model",
        resolveProvider: () => "provider",
        fetch,
      });
      const write = persistence.output.write({
        type: "text-delta",
        id: "message",
        delta: "fail",
      });
      const finish = persistence.output.finish({ completed: true });
      const [writeResult, finishResult] = await Promise.allSettled([write, finish]);
      const writeError = writeResult.status === "rejected" ? writeResult.reason : undefined;
      assertEquals(writeError instanceof Error, true);
      const finishError = finishResult.status === "rejected" ? finishResult.reason : undefined;
      assertEquals(finishError === writeError, true);
      assertEquals(calls.at(-1)?.status, "failed");
      await persistence.cleanup();
    });
  });

  it("retains a noncooperative model audit append after its deadline failure", async () => {
    using time = new FakeTime();
    const appendEntered = Promise.withResolvers<void>();
    const appendRelease = Promise.withResolvers<Response>();
    const calls: Record<string, unknown>[] = [];
    const fallback = successfulFetch(calls);
    let delayAuditAppend = true;
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (delayAuditAppend && Array.isArray(body.events)) {
        delayAuditAppend = false;
        appendEntered.resolve();
        return await appendRelease.promise;
      }
      return await fallback(input, init);
    };
    const persistence = createManagedBrokerPersistence({
      apiUrl: "https://api.example.test",
      runEventToken: "run-event-token",
      run,
      modelId: "model",
      resolveProvider: () => "provider",
      fetch,
    });
    const audit = persistence.modelRunEventSink({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [],
      tools: [],
    });
    await appendEntered.promise;

    time.tick(30_000);
    const auditResult = await Promise.allSettled([audit]);
    const auditError = auditResult[0]?.status === "rejected" ? auditResult[0].reason : undefined;
    assertEquals(auditError instanceof Error, true);
    assertEquals((auditError as Error).message, "Durable run event persistence timed out");

    const finishResult = await Promise.allSettled([
      persistence.output.finish({ completed: false, error: auditError }),
    ]);
    assertEquals(finishResult[0]?.status, "rejected");
    assertEquals(
      finishResult[0]?.status === "rejected" ? finishResult[0].reason : undefined,
      auditError,
    );
    assertEquals(calls.at(-1)?.status, "failed");

    let cleanupSettled = false;
    const cleanup = persistence.cleanup().then(() => cleanupSettled = true);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    assertEquals(cleanupSettled, false);

    appendRelease.resolve(Response.json({
      latest_event_id: 1,
      latest_external_event_sequence: 1,
      appended_count: 1,
      run: {
        run_id: run.runId,
        conversation_id: conversationId,
        latest_event_id: 1,
        latest_external_event_sequence: 1,
      },
    }));
    await cleanup;
    assertEquals(cleanupSettled, true);
  });

  it("persists a failed terminal outcome for executor output errors", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetch = successfulFetch(calls);
    await withMockFetch(fetch, async () => {
      const persistence = createManagedBrokerPersistence({
        apiUrl: "https://api.example.test",
        runEventToken: "run-event-token",
        run,
        modelId: "model",
        resolveProvider: () => "provider",
        fetch,
      });
      await persistence.output.finish({
        completed: false,
        error: new Error("synthetic execution failure"),
      });
      assertEquals(calls.at(-1)?.status, "failed");
      assertEquals(calls.at(-1)?.terminal_error_code, "STREAM_ERROR");
      await persistence.cleanup();
    });
  });
});
