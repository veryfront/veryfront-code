import "#veryfront/schemas/_test-setup.ts";
import { AG_UI_MAX_REQUEST_BODY_BYTES } from "./request-shared.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AgUiResumeSignalSchema,
  createAgUiCancelHandler,
  createAgUiResumeHandler,
  RunCancelledError,
  RunResumeSessionManager,
} from "../index.ts";

// Every run control handler now requires an authority decision, so the
// behavioural tests below state one explicitly. `run-control-authorization.test.ts`
// covers what happens when the decision is negative or missing.
const allowRunControl = () => true;

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

  for (const operation of ["resume", "cancel"] as const) {
    for (const callback of ["resolve", "authorize"] as const) {
      it(`bounds standalone ${operation} bodies before the ${callback} callback reads them`, async () => {
        let calls = 0;
        let cancelled = false;
        let pulls = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            controller.enqueue(new TextEncoder().encode(pulls <= 40 ? " ".repeat(65_536) : "{}"));
            if (pulls === 41) controller.close();
          },
          cancel() {
            cancelled = true;
          },
        });
        const createHandler = operation === "resume"
          ? createAgUiResumeHandler
          : createAgUiCancelHandler;
        const handler = createHandler({
          sessionManager: new RunResumeSessionManager<{ result: unknown; isError: boolean }>(),
          ...(callback === "resolve"
            ? {
              resolveRunId: async ({ request }: { request: Request }) => {
                calls++;
                await request.json();
                return "run-large";
              },
            }
            : {}),
          authorizeRunControl: async ({ request }) => {
            calls++;
            await request.json();
            return false;
          },
        });
        const response = await handler(
          new Request(
            `https://example.test/api/runs/run-large${operation === "resume" ? "/resume" : ""}`,
            {
              method: operation === "resume" ? "POST" : "DELETE",
              body,
              ...{ duplex: "half" },
            },
          ),
        );
        assertEquals(response.status, 413);
        assertEquals(calls, 0);
        assertEquals(pulls <= 18, true);
        assertEquals(cancelled, true);
      });
    }
  }

  it("submits a tool result through the public resume handler", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForSignal("run_1", "tool_1");

    const handler = createAgUiResumeHandler({
      sessionManager,
      authorizeRunControl: allowRunControl,
    });
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

  it("preserves the resume body when authorization consumes its request", async () => {
    const sessionManager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
    sessionManager.startRun({ runId: "run_body", threadId: "thread" });
    const pending = sessionManager.waitForSignal("run_body", "tool_body").catch(() => undefined);
    const payload = { type: "tool_result", toolCallId: "tool_body", result: { text: "retained" } };
    const handler = createAgUiResumeHandler({
      sessionManager,
      authorizeRunControl: async ({ request }) => {
        assertEquals(await request.json(), payload);
        return true;
      },
    });
    try {
      const response = await handler(
        new Request("https://example.test/api/runs/run_body/resume", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
      assertEquals(response.status, 200);
      assertEquals(await pending, { result: { text: "retained" }, isError: false });
    } finally {
      sessionManager.reset();
      await pending;
    }
  });

  for (const customResolver of [false, true]) {
    it(`cancels oversized upload sources when clones are unread (custom resolver=${customResolver})`, async () => {
      const sessionManager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(AG_UI_MAX_REQUEST_BODY_BYTES + 1));
        },
        cancel() {
          cancelled = true;
        },
      });
      const handler = createAgUiResumeHandler({
        sessionManager,
        authorizeRunControl: allowRunControl,
        ...(customResolver ? { resolveRunId: () => "run_large" } : {}),
      });
      const init = { method: "POST", body, duplex: "half" };
      const response = await handler(
        new Request("https://example.test/api/runs/run_large/resume", init),
      );
      assertEquals(response.status, 413);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(cancelled, true);
    });
  }

  it("cancels a waiting run through the public cancel handler", async () => {
    const sessionManager = new RunResumeSessionManager<{ ok: boolean }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = sessionManager.waitForSignal("run_1", "tool_1");

    const handler = createAgUiCancelHandler({
      sessionManager,
      authorizeRunControl: allowRunControl,
    });
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
      authorizeRunControl: allowRunControl,
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

  for (const operation of ["resume", "cancel"] as const) {
    it(`withholds infrastructure headers from ${operation} authorizers on denial`, async () => {
      const sessionManager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
      let observed: Record<string, string | null> | undefined;
      const createHandler = operation === "resume"
        ? createAgUiResumeHandler
        : createAgUiCancelHandler;
      const handler = createHandler({
        sessionManager,
        authorizeRunControl: ({ request }) => {
          observed = {
            authorization: request.headers.get("authorization"),
            token: request.headers.get("x-token"),
            project: request.headers.get("x-project-id"),
            proxy: request.headers.get("x-forwarded-host"),
          };
          return false;
        },
      });
      const response = await handler(
        new Request(
          `https://example.test/api/runs/run_private${operation === "resume" ? "/resume" : ""}`,
          {
            method: operation === "resume" ? "POST" : "DELETE",
            headers: {
              Authorization: "Bearer public-user",
              "x-token": "synthetic-host-secret",
              "x-project-id": "private-project",
              "x-forwarded-host": "private-proxy",
            },
          },
        ),
      );
      assertEquals(response.status, 403);
      assertEquals(observed, {
        authorization: "Bearer public-user",
        token: null,
        project: null,
        proxy: null,
      });
    });
  }

  it("accepts a request wrapper and returns 410 for inactive runs", async () => {
    const handler = createAgUiResumeHandler({
      authorizeRunControl: allowRunControl,
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
      authorizeRunControl: allowRunControl,
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
      authorizeRunControl: allowRunControl,
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

    const handler = createAgUiResumeHandler({
      sessionManager,
      authorizeRunControl: allowRunControl,
    });
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

    const handler = createAgUiResumeHandler({
      sessionManager,
      authorizeRunControl: allowRunControl,
    });
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
      authorizeRunControl: allowRunControl,
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

  /**
   * An integration-auth park cancels the runtime turn, then resumes the same run
   * once the integration is connected. The ordinary cancel keeps a tombstone so a
   * delayed start of a cancelled run is refused; kept for a park, that tombstone
   * refuses the resume start instead.
   */
  it("keeps a run startable after a cancellation for an integration-auth park", async () => {
    const sessionManager = new RunResumeSessionManager<{ ok: boolean }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const handler = createAgUiCancelHandler({
      sessionManager,
      authorizeRunControl: allowRunControl,
    });

    const response = await handler(
      new Request("https://example.com/api/runs/run_1?reason=integration_auth_park", {
        method: "DELETE",
      }),
    );

    assertEquals(response.status, 202);
    assertEquals(sessionManager.getRunStatus("run_1"), null);
    assertExists(
      sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() }),
      "the resume start must not be refused as a delayed start",
    );
  });

  it("does not remember a park cancellation for a run that is not active", async () => {
    const sessionManager = new RunResumeSessionManager<{ ok: boolean }>();
    const handler = createAgUiCancelHandler({
      sessionManager,
      authorizeRunControl: allowRunControl,
    });

    const response = await handler(
      new Request("https://example.com/api/runs/run_1?reason=integration_auth_park", {
        method: "DELETE",
      }),
    );

    assertEquals(response.status, 204);
    assertExists(sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() }));
  });

  it("still refuses a delayed start after an ordinary cancellation", async () => {
    const sessionManager = new RunResumeSessionManager<{ ok: boolean }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const handler = createAgUiCancelHandler({
      sessionManager,
      authorizeRunControl: allowRunControl,
    });

    const response = await handler(
      new Request("https://example.com/api/runs/run_1", { method: "DELETE" }),
    );

    assertEquals(response.status, 202);
    let refused: unknown;
    try {
      sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    } catch (error) {
      refused = error;
    }
    assertEquals(refused instanceof RunCancelledError, true);
  });

  /**
   * The park reason arrives in the request, so it only changes what an
   * authorized cancellation remembers. Without authority for the run the cancel
   * is refused outright and the run keeps running.
   */
  it("refuses a park cancellation without authority for the run", async () => {
    const sessionManager = new RunResumeSessionManager<{ ok: boolean }>();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const handler = createAgUiCancelHandler({
      sessionManager,
      authorizeRunControl: () => false,
    });

    const response = await handler(
      new Request("https://example.com/api/runs/run_1?reason=integration_auth_park", {
        method: "DELETE",
      }),
    );

    assertEquals(response.status, 403);
    assertEquals(sessionManager.getRunStatus("run_1"), "running");
  });
});
