import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RunCancelledError, RunResumeSessionManager } from "./index.ts";
import {
  executeDurableHumanInputFlow,
  getHumanInputPendingRequestSchema,
  getHumanInputResultSchema,
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
      // deno-lint-ignore no-explicit-any -- field literal omits optional keys
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
      } as any,
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
    // Cast through `unknown` so assertEquals doesn't enforce the contract DSL's
    // strict key-present optional shape on the expected literal.
    assertEquals(getHumanInputPendingRequestSchema().parse(published) as unknown, {
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
    assertEquals(getHumanInputResultSchema().parse(await pending) as unknown, {
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
      // deno-lint-ignore no-explicit-any -- field literal omits optional keys
      // (contract DSL InferShape limitation: optional fields type as required-key,
      // T | undefined value; cast to satisfy the boundary).
      request: {
        title: "Repository details",
        fields: [{ type: "text", name: "repo", label: "Repository" }],
      } as any,
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
      // deno-lint-ignore no-explicit-any
      request: {
        title: "Repository details",
        fields: [{ type: "text", name: "repo", label: "Repository" }],
      } as any,
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
      // deno-lint-ignore no-explicit-any
      request: {
        title: "Repository details",
        fields: [{ type: "text", name: "repo", label: "Repository" }],
      } as any,
    });
    await Promise.resolve();

    sessionManager.cancelRun("run_1");

    await assertRejects(() => pending, RunCancelledError);
  });

  it("bridges a durable request snapshot into the local human input wait", async () => {
    type CreatedReq = {
      id: string;
      request: { request: { title: string } };
    };
    type Snapshot = { id: string; status: string; values: Record<string, unknown> };
    // deno-lint-ignore no-explicit-any -- field literal omits optional keys
    // (see contract DSL InferShape limitation; cast to satisfy boundary).
    const result = await executeDurableHumanInputFlow<CreatedReq, Snapshot>({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      toolCallId: "tool_1",
      request: {
        title: "Repository details",
        fields: [{ type: "text", name: "repo", label: "Repository" }] as any,
      } as any,
      timeoutMs: 100,
      pollIntervalMs: 1,
      onRequest: (request): CreatedReq => ({
        id: "input_request_1",
        // deno-lint-ignore no-explicit-any -- runtime shape from schema
        request: request as any,
      }),
      getSnapshot: (createdRequest): Snapshot => ({
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
            // deno-lint-ignore no-explicit-any -- HumanInputResultSchema accepts loose values
            values: snapshot.values as any,
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
    type CreatedReq = { id: string };
    type Snapshot = { id: string; status: string };
    await assertRejects(
      () =>
        executeDurableHumanInputFlow<CreatedReq, Snapshot>({
          runId: "run_1",
          threadId: crypto.randomUUID(),
          toolCallId: "tool_1",
          // deno-lint-ignore no-explicit-any -- field literal omits optional keys
          request: {
            title: "Repository details",
            fields: [{ type: "text", name: "repo", label: "Repository" }] as any,
          } as any,
          timeoutMs: 0,
          pollIntervalMs: 1,
          onRequest: (): CreatedReq => ({
            id: "input_request_1",
          }),
          getSnapshot: (createdRequest): Snapshot => ({
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
      getSnapshot: () => snapshots.shift() ?? { status: "expired" as const, values: {} },
      resolveSnapshot: (snapshot) =>
        snapshot.status === "submitted"
          ? {
            submitted: true as const,
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
