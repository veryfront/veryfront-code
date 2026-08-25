import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AgUiResumeSignalSchema,
  createAgUiCancelHandler,
  createAgUiResumeHandler,
  RunCancelledError,
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
    const pending = sessionManager.waitForSignal("run_1", "tool_1");

    const handler = createAgUiCancelHandler({ sessionManager });
    const response = await handler(
      new Request("https://example.com/api/runs/run_1", {
        method: "DELETE",
      }),
    );

    assertEquals(response.status, 202);
    assertEquals(await response.json(), { accepted: true });
    assertEquals(
      sessionManager.getRunStatus("run_1"),
      null,
      "the cancelled run must no longer be active",
    );
    await assertRejects(
      () => pending,
      RunCancelledError,
      undefined,
      "the cancel handler must reject the parked waiter",
    );
  });

  it("withholds infrastructure headers from run-id resolvers", async () => {
    const sessionManager = new RunResumeSessionManager<{ ok: boolean }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    void sessionManager.waitForSignal("run_1", "tool_1").catch(() => undefined);

    const handler = createAgUiCancelHandler({
      sessionManager,
      resolveRunId: ({ request, requestOrCtx }) => {
        assertEquals(requestOrCtx, request);
        assertEquals(request.headers.get("authorization"), "Bearer public-user");
        assertEquals(request.headers.get("cookie"), "session=public");
        assertEquals(request.headers.get("x-token"), null);
        assertEquals(request.headers.get("x-project-id"), null);
        assertEquals(request.headers.get("x-forwarded-host"), null);
        return "run_1";
      },
    });
    const response = await handler(
      new Request("https://example.com/api/runs/ignored", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer public-user",
          Cookie: "session=public",
          "x-token": "host-secret",
          "x-project-id": "infrastructure-project",
          "x-forwarded-host": "trusted-proxy.example",
        },
      }),
    );

    assertEquals(response.status, 202);
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

  it("returns 409 when a tool result arrives for a wait that is not pending", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForSignal("run_1", "tool_1").catch(() => undefined);

    const handler = createAgUiResumeHandler({ sessionManager });
    const response = await handler(
      new Request("https://example.com/api/runs/run_1/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tool_result",
          toolCallId: "tool_2",
          result: { ok: true },
        }),
      }),
    );

    assertEquals(
      response.status,
      409,
      "a result for a wait that is not pending must conflict, not fall through to 500",
    );
    assertEquals(
      await response.json(),
      { error: "TOOL_RESULT_NOT_WAITING" },
      "the not-waiting conflict must use the documented error code",
    );

    sessionManager.cancelRun("run_1");
    await pending;
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
