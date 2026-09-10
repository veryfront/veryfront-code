import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createManagedBrokerPersistence,
  createManagedBrokerPersistenceFromCapability,
} from "#veryfront/agent/service/managed-broker.ts";
import {
  createHostedRunEventWriterCapability,
} from "#veryfront/agent/hosted/child-run-event-writer-token.ts";
import { createConversationHostedTerminalAdapter } from "#veryfront/agent/conversation/hosted-terminal.ts";
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

function terminalForTest(
  fetch: typeof globalThis.fetch,
  resolveProvider: (modelId: string) => string = () => "provider",
) {
  const adapter = createConversationHostedTerminalAdapter({
    apiUrl: "https://api.example.test",
    authToken: "synthetic-completion-token",
    run,
    fallbackModelId: "model",
    resolveProvider,
    fetch,
  });
  return { runId: run.runId, dispatch: adapter.dispatch };
}

function bindForTest(
  persistence: ReturnType<typeof createManagedBrokerPersistence>,
): ReturnType<typeof createManagedBrokerPersistence> {
  persistence.bindSessionOwnedWork(async (operation) => await operation());
  return persistence;
}

for (const authority of ["token", "capability"] as const) {
  describe(`managed broker persistence (${authority})`, () => {
    const createPersistence = (
      input: Omit<Parameters<typeof createManagedBrokerPersistence>[0], "completionAuthToken">,
    ) =>
      authority === "token"
        ? createManagedBrokerPersistence({
          ...input,
          completionAuthToken: "synthetic-completion-token",
        })
        : createManagedBrokerPersistenceFromCapability({
          capability: createHostedRunEventWriterCapability({
            apiUrl: input.apiUrl,
            runId: input.run.runId,
            runEventAppendToken: input.runEventToken,
            fetch: input.fetch,
          }),
          run: input.run,
          terminal: terminalForTest(input.fetch ?? successfulFetch([]), input.resolveProvider),
        });
    it("requires one active session owner before persistence can enqueue or fetch", async () => {
      const calls: Record<string, unknown>[] = [];
      const persistence = createPersistence({
        apiUrl: "https://api.example.test",
        runEventToken: "run-event-token",
        run,
        modelId: "model",
        resolveProvider: () => "provider",
        fetch: successfulFetch(calls),
      });

      await assertRejects(async () =>
        await persistence.modelRunEventSink({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
          tools: [],
        })
      );
      await assertRejects(() => persistence.publishParentRunEvents([{ type: "STEP_STARTED" }]));
      await assertRejects(() =>
        persistence.persistToolExposureCheckpoint({
          version: 2,
          loadedToolNames: ["search"],
        })
      );
      await assertRejects(() =>
        persistence.persistProviderReplayCheckpoint({
          version: 1,
          messageId,
          provider: "anthropic",
          providerBlocks: [],
          providerBlockPositions: [],
          providerMessageBlockCounts: [],
          totalPartCount: 0,
        })
      );
      await assertRejects(() =>
        persistence.output.write({ type: "text-delta", id: "message", delta: "blocked" })
      );
      await assertRejects(() => persistence.output.finish({ completed: false }));
      assertEquals(calls, []);

      const owner = async <T>(operation: () => Promise<T>): Promise<T> => await operation();
      assertThrows(() => persistence.bindSessionOwnedWork(undefined as never));
      persistence.bindSessionOwnedWork(owner);
      assertThrows(() => persistence.bindSessionOwnedWork(owner));
      await persistence.cleanup();

      const cleaned = createPersistence({
        apiUrl: "https://api.example.test",
        runEventToken: "run-event-token",
        run,
        modelId: "model",
        resolveProvider: () => "provider",
        fetch: successfulFetch([]),
      });
      await cleaned.cleanup();
      assertThrows(() => cleaned.bindSessionOwnedWork(owner));
    });

    it("persists output, audit, parent events, checkpoints, and terminal completion", async () => {
      const calls: Record<string, unknown>[] = [];
      const fetch = successfulFetch(calls);
      await withMockFetch(
        () => Promise.reject(new Error("external fetch must not be used")),
        async () => {
          const persistence = bindForTest(createPersistence({
            apiUrl: "https://api.example.test",
            runEventToken: "run-event-token",
            run,
            modelId: "veryfront-cloud/openai/synthetic",
            resolveProvider: () => "openai",
            fetch,
          }));
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
          await assertRejects(() =>
            persistence.publishParentRunEvents([{ type: "STEP_FINISHED" }])
          );
          await persistence.cleanup();
        },
      );
      const events = calls.flatMap((call) => Array.isArray(call.events) ? call.events : []);
      assertEquals(events.some((event) => event.type === "TEXT_MESSAGE_CONTENT"), true);
      assertEquals(events.some((event) => event.type === "AGENT_RUN_MODEL_CALL_CONTEXT"), true);
      assertEquals(events.some((event) => event.type === "STEP_STARTED"), true);
      assertEquals(
        events.some((event) => event.type === "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT"),
        true,
      );
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
        const persistence = bindForTest(createPersistence({
          apiUrl: "https://api.example.test",
          runEventToken: "run-event-token",
          run,
          modelId: "model",
          resolveProvider: () => "provider",
          fetch,
        }));
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
        const persistence = bindForTest(createPersistence({
          apiUrl: "https://api.example.test",
          runEventToken: "run-event-token",
          run,
          modelId: "model",
          resolveProvider: () => "provider",
          fetch,
        }));
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
      const persistence = createPersistence({
        apiUrl: "https://api.example.test",
        runEventToken: "run-event-token",
        run,
        modelId: "model",
        resolveProvider: () => "provider",
        fetch,
      });
      let ownedWorkTail = Promise.resolve();
      persistence.bindSessionOwnedWork((operation) => {
        const result = operation();
        const settled = result.then(() => undefined, () => undefined);
        ownedWorkTail = Promise.all([ownedWorkTail, settled]).then(() => undefined);
        return result;
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

      let ownedWorkSettled = false;
      void ownedWorkTail.then(() => ownedWorkSettled = true);
      let cleanupSettled = false;
      const cleanup = persistence.cleanup().then(() => cleanupSettled = true);
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
      assertEquals(ownedWorkSettled, false);
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
      await ownedWorkTail;
      assertEquals(ownedWorkSettled, true);
      await cleanup;
      assertEquals(cleanupSettled, true);
    });

    it("persists a failed terminal outcome for executor output errors", async () => {
      const calls: Record<string, unknown>[] = [];
      const fetch = successfulFetch(calls);
      await withMockFetch(fetch, async () => {
        const persistence = bindForTest(createPersistence({
          apiUrl: "https://api.example.test",
          runEventToken: "run-event-token",
          run,
          modelId: "model",
          resolveProvider: () => "provider",
          fetch,
        }));
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
}

describe("managed persistence capability authorization", () => {
  for (const authority of ["token", "capability"] as const) {
    it(`normalizes canonical snake_case run input (${authority})`, async () => {
      const calls: Record<string, unknown>[] = [];
      const fetch = successfulFetch(calls);
      const canonical = {
        run_id: run.runId,
        conversation_id: conversationId,
        message_id: messageId,
        latest_event_id: 0,
        latest_external_event_sequence: 0,
        status: "running",
        stream_protocol_version: 2,
      };
      const input = {
        apiUrl: "https://api.example.test",
        runEventToken: "synthetic-token",
        completionAuthToken: "synthetic-completion-token",
        terminal: terminalForTest(fetch),
        fetch,
        run: canonical,
        modelId: "model",
        resolveProvider: () => "provider",
        capability: createHostedRunEventWriterCapability({
          apiUrl: "https://api.example.test",
          runId: run.runId,
          runEventAppendToken: "synthetic-token",
          fetch,
        }),
      };
      // Model an existing JavaScript caller: the runtime schema accepts wire aliases.
      const persistence = bindForTest(Reflect.apply(
        authority === "token"
          ? createManagedBrokerPersistence
          : createManagedBrokerPersistenceFromCapability,
        undefined,
        [input],
      ));
      try {
        await persistence.publishParentRunEvents([{ type: "STEP_STARTED" }]);
        await persistence.output.finish({ completed: true });
        assertEquals(calls.length, 2);
        assertEquals(calls.at(-1)?.status, "completed");
      } finally {
        await persistence.cleanup();
      }
    });
  }
  it("does not expose private terminal options as callback receivers", async () => {
    const receivers: unknown[] = [];
    const persistence = bindForTest(createManagedBrokerPersistence({
      apiUrl: "https://api.example.test",
      runEventToken: "synthetic-event-token",
      completionAuthToken: "synthetic-completion-token",
      run,
      modelId: "model",
      resolveProvider: function (this: unknown) {
        receivers.push(this);
        return "provider";
      },
      fetch: successfulFetch([]),
    }));
    try {
      await persistence.output.finish({ completed: true });
    } finally {
      await persistence.cleanup();
    }
    assertEquals(receivers.length, 1);
    assertEquals(receivers.every((receiver) => receiver === undefined), true);
  });
  it("requires independent terminal authorization before accepting an append capability", () => {
    const capability = createHostedRunEventWriterCapability({
      apiUrl: "https://api.example.test",
      runId: run.runId,
      runEventAppendToken: "synthetic-event-token",
      fetch: successfulFetch([]),
    });
    for (
      const terminal of [undefined, {
        runId: "wrong-run",
        dispatch: terminalForTest(successfulFetch([])).dispatch,
      }]
    ) {
      assertThrows(
        () =>
          Reflect.apply(createManagedBrokerPersistenceFromCapability, undefined, [{
            capability,
            run,
            terminal,
          }]),
        TypeError,
        "terminal",
      );
    }
    for (const completionAuthToken of [undefined, "", "synthetic-event-token"]) {
      assertThrows(
        () =>
          Reflect.apply(createManagedBrokerPersistence, undefined, [{
            apiUrl: "https://api.example.test",
            runEventToken: "synthetic-event-token",
            completionAuthToken,
            run,
            modelId: "model",
            resolveProvider: () => "provider",
          }]),
        TypeError,
        "completion",
      );
    }
  });
  for (const invalid of ["foreign run", "fabricated capability"] as const) {
    it(`rejects ${invalid} before network work`, () => {
      let calls = 0;
      const capability = invalid === "foreign run"
        ? createHostedRunEventWriterCapability({
          apiUrl: "https://api.example.test",
          runId: "different-run",
          runEventAppendToken: "synthetic-event-token",
          fetch: () => {
            calls++;
            return Promise.reject(new Error("Unexpected network work"));
          },
        })
        : {
          mintChildRunEventWriterCapability: () =>
            Promise.reject(new Error("Fabricated authority")),
        };
      assertThrows(
        () =>
          createManagedBrokerPersistenceFromCapability({
            capability,
            run,
            terminal: terminalForTest(successfulFetch([])),
          }),
        TypeError,
        "not bound",
      );
      assertEquals(calls, 0);
    });
  }
  it("keeps append and completion authority separate with pinned transport", async () => {
    const calls: Record<string, unknown>[] = [];
    const requests: { url: string; authorization: string | null }[] = [];
    const respond = successfulFetch(calls);
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, authorization: request.headers.get("authorization") });
      const expected = request.url.endsWith("/complete")
        ? "Bearer synthetic-completion-token"
        : "Bearer synthetic-pinned-token";
      // Model the API's purpose separation: append credentials cannot authenticate completion.
      if (request.headers.get("authorization") !== expected) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return respond(input, init);
    };
    const capability = createHostedRunEventWriterCapability({
      apiUrl: "https://api.example.test",
      runId: run.runId,
      runEventAppendToken: "synthetic-pinned-token",
      fetch,
    });
    const mutableRun = { ...run };
    const input = {
      capability,
      run: mutableRun,
      terminal: terminalForTest(fetch),
      modelId: "model",
      resolveProvider: () => "provider",
      apiUrl: "https://untrusted.example.test",
      runEventToken: "must-not-be-used",
      fetch: () => Promise.reject(new Error("Untrusted transport must not run")),
    };
    await withMockFetch(() => Promise.reject(new Error("Ambient fetch must not run")), async () => {
      const persistence = bindForTest(createManagedBrokerPersistenceFromCapability(input));
      mutableRun.runId = "mutated-run";
      mutableRun.conversationId = "00000000-0000-4000-8000-000000000009";
      try {
        await persistence.publishParentRunEvents([{ type: "STEP_STARTED" }]);
        await persistence.output.finish({ completed: true });
      } finally {
        await persistence.cleanup();
      }
      assertEquals(JSON.stringify(capability), "{}");
      assertEquals(JSON.stringify(persistence).includes("synthetic-pinned-token"), false);
    });
    assertEquals(requests.length, 2);
    for (const request of requests) {
      assertEquals(new URL(request.url).origin, "https://api.example.test");
      assertEquals(
        request.authorization,
        request.url.endsWith("/complete")
          ? "Bearer synthetic-completion-token"
          : "Bearer synthetic-pinned-token",
      );
      assertEquals(request.url.includes("mutated-run"), false);
      assertEquals(request.url.includes("run-1"), true);
    }
    assertEquals(calls.at(-1)?.status, "completed");
  });
});
