import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RunCancelledError, RunResumeSessionManager } from "./index.ts";
import {
  executeDurableHumanInputFlow,
  HumanInputPendingRequestSchema,
  HumanInputResultSchema,
  HumanInputResumeError,
  InvalidHumanInputResultError,
  waitForDurableHumanInputResolution,
  waitForHumanInput,
} from "./human-input.ts";

describe("agent/human-input", () => {
  it("publishes a canonical pending request and resolves submitted values", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    let published: unknown;

    const pending = waitForHumanInput({
      sessionManager,
      runId: "run_1",
      toolCallId: "tool_1",
      request: {
        title: "Repository details",
        fields: [
          {
            type: "text",
            name: "repo",
            label: "Repository",
            required: true,
          },
        ],
      },
      onRequest: (value) => {
        published = value;
      },
    });
    await Promise.resolve();

    const submitOutcome = sessionManager.submitSignal("run_1", {
      waitKey: "tool_1",
      value: {
        result: {
          submitted: true,
          values: {
            repo: "veryfront",
          },
        },
        isError: false,
      },
    });

    assertEquals(submitOutcome, { accepted: true });
    assertEquals(HumanInputPendingRequestSchema.parse(published), {
      runId: "run_1",
      toolCallId: "tool_1",
      request: {
        title: "Repository details",
        fields: [
          {
            type: "text",
            name: "repo",
            label: "Repository",
            required: true,
            secret: false,
          },
        ],
        submitLabel: "Submit",
      },
    });
    assertEquals(HumanInputResultSchema.parse(await pending), {
      submitted: true,
      values: {
        repo: "veryfront",
      },
    });
  });

  it("rejects malformed resumed values with a stable public error", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = waitForHumanInput({
      sessionManager,
      runId: "run_1",
      toolCallId: "tool_1",
      request: {
        title: "Repository details",
        fields: [{ type: "text", name: "repo", label: "Repository" }],
      },
    });
    await Promise.resolve();

    sessionManager.submitSignal("run_1", {
      waitKey: "tool_1",
      value: {
        result: { invalid: true },
        isError: false,
      },
    });

    await assertRejects(
      () => pending,
      InvalidHumanInputResultError,
      "Invalid human input resume payload",
    );
  });

  it("surfaces explicit resume errors from the host seam", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = waitForHumanInput({
      sessionManager,
      runId: "run_1",
      toolCallId: "tool_1",
      request: {
        title: "Repository details",
        fields: [{ type: "text", name: "repo", label: "Repository" }],
      },
    });
    await Promise.resolve();

    sessionManager.submitSignal("run_1", {
      waitKey: "tool_1",
      value: {
        result: "input request expired",
        isError: true,
      },
    });

    await assertRejects(() => pending, HumanInputResumeError, "input request expired");
  });

  it("propagates run cancellation while waiting for input", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = waitForHumanInput({
      sessionManager,
      runId: "run_1",
      toolCallId: "tool_1",
      request: {
        title: "Repository details",
        fields: [{ type: "text", name: "repo", label: "Repository" }],
      },
    });
    await Promise.resolve();

    sessionManager.cancelRun("run_1");

    await assertRejects(() => pending, RunCancelledError);
  });

  it("bridges a durable request snapshot into the local human input wait", async () => {
    const result = await executeDurableHumanInputFlow({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      toolCallId: "tool_1",
      request: {
        title: "Repository details",
        fields: [{ type: "text", name: "repo", label: "Repository" }],
      },
      timeoutMs: 100,
      pollIntervalMs: 1,
      onRequest: (request) => ({
        id: "input_request_1",
        request,
      }),
      getSnapshot: (createdRequest) => ({
        id: createdRequest.id,
        status: "submitted",
        values: {
          repo: createdRequest.request.request.title,
        },
      }),
      resolveSnapshot: (snapshot) =>
        snapshot.status === "submitted"
          ? {
            submitted: true,
            values: snapshot.values,
          }
          : undefined,
    });

    assertEquals(result.createdRequest.id, "input_request_1");
    assertEquals(result.result, {
      submitted: true,
      values: {
        repo: "Repository details",
      },
    });
  });

  it("surfaces durable request timeout as a human input resume error", async () => {
    await assertRejects(
      () =>
        executeDurableHumanInputFlow({
          runId: "run_1",
          threadId: crypto.randomUUID(),
          toolCallId: "tool_1",
          request: {
            title: "Repository details",
            fields: [{ type: "text", name: "repo", label: "Repository" }],
          },
          timeoutMs: 0,
          pollIntervalMs: 1,
          onRequest: () => ({
            id: "input_request_1",
          }),
          getSnapshot: (createdRequest) => ({
            id: createdRequest.id,
            status: "open",
          }),
          resolveSnapshot: () => undefined,
        }),
      HumanInputResumeError,
      "Timed out while waiting for durable human input resolution",
    );
  });

  it("polls durable human input snapshots until a resolution is available", async () => {
    const snapshots: Array<{
      status: "open" | "submitted" | "expired";
      values: Record<string, string | number | boolean | null>;
    }> = [
      { status: "open", values: {} },
      { status: "submitted", values: { repo: "veryfront" } },
    ];

    const result = await waitForDurableHumanInputResolution({
      deadline: Date.now() + 100,
      pollIntervalMs: 1,
      getSnapshot: () => snapshots.shift() ?? { status: "expired", values: {} },
      resolveSnapshot: (snapshot) =>
        snapshot.status === "submitted"
          ? {
            submitted: true,
            values: snapshot.values,
          }
          : undefined,
    });

    assertEquals(result, {
      submitted: true,
      values: {
        repo: "veryfront",
      },
    });
  });
});
