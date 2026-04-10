import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RunCancelledError, RunResumeSessionManager } from "./index.ts";
import {
  HumanInputPendingRequestSchema,
  HumanInputResultSchema,
  HumanInputResumeError,
  InvalidHumanInputResultError,
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
});
