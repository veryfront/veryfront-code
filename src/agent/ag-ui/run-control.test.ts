import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AgUiResumeSignalSchema,
  createAgUiCancelHandler,
  createAgUiResumeHandler,
  RunResumeSessionManager,
} from "../index.ts";

describe("agent/ag-ui-run-control", () => {
  it("exports the canonical public resume signal schema", () => {
    assertEquals(
      AgUiResumeSignalSchema.parse({
        type: "tool_result",
        toolCallId: "tool_1",
        result: { ok: true },
      }),
      {
        type: "tool_result",
        toolCallId: "tool_1",
        result: { ok: true },
        isError: false,
      },
    );
  });

  it("submits a tool result through the public resume handler", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForSignal("run_1", "tool_1");

    const handler = createAgUiResumeHandler({ sessionManager });
    const response = await handler(
      new Request("https://example.com/api/runs/run_1/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tool_result",
          toolCallId: "tool_1",
          result: { ok: true },
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { accepted: true });
    assertEquals(await pending, { result: { ok: true }, isError: false });
  });

  it("cancels a waiting run through the public cancel handler", async () => {
    const sessionManager = new RunResumeSessionManager<{ ok: boolean }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    void sessionManager.waitForSignal("run_1", "tool_1").catch(() => undefined);

    const handler = createAgUiCancelHandler({ sessionManager });
    const response = await handler(
      new Request("https://example.com/api/runs/run_1", {
        method: "DELETE",
      }),
    );

    assertEquals(response.status, 202);
    assertEquals(await response.json(), { accepted: true });
  });

  it("accepts a request wrapper and returns 410 for inactive runs", async () => {
    const handler = createAgUiResumeHandler({
      sessionManager: new RunResumeSessionManager<{ result: unknown; isError: boolean }>(),
    });

    const response = await handler({
      request: new Request("https://example.com/api/runs/run_1/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tool_result",
          toolCallId: "tool_1",
          result: { ok: true },
        }),
      }),
    });

    assertEquals(response.status, 410);
    assertEquals(await response.json(), { error: "RUN_NOT_ACTIVE" });
  });

  it("returns 404 when the route does not include a run id", async () => {
    const handler = createAgUiResumeHandler({
      sessionManager: new RunResumeSessionManager<{ result: unknown; isError: boolean }>(),
    });

    const response = await handler(
      new Request("https://example.com/api/ag-ui/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tool_result",
          toolCallId: "tool_1",
          result: { ok: true },
        }),
      }),
    );

    assertEquals(response.status, 404);
    assertEquals(await response.json(), { error: "Run not found" });
  });

  it("returns 400 for malformed resume payloads", async () => {
    const handler = createAgUiResumeHandler({
      sessionManager: new RunResumeSessionManager<{ result: unknown; isError: boolean }>(),
    });

    const response = await handler(
      new Request("https://example.com/api/runs/run_1/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tool_result",
        }),
      }),
    );

    assertEquals(response.status, 400);
    const payload = await response.json();
    assertExists(payload);
    assertEquals(payload.error, "Invalid AG-UI resume request");
  });

  it("returns 409 for conflicting duplicate tool results", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>({
      getConflictKey: (value) => JSON.stringify(value),
    });
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForSignal("run_1", "tool_1");
    sessionManager.submitSignal("run_1", {
      waitKey: "tool_1",
      value: { result: { ok: true }, isError: false },
    });
    await pending;

    const handler = createAgUiResumeHandler({ sessionManager });
    const response = await handler(
      new Request("https://example.com/api/runs/run_1/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tool_result",
          toolCallId: "tool_1",
          result: { ok: false },
        }),
      }),
    );

    assertEquals(response.status, 409);
    assertEquals(await response.json(), { error: "TOOL_RESULT_CONFLICT" });
  });

  it("returns 204 when cancelling an already inactive run", async () => {
    const handler = createAgUiCancelHandler({
      sessionManager: new RunResumeSessionManager<{ ok: boolean }>(),
    });

    const response = await handler(
      new Request("https://example.com/api/runs/run_1", {
        method: "DELETE",
      }),
    );

    assertEquals(response.status, 204);
    assertEquals(await response.text(), "");
  });
});
