import { COMPLETED_AGENT_STEP_STATE_KEY } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as checkpointBridge from "./completed-step-pause.ts";
import { createCompletedStepPauseAcknowledger } from "./completed-step-pause.ts";

const checkpoint = {
  kind: "agent_manual_pause",
  runId: "run_1",
  completedSteps: 1,
  replayMessages: [{
    id: "tool-result-1",
    role: "tool",
    parts: [{ type: "tool-result", toolCallId: "write-1", result: { written: true } }],
  }],
  context: [],
  createdAt: "2026-10-03T22:00:00Z",
};
const credentials = {
  apiUrl: "https://api.example.test",
  runId: "run_1",
  authToken: "run-bound-test-token",
  terminalToken: "generation-test-token",
};

describe("completed-step pause acknowledgement", () => {
  it("fails an unretainable step before uploading an oversized checkpoint", async () => {
    let calls = 0;
    const acknowledge = createCompletedStepPauseAcknowledger(credentials, {
      transport: () => {
        calls++;
        return Promise.resolve(
          Response.json(calls === 1 ? { stop: false, checkpoint_required: true } : { stop: true }),
        );
      },
      sleep: () => Promise.resolve(),
    });
    await assertRejects(
      () =>
        acknowledge({
          ...checkpoint,
          replayMessages: [{
            id: "large",
            role: "assistant",
            parts: [{ type: "text", text: "界".repeat(180_000) }],
          }],
        }, new AbortController().signal),
      Error,
      "512 KB",
    );
    assertEquals(calls, 1);
  });

  it("holds the same retained step through unreadable replies until an authoritative answer", async () => {
    const requests: RequestInit[] = [];
    let calls = 0;
    const acknowledge = createCompletedStepPauseAcknowledger(credentials, {
      transport: (_url, init) => {
        requests.push(init!);
        calls++;
        return Promise.resolve(
          calls === 1
            ? Response.json({ stop: false, checkpoint_required: true })
            : calls === 2
            ? new Response("unreadable", { status: 503 })
            : Response.json({ stop: true }),
        );
      },
      sleep: () => Promise.resolve(),
    });
    assertEquals(await acknowledge(checkpoint, new AbortController().signal), true);
    assertEquals(calls, 3);
    assertEquals(requests[0]!.body, "{}");
    assertEquals(requests[1]!.body, requests[2]!.body);
    assertEquals(JSON.parse(requests[2]!.body as string), { checkpoint });
    assertEquals(requests[1]!.headers, {
      Authorization: "Bearer run-bound-test-token",
      "X-Veryfront-Run-Terminal-Token": "generation-test-token",
      "Content-Type": "application/json",
    });
  });

  it("continues only on a boolean false reply from the authenticated endpoint", async () => {
    let calls = 0;
    const acknowledge = createCompletedStepPauseAcknowledger(credentials, {
      transport: () =>
        Promise.resolve(
          ++calls === 1 ? Response.json({ stop: "false" }) : Response.json({ stop: false }),
        ),
      sleep: () => Promise.resolve(),
    });
    assertEquals(await acknowledge(checkpoint, new AbortController().signal), false);
    assertEquals(calls, 2);
  });

  it("stops holding on cancellation without treating an unreadable reply as continuation", async () => {
    const controller = new AbortController();
    let calls = 0;
    const acknowledge = createCompletedStepPauseAcknowledger(credentials, {
      transport: () => {
        calls++;
        return Promise.resolve(new Response(null, { status: 403 }));
      },
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
    });
    assertEquals(await acknowledge(checkpoint, controller.signal), true);
    assertEquals(calls, 1);
  });
  it("does not build a large replay checkpoint when the current generation has no pause request", async () => {
    let built = 0;
    const acknowledge = createCompletedStepPauseAcknowledger(credentials, {
      transport: (_url, init) => {
        assertEquals(init!.body, "{}");
        return Promise.resolve(Response.json({ stop: false }));
      },
      sleep: () => Promise.resolve(),
    });
    assertEquals(
      await acknowledge(() => {
        built++;
        return { ...checkpoint, replayMessages: "x".repeat(600_000) };
      }, new AbortController().signal),
      false,
    );
    assertEquals(built, 0);
  });
  it("backs off if a checkpoint request is repeated after the checkpoint was uploaded", async () => {
    const controller = new AbortController();
    let calls = 0;
    let built = 0;
    const acknowledge = createCompletedStepPauseAcknowledger(credentials, {
      transport: () => {
        calls++;
        return Promise.resolve(Response.json({ stop: false, checkpoint_required: true }));
      },
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
    });
    assertEquals(
      await acknowledge(() => {
        built++;
        return checkpoint;
      }, controller.signal),
      true,
    );
    assertEquals(calls, 2);
    assertEquals(built, 1);
  });
  it("retains replay, settled tool results and prior usage without copying host execution credentials", () => {
    const build = Reflect.get(checkpointBridge, "buildCompletedStepPauseCheckpoint") as (
      input: unknown,
      step: unknown,
      priorUsage: unknown[],
    ) => Record<string, unknown>;
    assertEquals(typeof build, "function");
    const usage = {
      provider: "test",
      model: "test/model",
      inputTokens: 1,
      outputTokens: 1,
      finishReason: "manual_pause",
    };
    const retained = build({ runId: "run_1", context: [], forwardedProps: { task: "retained" } }, {
      messages: checkpoint.replayMessages,
      completedSteps: 1,
      context: { authToken: "opaque-host-test-credential" },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      usageMetadata: usage,
    }, [usage]);
    assertEquals(retained.replayMessages, [{
      ...checkpoint.replayMessages[0],
      metadata: {
        [COMPLETED_AGENT_STEP_STATE_KEY]: {
          runId: "run_1",
          completedSteps: 1,
          agentWriteFinalResponseGuard: false,
          hasCompletedTool: false,
          recoveredEmptyResponse: false,
          recoveredInterruptedLocalToolBatch: false,
          hasSubmittedFormInput: false,
          runtimeGeneratedMessageIndexes: [],
        },
      },
    }]);
    assertEquals(retained.preParkUsage, [usage, usage]);
    assertEquals(retained.forwardedProps, { task: "retained" });
    assertEquals(JSON.stringify(retained).includes("opaque-host-test-credential"), false);
  });
});
