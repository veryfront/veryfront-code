import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildLiveEvalRequestBody,
  createDurableRunCanaryApiClient,
  createLiveEvalApiClient,
  createLiveEvalCaseSupport,
  deleteLiveEvalConversation,
  evaluateRuntimeConfidenceEnv,
  parseDurableRunCanaryRunSummary,
  waitForOpenLiveEvalInputRequest,
} from "veryfront/eval/agent-service";

function createSseResponse(
  events: Array<{ event: string; data: Record<string, unknown> }>,
  status = 200,
): Response {
  return new Response(
    events.map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`).join(
      "",
    ),
    { status, headers: { "content-type": "text/event-stream" } },
  );
}

describe("eval/agent-service API hardening", () => {
  it("encodes untrusted identifiers as individual API path segments", async () => {
    let requestedUrl = "";
    await deleteLiveEvalConversation(
      {
        apiUrl: "https://api.example.test/v1",
        authToken: "test-token",
        projectId: null,
        fetch: (input) => {
          requestedUrl = String(input);
          return Promise.resolve(new Response(null, { status: 204 }));
        },
      },
      { conversationId: "conversation/../admin?all=true", requestTimeoutMs: 1_000 },
    );

    assertEquals(
      new URL(requestedUrl).pathname,
      "/v1/conversations/conversation%2F%2E%2E%2Fadmin%3Fall%3Dtrue",
    );
  });

  it("accepts empty successful canary responses without parsing JSON", async () => {
    const requestedUrls: string[] = [];
    const client = createDurableRunCanaryApiClient({
      apiUrl: "https://api.example.test/v1",
      authToken: "test-token",
      agentId: "agent",
      projectId: null,
      requestTimeoutMs: 1_000,
      fetch: (input) => {
        requestedUrls.push(String(input));
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    await client.createDurableRootRun({
      conversationId: "conversation",
      runId: "run",
    });
    assertEquals(new URL(requestedUrls[0]!).pathname, "/v1/runs");
  });

  it("parses nullable durable summaries and executes every canary API operation", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const messageId = "22222222-2222-4222-8222-222222222222";
    const requestedPaths: string[] = [];
    const summaryPayload = {
      run_id: "run-id",
      conversation_id: conversationId,
      message_id: messageId,
      agent_id: "agent",
      status: "completed",
      latest_event_id: 2,
      latest_external_event_sequence: null,
      waiting_tool_call_id: null,
      waiting_tool_name: null,
      terminal_error_code: null,
      terminal_error_message: null,
      started_at: null,
      finished_at: null,
    };
    assertEquals(parseDurableRunCanaryRunSummary(summaryPayload).latestExternalEventSequence, null);

    const client = createDurableRunCanaryApiClient({
      apiUrl: "https://api.example.test/v1",
      authToken: "test-token",
      agentId: "agent",
      projectId: "project",
      requestTimeoutMs: 1_000,
      fetch: (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        requestedPaths.push(`${method} ${url.pathname}`);
        if (method === "POST" && url.pathname.endsWith("/messages")) {
          return Promise.resolve(Response.json({ id: messageId, role: "user", parts: [] }));
        }
        if (method === "GET" && url.pathname.includes("/runs/")) {
          return Promise.resolve(Response.json(summaryPayload));
        }
        if (method === "GET" && url.pathname.endsWith("/messages")) {
          return Promise.resolve(Response.json({
            data: [{ id: messageId, role: "assistant", parts: [] }],
          }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    assertEquals(
      (await client.sendUserMessageForCanary({
        conversationId: "conversation/../admin",
        prompt: "hello",
      })).id,
      messageId,
    );
    await client.createDurableRootRun({ conversationId, runId: "run-id" });
    assertEquals(
      (await client.getRunSummary({ conversationId, runId: "run/../admin" })).status,
      "completed",
    );
    assertEquals(
      (await client.listMessagesForCanary({ conversationId })).length,
      1,
    );
    await client.startDurableRun({
      conversationId,
      runId: "run-id",
      messageId,
      userMessageId: messageId,
      prompt: "hello",
    });

    assertEquals(
      requestedPaths.includes(
        "POST /v1/conversations/conversation%2F%2E%2E%2Fadmin/messages",
      ),
      true,
    );
    assertEquals(
      requestedPaths.includes(
        `GET /v1/conversations/${conversationId}/runs/run%2F%2E%2E%2Fadmin`,
      ),
      true,
    );
  });

  it("does not copy API response bodies into public errors", async () => {
    const secret = "sensitive-provider-payload";
    const error = await assertRejects(
      () =>
        deleteLiveEvalConversation(
          {
            apiUrl: "https://api.example.test",
            authToken: "test-token",
            projectId: null,
            fetch: () => Promise.resolve(new Response(secret, { status: 500 })),
          },
          { conversationId: "conversation", requestTimeoutMs: 1_000 },
        ),
      Error,
      "500",
    );
    assertEquals(error.message.includes(secret), false);
  });

  it("executes the live API lifecycle with encoded resource paths", async () => {
    const requests: Array<{ method: string; pathname: string }> = [];
    const filePath = "fixtures/../sample?.txt";
    const client = createLiveEvalApiClient({
      apiUrl: "https://api.example.test/v1",
      authToken: "test-token",
      projectId: "project/../admin",
      fetch: (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        requests.push({ method, pathname: url.pathname });
        if (url.hostname === "uploads.example.test") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (method === "POST" && url.pathname === "/v1/conversations") {
          return Promise.resolve(Response.json({ id: "conversation-id" }));
        }
        if (method === "POST" && url.pathname.endsWith("/uploads")) {
          return Promise.resolve(Response.json({
            file_upload_url: "https://uploads.example.test/signed?signature=test-value",
            required_headers: { "x-upload": "allowed" },
          }));
        }
        if (method === "GET" && url.pathname.endsWith("/uploads")) {
          return Promise.resolve(Response.json({ data: [{ path: filePath }] }));
        }
        if (method === "GET" && url.pathname.includes("/files/")) {
          return Promise.resolve(Response.json({ content: "fixture content" }));
        }
        if (method === "POST" && url.pathname.endsWith("/releases")) {
          return Promise.resolve(Response.json({ id: "release-id" }));
        }
        if (method === "GET" && url.pathname.endsWith("/input-requests")) {
          return Promise.resolve(Response.json({
            data: [{ id: "request-id", status: "open" }],
          }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    assertEquals(
      await client.createConversation({ title: "Eval", requestTimeoutMs: 1_000 }),
      "conversation-id",
    );
    assertEquals(
      await client.createProjectUploadFixture({
        filePath,
        contentType: "text/plain",
        body: "fixture",
        requestTimeoutMs: 1_000,
        maxAttempts: 1,
      }),
      filePath,
    );
    assertEquals(
      await client.getProjectFile({ filePath, requestTimeoutMs: 1_000 }),
      { path: filePath, content: "fixture content" },
    );
    assertEquals(
      await client.createRelease({ description: "Eval release", requestTimeoutMs: 1_000 }),
      "release-id",
    );
    assertEquals(
      await client.listOpenInputRequests({
        conversationId: "conversation/../admin",
        requestTimeoutMs: 1_000,
      }),
      [{ id: "request-id", status: "open" }],
    );
    await client.submitInputResponse({
      conversationId: "conversation/../admin",
      inputRequestId: "request/../admin",
      values: { approved: true },
      requestTimeoutMs: 1_000,
    });
    await client.cancelInputRequest({
      conversationId: "conversation/../admin",
      inputRequestId: "request/../admin",
      requestTimeoutMs: 1_000,
    });
    await client.deleteProjectFile({ filePath, requestTimeoutMs: 1_000 });
    await client.deleteConversation({
      conversationId: "conversation/../admin",
      requestTimeoutMs: 1_000,
    });

    assertEquals(
      requests.some((request) =>
        request.pathname ===
          "/v1/projects/project%2F%2E%2E%2Fadmin/uploads"
      ),
      true,
    );
    assertEquals(
      requests.some((request) =>
        request.pathname.includes(
          "/input-requests/request%2F%2E%2E%2Fadmin/responses",
        )
      ),
      true,
    );
  });

  it("rejects mismatched upload sizes and malformed input-request records", async () => {
    const noRequestClient = createLiveEvalApiClient({
      apiUrl: "https://api.example.test",
      authToken: "test-token",
      projectId: "project",
      fetch: () => Promise.reject(new Error("fetch must not run")),
    });
    await assertRejects(
      () =>
        noRequestClient.createProjectUploadFixture({
          filePath: "fixture.txt",
          contentType: "text/plain",
          body: "four",
          size: 3,
          requestTimeoutMs: 1_000,
        }),
      Error,
      "does not match",
    );

    const malformedClient = createLiveEvalApiClient({
      apiUrl: "https://api.example.test",
      authToken: "test-token",
      projectId: null,
      fetch: () => Promise.resolve(Response.json({ data: [{ id: 1, status: "open" }] })),
    });
    await assertRejects(
      () =>
        malformedClient.listOpenInputRequests({
          conversationId: "conversation",
          requestTimeoutMs: 1_000,
        }),
      Error,
    );
  });

  it("forwards maxSteps without requiring an allowed-tools override", () => {
    const body = buildLiveEvalRequestBody({
      testCaseId: "case",
      prompt: "hello",
      metadata: { evalCase: "spoofed" },
      projectId: null,
      maxSteps: 3,
    });

    assertEquals(body.forwardedProps?.veryfront.runtimeOverrides, { maxSteps: 3 });
    assertEquals(body.state.evalCase, "case");
    assertThrows(
      () =>
        buildLiveEvalRequestBody({
          testCaseId: "case",
          prompt: "hello",
          projectId: null,
          maxSteps: 0,
        }),
      Error,
      "maxSteps",
    );
  });

  it("fails file verification when the project reader is unavailable", async () => {
    const support = createLiveEvalCaseSupport({
      endpoint: "https://runtime.example.test",
      authToken: "test-token",
      apiUrl: "https://api.example.test",
      projectId: "project",
      branchId: null,
      model: null,
      requestTimeoutMs: 1_000,
      progressLogIntervalMs: 1_000,
      enableLlmJudge: false,
    });

    assertStringIncludes(
      await support.verifyFileExists({ filePath: "app/page.tsx" }) ?? "",
      "reader is not configured",
    );
  });

  it("aborts input-request polling without waiting for the next interval", async () => {
    const controller = new AbortController();
    let calls = 0;
    const promise = waitForOpenLiveEvalInputRequest(
      {
        apiUrl: "https://api.example.test",
        authToken: "test-token",
        projectId: null,
        fetch: () => {
          calls += 1;
          return Promise.resolve(Response.json({ data: [] }));
        },
      },
      {
        conversationId: "conversation",
        requestTimeoutMs: 1_000,
        abortSignal: controller.signal,
        pollIntervalMs: 30_000,
        timeoutMs: 60_000,
      },
    );
    controller.abort();

    await assertRejects(() => promise, Error, "aborted");
    assertEquals(calls <= 1, true);
  });

  it("redacts credentials and query values from preflight messages", () => {
    const result = evaluateRuntimeConfidenceEnv(
      {},
      "https://user:password@api.example.test/v1?token=sensitive#fragment",
    );

    assertEquals(result.resolvedApiUrl.includes("sensitive"), true);
    assertEquals(result.messages[0], "Resolved VERYFRONT_API_URL: https://api.example.test/v1");
  });

  it("fails live eval runs that do not reach a successful AG-UI terminal event", async () => {
    const support = createLiveEvalCaseSupport({
      endpoint: "https://runtime.example.test",
      authToken: "test-token",
      apiUrl: "https://api.example.test",
      projectId: null,
      branchId: null,
      model: null,
      requestTimeoutMs: 1_000,
      progressLogIntervalMs: 1_000,
      enableLlmJudge: false,
      log: () => {},
      fetch: () =>
        Promise.resolve(createSseResponse([
          { event: "RunStarted", data: { runId: "run" } },
          { event: "TextMessageContent", data: { delta: "partial output" } },
        ])),
    });

    const result = await support.runEval({
      id: "incomplete",
      label: "Incomplete run",
      prompt: "hello",
      verify: () => null,
    }, "framework");
    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "RUN_FINISHED");
  });

  it("requires a standalone PASS token from the optional live judge", async () => {
    const support = createLiveEvalCaseSupport({
      endpoint: "https://runtime.example.test",
      authToken: "test-token",
      apiUrl: "https://api.example.test",
      projectId: null,
      branchId: null,
      model: null,
      requestTimeoutMs: 1_000,
      progressLogIntervalMs: 1_000,
      enableLlmJudge: true,
      fetch: () =>
        Promise.resolve(createSseResponse([
          { event: "RunStarted", data: { runId: "run" } },
          { event: "TextMessageContent", data: { delta: "PASSION is not a verdict" } },
          { event: "RunFinished", data: {} },
        ])),
    });

    assertEquals(
      (await support.judgeLlm({
        question: "question",
        answer: "answer",
        criteria: "criteria",
      })).pass,
      false,
    );
  });

  it("returns a failed result when live eval preparation throws", async () => {
    const support = createLiveEvalCaseSupport({
      endpoint: "https://runtime.example.test",
      authToken: "test-token",
      apiUrl: "https://api.example.test",
      projectId: null,
      branchId: null,
      model: null,
      requestTimeoutMs: 1_000,
      progressLogIntervalMs: 1_000,
      enableLlmJudge: false,
    });

    const result = await support.runEval({
      id: "prepare-failure",
      label: "Prepare failure",
      prepare: () => Promise.reject(new Error("fixture unavailable")),
      verify: () => null,
    }, "framework");
    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "fixture unavailable");
  });

  it("runs prepared cleanup when sidecar startup fails", async () => {
    let cleaned = false;
    const support = createLiveEvalCaseSupport({
      endpoint: "https://runtime.example.test",
      authToken: "test-token",
      apiUrl: "https://api.example.test",
      projectId: null,
      branchId: null,
      model: null,
      requestTimeoutMs: 1_000,
      progressLogIntervalMs: 1_000,
      enableLlmJudge: false,
    });

    const result = await support.runEval({
      id: "sidecar-failure",
      label: "Sidecar failure",
      prepare: () =>
        Promise.resolve({
          startSidecar: () => Promise.reject(new Error("sidecar unavailable")),
          cleanup: () => {
            cleaned = true;
            return Promise.resolve();
          },
        }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "sidecar unavailable");
    assertEquals(cleaned, true);
  });
});
