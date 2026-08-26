import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgUiRequestSchema } from "veryfront/agent";
import { datasets, evalAgent, type EvalAgentAdapterResult, metrics, runEval } from "veryfront/eval";
import { defineSchema } from "veryfront/schemas";
import { type Tool, tool } from "veryfront/tool";
import {
  buildAgentServiceEvalRequestBody,
  createAgentServiceEvalAdapter,
  createDurableRunCanaryApiClient,
  createDurableRunCanaryRunner,
  createDurableRunTokenGrowthCanaryCase,
  createLiveEvalCaseSupport,
  type DurableRunCanaryApiClient,
  type DurableRunCanaryExecution,
  type DurableRunCanaryRunnerConfig,
  type DurableRunCanaryRunSummary,
  evaluateAgentServiceEvalEnvironment,
  evaluateRuntimeConfidenceEnv,
  resolveAgentServiceEvalEnvironment,
  resolveDurableRunCanaryEnvironment,
  runDurableRunCanaryCli,
  runLiveEvalCli,
} from "veryfront/eval/agent-service";
import { bindTrustedLocalEvalFetch } from "#veryfront/eval/agent-service/trusted-fetch.ts";

function createSseResponse(
  events: Array<{ event: string; data: Record<string, unknown> }>,
): Response {
  return new Response(
    events.map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`).join(
      "",
    ),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function createCompletedDurableRunCanaryApiClient(
  conversationId: string,
  options: { failStartPrompt?: string } = {},
): {
  apiClient: DurableRunCanaryApiClient;
  createdRunIds: string[];
} {
  const createdRunIds: string[] = [];

  return {
    createdRunIds,
    apiClient: {
      createDurableRootRun: async ({ runId }) => {
        createdRunIds.push(runId);
      },
      getRunSummary: async ({ runId }) => ({
        runId,
        conversationId,
        messageId: "22222222-2222-4222-8222-222222222222",
        agentId: "veryfront",
        status: "completed",
        latestEventId: 1,
        latestExternalEventSequence: null,
        waitingToolCallId: null,
        waitingToolName: null,
        terminalErrorCode: null,
        terminalErrorMessage: null,
        startedAt: "2026-07-05T19:00:00.000Z",
        finishedAt: "2026-07-05T19:00:01.000Z",
      }),
      listMessagesForCanary: async () => [],
      sendUserMessageForCanary: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        role: "user",
        parts: [],
      }),
      startDurableRun: async ({ prompt }) => {
        if (prompt === options.failStartPrompt) {
          throw new Error(`failed to start ${prompt}`);
        }
      },
    },
  };
}

describe("eval/agent-service", () => {
  it("resolves environment values for agent-service evals", () => {
    const environment = resolveAgentServiceEvalEnvironment({
      AG_UI_EVAL_ENDPOINT: "http://127.0.0.1:4311/api/ag-ui",
      VERYFRONT_TOKEN: "token",
      VERYFRONT_API_URL: "https://api.example.test",
      AG_UI_EVAL_PROJECT_ID: "project_123",
      AG_UI_EVAL_PROJECT_SLUG: "demo-project",
      AG_UI_EVAL_BRANCH_ID: "branch_123",
      AG_UI_EVAL_MODEL: "provider/model",
    });

    assertEquals(environment, {
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      apiUrl: "https://api.example.test",
      projectId: "project_123",
      projectSlug: "demo-project",
      branchId: "branch_123",
      model: "provider/model",
    });
  });

  it("resolves an explicit direct model for durable canaries", () => {
    const environment = resolveDurableRunCanaryEnvironment({
      VERYFRONT_API_URL: "https://api.example.test",
      VERYFRONT_TOKEN: "token",
      AG_UI_EVAL_PROJECT_ID: "project_123",
      AG_UI_EVAL_MODEL: "anthropic/claude-sonnet-4-6",
    });

    assertEquals(environment.model, "anthropic/claude-sonnet-4-6");
  });

  it("forwards the durable canary model into the runner and report", async () => {
    const reportDirectory = await Deno.makeTempDir();
    const reportPath = `${reportDirectory}/durable.json`;
    let runnerConfig: DurableRunCanaryRunnerConfig | undefined;

    try {
      const exitCode = await runDurableRunCanaryCli({
        agentId: "veryfront",
        env: {
          VERYFRONT_API_URL: "https://api.example.test",
          VERYFRONT_TOKEN: "token",
          AG_UI_EVAL_PROJECT_ID: "project_123",
          AG_UI_EVAL_MODEL: "anthropic/claude-sonnet-4-6",
          DURABLE_CANARY_REPORT_PATH: reportPath,
        },
        createCases: () => [{
          id: "model-forwarding",
          label: "Durable canary model forwarding",
          prepare: async () => ({
            cleanup: async () => {},
            conversationId: "11111111-1111-4111-8111-111111111111",
            prompt: "Verify durable canary model forwarding",
            title: "Durable canary model forwarding",
            validate: () => {},
          }),
        }],
        createRunner: (config) => {
          runnerConfig = config;
          return createDurableRunCanaryRunner(
            config,
            createCompletedDurableRunCanaryApiClient(
              "11111111-1111-4111-8111-111111111111",
            ).apiClient,
          );
        },
        log: () => {},
      });

      assertEquals(exitCode, 0);
      assertEquals(runnerConfig?.model, "anthropic/claude-sonnet-4-6");
      const report = JSON.parse(await Deno.readTextFile(reportPath));
      assertEquals(report.model, "anthropic/claude-sonnet-4-6");
    } finally {
      await Deno.remove(reportDirectory, { recursive: true });
    }
  });

  it("reports missing live eval environment blockers", () => {
    const result = evaluateAgentServiceEvalEnvironment({}, "https://api.example.test");

    assertEquals(result.ok, false);
    assertEquals(result.resolvedApiUrl, "https://api.example.test");
    assertEquals(result.messages, [
      "Resolved VERYFRONT_API_URL: https://api.example.test",
      "BLOCKER: VERYFRONT_TOKEN is missing",
      "BLOCKER: AG_UI_EVAL_PROJECT_ID is missing",
      "Agent-service eval preflight: FAIL",
    ]);
  });

  it("builds an AG-UI request body from an eval example", () => {
    const body = buildAgentServiceEvalRequestBody({
      exampleId: "smoke",
      input: { prompt: "List files", metadata: { area: "files" } },
      agentId: "researcher",
      projectId: "project_123",
      branchId: "branch_123",
      model: "provider/model",
      conversationId: "conversation_123",
      allowedTools: ["list_files"],
      maxSteps: 4,
    });

    assertEquals(body.state, {
      evalCase: "smoke",
      area: "files",
    });
    assertEquals(body.messages, [
      {
        id: body.messages[0]?.id,
        role: "user",
        parts: [{ type: "text", text: "List files" }],
      },
    ]);
    const parsedAgUiRequest = AgUiRequestSchema.parse(body);
    assertEquals(parsedAgUiRequest.messages[0]?.parts, [{ type: "text", text: "List files" }]);
    assertEquals(body.forwardedProps, {
      veryfront: {
        agentId: "researcher",
        projectId: "project_123",
        branchId: "branch_123",
        conversationId: "conversation_123",
        model: "provider/model",
        runtimeOverrides: {
          allowedTools: ["list_files"],
          maxSteps: 4,
        },
      },
    });
  });

  it("does not clear allowed tools for maxSteps-only runtime overrides", () => {
    const body = buildAgentServiceEvalRequestBody({
      exampleId: "smoke",
      input: "List files",
      projectId: "project_123",
      maxSteps: 2,
    });

    assertEquals(body.forwardedProps, {
      veryfront: {
        projectId: "project_123",
        runtimeOverrides: {
          maxSteps: 2,
        },
      },
    });
  });

  it("creates an EvalAgentAdapter for live AG-UI agent-service execution", async () => {
    const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      projectId: "project_123",
      projectSlug: "demo-project",
      contentSourceId: "preview-main",
      branchId: "branch_123",
      branchName: "main",
      environment: "preview",
      environmentId: "env_123",
      forwardedHost: "demo-project.preview.veryfront.org",
      forwardedProto: "https",
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          init: init ?? {},
          body: JSON.parse(String(init?.body)),
        });
        return createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          { event: "ToolCallStart", data: { toolCallName: "list_files" } },
          { event: "TextMessageContent", data: { delta: "Done" } },
          {
            event: "RunFinished",
            data: {
              metadata: {
                inputTokens: 12,
                outputTokens: 8,
                totalTokens: 20,
                billableInputTokens: 12,
                billableOutputTokens: 10,
                costUsd: 0.002,
                providerInputCostUsd: 0.0004,
                providerOutputCostUsd: 0.0006,
                providerCostUsd: 0.001,
                veryfrontInputChargeUsd: 0.001,
                veryfrontOutputChargeUsd: 0.0015,
                veryfrontChargeUsd: 0.0025,
                veryfrontBilledUsd: 0.1,
                costCredits: 1,
                costSource: "gateway",
                cacheReadInputTokens: 3,
                cachedInputTokens: 3,
                reasoningTokens: 2,
                usageCaptureStatus: "complete",
              },
            },
          },
        ]);
      },
      now: () => 1_000,
    });

    const definition = evalAgent({
      id: "eval:service",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "List files" }]),
    });

    const report = await runEval(definition, {
      adapters: { agent: adapter },
      now: () => new Date("2026-06-20T10:00:00.000Z"),
    });

    assertEquals(requests.length, 1);
    assertEquals(requests[0]?.url, "http://127.0.0.1:4311/api/ag-ui");
    assertEquals(requests[0]?.init.method, "POST");
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>).Authorization,
      "Bearer token",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-token"],
      "token",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-project-slug"],
      "demo-project",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-project-id"],
      "project_123",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-content-source-id"],
      "preview-main",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-branch-id"],
      "branch_123",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-branch-name"],
      "main",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-environment"],
      "preview",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-environment-id"],
      "env_123",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-forwarded-host"],
      "demo-project.preview.veryfront.org",
    );
    assertEquals(
      (requests[0]?.init.headers as Record<string, string>)["x-forwarded-proto"],
      "https",
    );
    assertEquals(requests[0]?.body.forwardedProps, {
      veryfront: {
        projectId: "project_123",
        branchId: "branch_123",
      },
    });

    const record = report.records[0]!;
    assertEquals(record.output, {
      text: "Done",
      agUi: {
        responseStatus: 200,
        eventTypes: ["RUN_STARTED", "TOOL_CALL_START", "TEXT_MESSAGE_CONTENT", "RUN_FINISHED"],
        runError: null,
      },
    });
    assertEquals(record.completed, true);
    assertEquals(record.trace.toolCalls, [{ name: "list_files", status: "ok" }]);
    assertEquals(record.usage, {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      billableInputTokens: 12,
      billableOutputTokens: 10,
      costUsd: 0.002,
      providerInputCostUsd: 0.0004,
      providerOutputCostUsd: 0.0006,
      providerCostUsd: 0.001,
      veryfrontInputChargeUsd: 0.001,
      veryfrontOutputChargeUsd: 0.0015,
      veryfrontChargeUsd: 0.0025,
      veryfrontBilledUsd: 0.1,
      costCredits: 1,
      costSource: "gateway",
      cacheReadInputTokens: 3,
      cachedInputTokens: 3,
      reasoningTokens: 2,
      usageCaptureStatus: "complete",
    });
    assertEquals(report.summary.usage, {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      billableInputTokens: 12,
      billableOutputTokens: 10,
      costUsd: 0.002,
      providerInputCostUsd: 0.0004,
      providerOutputCostUsd: 0.0006,
      providerCostUsd: 0.001,
      veryfrontInputChargeUsd: 0.001,
      veryfrontOutputChargeUsd: 0.0015,
      veryfrontChargeUsd: 0.0025,
      veryfrontBilledUsd: 0.1,
      costCredits: 1,
      costSource: "gateway",
      cacheReadInputTokens: 3,
      cachedInputTokens: 3,
      reasoningTokens: 2,
      usageCaptureStatus: "complete",
    });
    assertEquals(record.durationMs, 0);
    assertStringIncludes(JSON.stringify(record.trace.events), "RUN_FINISHED");
  });

  it("rejects remote eval agent overrides that public AG-UI cannot honor", () => {
    assertThrows(
      () =>
        createAgentServiceEvalAdapter({
          authToken: "token",
          agentId: "researcher",
        }),
      TypeError,
      "cannot select agent",
    );
    assertThrows(
      () =>
        createAgentServiceEvalAdapter({
          authToken: "token",
          agentId: "veryfront",
        }),
      TypeError,
      "cannot select agent",
    );
    assertThrows(
      () =>
        createAgentServiceEvalAdapter({
          authToken: "token",
          agentId: "researcher",
          fetch: async () => new Response(null, { status: 500 }),
        }),
      TypeError,
      "cannot select agent",
    );
  });

  it("allows agent targets when a trusted bound fetch performs agent selection", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const adapter = createAgentServiceEvalAdapter({
      authToken: "token",
      agentId: "researcher",
      fetch: bindTrustedLocalEvalFetch(async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return createSseResponse([
          { event: "RunStarted", data: { runId: "run_bound" } },
          { event: "TextMessageContent", data: { delta: "Done" } },
          { event: "RunFinished", data: {} },
        ]);
      }, "researcher"),
    });

    const definition = evalAgent({
      id: "eval:bound",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "smoke", input: "List files" }]),
    });
    const report = await runEval(definition, {
      adapters: { agent: adapter },
      now: () => new Date("2026-06-20T10:00:00.000Z"),
    });

    assertEquals(report.records[0]?.completed, true);
    assertEquals(requestBody?.forwardedProps, undefined);
  });

  it("marks a non-ok AG-UI response as an incomplete run", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        new Response("", { status: 500, headers: { "content-type": "text/event-stream" } }),
    });
    const definition = evalAgent({
      id: "eval:hosted-non-ok",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "List files" }]),
    });

    const result = await adapter({
      definition,
      example: { id: "smoke", input: "List files" },
      repetition: 1,
    }) as EvalAgentAdapterResult;

    assertEquals(result.completed, false, "a non-ok AG-UI response is never a completed run");
    assertEquals(result.error, "500", "a bodyless non-ok response records the status as the error");
    assertEquals(result.output, {
      text: "",
      agUi: {
        responseStatus: 500,
        eventTypes: [],
        runError: "500",
      },
    }, "the recorded output preserves the failed response status");
  });

  it("marks an AG-UI run error as an incomplete run", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          { event: "RunError", data: { message: "agent crashed" } },
        ]),
    });
    const definition = evalAgent({
      id: "eval:hosted-run-error",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "List files" }]),
    });

    const result = await adapter({
      definition,
      example: { id: "smoke", input: "List files" },
      repetition: 1,
    }) as EvalAgentAdapterResult;

    assertEquals(result.completed, false, "a run that emits RunError is never a completed run");
    assertEquals(result.error, "agent crashed", "the run error message becomes the record error");
    assertEquals(result.output, {
      text: "",
      agUi: {
        responseStatus: 200,
        eventTypes: ["RUN_STARTED", "RUN_ERROR"],
        runError: "agent crashed",
      },
    }, "the recorded output preserves the run error");
  });

  it("marks a stream that never finishes as an incomplete run", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          { event: "TextMessageContent", data: { delta: "Partial" } },
        ]),
    });
    const definition = evalAgent({
      id: "eval:hosted-unfinished",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "List files" }]),
    });

    const result = await adapter({
      definition,
      example: { id: "smoke", input: "List files" },
      repetition: 1,
    }) as EvalAgentAdapterResult;

    assertEquals(
      result.completed,
      false,
      "a stream without RunFinished is never a completed run",
    );
    assertEquals(
      result.error,
      "AG-UI response failed with status 200",
      "a missing RunFinished falls back to the status-based error",
    );
    assertEquals(result.output, {
      text: "Partial",
      agUi: {
        responseStatus: 200,
        eventTypes: ["RUN_STARTED", "TEXT_MESSAGE_CONTENT"],
        runError: null,
      },
    }, "the recorded output keeps the partial stream without RunFinished");
  });

  it("rejects mockTools before fetching from the hosted agent service", async () => {
    let fetchCalled = false;
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () => {
        fetchCalled = true;
        return createSseResponse([]);
      },
    });
    const definition = evalAgent({
      id: "eval:hosted-mocks",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "List files" }]),
      mockTools: {
        list_files: tool({
          id: "list_files",
          description: "List files",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: async () => [],
        }) as Tool,
      },
    });

    const result = await adapter({
      definition,
      example: { id: "smoke", input: "List files" },
      repetition: 1,
    }) as EvalAgentAdapterResult;

    assertEquals(fetchCalled, false);
    assertEquals(result.completed, false);
    assertStringIncludes(result.error ?? "", "mockTools");
  });

  it("marks AG-UI tool result failures in eval traces", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          {
            event: "ToolCallStart",
            data: { toolCallId: "tool_1", toolCallName: "search" },
          },
          {
            event: "ToolCallResult",
            data: {
              toolCallId: "tool_1",
              result: { message: "No results" },
              isError: true,
            },
          },
          { event: "TextMessageContent", data: { delta: "Done" } },
          { event: "RunFinished", data: {} },
        ]),
    });

    const definition = evalAgent({
      id: "eval:service",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "Search docs" }]),
      metrics: [metrics.agent.noFailedTools()],
    });

    const report = await runEval(definition, {
      adapters: { agent: adapter },
    });

    const record = report.records[0]!;
    assertEquals(record.trace.toolCalls, [{
      id: "tool_1",
      name: "search",
      status: "error",
      error: "No results",
    }]);
    assertEquals(record.metrics?.[0]?.pass, false);
    assertEquals(record.metrics?.[0]?.evidence, { failedTools: ["search"] });
  });

  it("classifies denied AG-UI tool results apart from tool errors", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          {
            event: "ToolCallResult",
            data: {
              toolCallId: "tool_1",
              toolCallName: "search",
              isError: true,
              status: "denied",
              result: { message: "blocked" },
            },
          },
          {
            event: "ToolCallResult",
            data: {
              toolCallId: "tool_2",
              toolCallName: "write",
              isError: true,
              result: { message: "Permission denied" },
            },
          },
          { event: "RunFinished", data: {} },
        ]),
    });
    const definition = evalAgent({
      id: "eval:denied-tools",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "Search docs" }]),
    });

    const result = await adapter({
      definition,
      example: { id: "smoke", input: "Search docs" },
      repetition: 1,
    }) as EvalAgentAdapterResult;

    assertEquals(
      result.trace?.toolCalls?.[0]?.status,
      "denied",
      "explicit denied status is preserved",
    );
    assertEquals(
      result.trace?.toolCalls?.[1]?.status,
      "denied",
      "a denied error message is classified as denied, not error",
    );
  });

  it("normalizes AG-UI tool arguments and results into eval traces", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          {
            event: "ToolCallStart",
            data: { toolCallId: "tool_1", toolCallName: "orders_lookup" },
          },
          {
            event: "ToolCallArgs",
            data: { toolCallId: "tool_1", delta: '{"orderId":"A1049"' },
          },
          {
            event: "ToolCallArgs",
            data: { toolCallId: "tool_1", delta: ',"includeHistory":true}' },
          },
          { event: "ToolCallEnd", data: { toolCallId: "tool_1" } },
          {
            event: "ToolCallResult",
            data: {
              toolCallId: "tool_1",
              input: { orderId: "A1049", includeHistory: true },
              result: { status: "unverified" },
            },
          },
          { event: "TextMessageContent", data: { delta: "I need to verify eligibility." } },
          { event: "RunFinished", data: {} },
        ]),
    });

    const definition = evalAgent({
      id: "eval:service",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "Refund order A1049" }]),
      metrics: [
        metrics.agent.calledTool("orders_lookup", {
          input: { orderId: "A1049" },
          match: "partial",
        }),
      ],
    });

    const report = await runEval(definition, {
      adapters: { agent: adapter },
    });

    const record = report.records[0]!;
    assertEquals(record.trace.toolCalls, [{
      id: "tool_1",
      name: "orders_lookup",
      status: "ok",
      input: { orderId: "A1049", includeHistory: true },
      output: { status: "unverified" },
    }]);
    assertEquals(record.metrics?.[0]?.pass, true);
  });

  it("normalizes hosted tool-call status events into eval traces", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          {
            event: "Custom",
            data: {
              name: "tool-call-status",
              value: {
                toolCallId: "tool_1",
                toolCallName: "veryfront_agent.github_get_implementation_frontier",
                status: "in_progress",
                arguments: {},
              },
            },
          },
          {
            event: "Custom",
            data: {
              name: "tool-call-status",
              value: {
                toolCallId: "tool_1",
                toolCallName: "veryfront_agent.github_get_implementation_frontier",
                status: "completed",
                arguments: {},
                result: { nextAction: { kind: "agent-brief-repair" } },
              },
            },
          },
          { event: "TextMessageContent", data: { delta: '{"nextAction":{}}' } },
          {
            event: "Custom",
            data: {
              name: "codex.turn.completed",
              value: {
                usage: {
                  input_tokens: 120,
                  output_tokens: 30,
                  cached_input_tokens: 80,
                  reasoning_output_tokens: 10,
                },
              },
            },
          },
          { event: "RunFinished", data: {} },
        ]),
    });
    const definition = evalAgent({
      id: "eval:hosted-tool-status",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "frontier", input: "Inspect the frontier" }]),
      metrics: [
        metrics.agent.calledTool("veryfront_agent.github_get_implementation_frontier"),
        metrics.agent.notCalledTool("veryfront_agent.github_update_issue"),
      ],
    });

    const report = await runEval(definition, {
      adapters: { agent: adapter },
    });

    const record = report.records[0]!;
    assertEquals(record.completed, true);
    assertEquals(record.trace.toolCalls, [{
      id: "tool_1",
      name: "veryfront_agent.github_get_implementation_frontier",
      status: "ok",
      input: {},
      output: { nextAction: { kind: "agent-brief-repair" } },
    }]);
    assertEquals(record.metrics?.map((metric) => metric.pass), [true, true]);
    assertEquals(record.usage, {
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 80,
      reasoningTokens: 10,
    });
  });

  it("preserves hosted tool-call failures in eval traces", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          {
            event: "Custom",
            data: {
              name: "tool-call-status",
              value: {
                toolCallId: "tool_1",
                toolCallName: "veryfront_agent.github_update_issue",
                status: "failed",
                arguments: { issue_number: 27 },
                error: { message: "write denied" },
              },
            },
          },
          { event: "RunFinished", data: {} },
        ]),
    });
    const definition = evalAgent({
      id: "eval:hosted-tool-error",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "mutation", input: "Update an issue" }]),
      metrics: [metrics.agent.noFailedTools()],
    });

    const report = await runEval(definition, {
      adapters: { agent: adapter },
    });

    const record = report.records[0]!;
    assertEquals(record.trace.toolCalls, [{
      id: "tool_1",
      name: "veryfront_agent.github_update_issue",
      status: "error",
      input: { issue_number: 27 },
      error: "write denied",
    }]);
    assertEquals(record.metrics?.[0]?.pass, false);
  });

  it("keeps standard AG-UI tool results authoritative in mixed hosted streams", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          {
            event: "Custom",
            data: {
              name: "tool-call-status",
              value: {
                toolCallId: "tool_1",
                toolCallName: "search",
                status: "failed",
                result: { source: "custom" },
                error: { message: "custom failure" },
              },
            },
          },
          {
            event: "ToolCallResult",
            data: {
              toolCallId: "tool_1",
              toolCallName: "search",
              result: { source: "ag-ui" },
            },
          },
          {
            event: "ToolCallResult",
            data: {
              toolCallId: "tool_2",
              toolCallName: "write",
              isError: true,
              result: { message: "canonical failure" },
            },
          },
          {
            event: "Custom",
            data: {
              name: "tool-call-status",
              value: {
                toolCallId: "tool_2",
                toolCallName: "write",
                status: "completed",
                result: { source: "custom" },
              },
            },
          },
          { event: "RunFinished", data: {} },
        ]),
    });
    const definition = evalAgent({
      id: "eval:mixed-tool-events",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "mixed", input: "Use tools" }]),
    });

    const result = await adapter({
      definition,
      example: { id: "mixed", input: "Use tools" },
      repetition: 1,
    }) as EvalAgentAdapterResult;

    assertEquals(result.trace?.toolCalls, [
      {
        id: "tool_1",
        name: "search",
        status: "ok",
        output: { source: "ag-ui" },
      },
      {
        id: "tool_2",
        name: "write",
        status: "error",
        error: "canonical failure",
      },
    ]);
  });

  it("merges AG-UI tool argument placeholders before parsing eval traces", async () => {
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      fetch: async () =>
        createSseResponse([
          { event: "RunStarted", data: { runId: "run_123" } },
          {
            event: "ToolCallStart",
            data: { toolCallId: "tool_1", toolCallName: "create_file" },
          },
          {
            event: "ToolCallArgs",
            data: { toolCallId: "tool_1", delta: "{}" },
          },
          {
            event: "ToolCallArgs",
            data: {
              toolCallId: "tool_1",
              delta: '"path":"/plans/report.md","content":"# Report"}',
            },
          },
          { event: "ToolCallEnd", data: { toolCallId: "tool_1" } },
          { event: "ToolCallResult", data: { toolCallId: "tool_1", result: { ok: true } } },
          { event: "RunFinished", data: {} },
        ]),
    });

    const definition = evalAgent({
      id: "eval:service",
      target: "agent:veryfront",
      dataset: datasets.inline([{ id: "smoke", input: "Create the report file" }]),
      metrics: [
        metrics.agent.calledTool("create_file", {
          input: { path: "/plans/report.md" },
          match: "partial",
        }),
      ],
    });

    const report = await runEval(definition, {
      adapters: { agent: adapter },
    });

    const record = report.records[0]!;
    assertEquals(record.trace.toolCalls, [{
      id: "tool_1",
      name: "create_file",
      status: "ok",
      input: { path: "/plans/report.md", content: "# Report" },
      output: { ok: true },
    }]);
    assertEquals(record.metrics?.[0]?.pass, true);
  });

  it("forwards eval project and model context to optional LLM judge requests", async () => {
    const requests: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const { judgeLlm } = createLiveEvalCaseSupport({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      apiUrl: "https://api.example.test",
      projectId: "project_123",
      branchId: "branch_123",
      model: "openai/gpt-5.5",
      requestTimeoutMs: 240_000,
      progressLogIntervalMs: 15_000,
      enableLlmJudge: true,
      fetch: async (_input, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          headers: init?.headers as Record<string, string>,
        });
        return createSseResponse([
          { event: "RunStarted", data: { runId: "run_judge" } },
          { event: "TextMessageContent", data: { delta: "PASS enough evidence" } },
          { event: "RunFinished", data: {} },
        ]);
      },
    });

    const result = await judgeLlm({
      question: "What happened?",
      answer: "The run used the gateway.",
      criteria: "Pass if the answer identifies the gateway.",
    });

    assertEquals(result, { pass: true, reason: "PASS enough evidence" });
    assertEquals(requests.length, 1);
    assertEquals(requests[0]?.headers.Authorization, "Bearer token");
    assertEquals(requests[0]?.body.forwardedProps, {
      veryfront: {
        projectId: "project_123",
        branchId: "branch_123",
        model: "openai/gpt-5.5",
        runtimeOverrides: {
          allowedTools: [],
          maxSteps: 2,
        },
      },
    });
  });

  it("exports the agent-service module from the public import map", async () => {
    const mod = await import("veryfront/eval/agent-service");

    assertEquals(typeof mod.createAgentServiceEvalAdapter, "function");
    assertEquals(typeof mod.runLiveEvalCli, "function");
    assertEquals(typeof mod.runDurableRunCanaryCli, "function");
    assertEquals(typeof mod.createDurableRunTokenGrowthCanaryCase, "function");
    assertEquals(typeof mod.evaluateRuntimeConfidenceEnv, "function");
    assertEquals(typeof runLiveEvalCli, "function");
    assertEquals(typeof runDurableRunCanaryCli, "function");
    assertEquals(typeof createDurableRunTokenGrowthCanaryCase, "function");
    assertEquals(typeof evaluateRuntimeConfidenceEnv, "function");
  });

  it("builds a two-turn durable token-growth canary", async () => {
    const testCase = createDurableRunTokenGrowthCanaryCase({
      conversationId: "11111111-1111-4111-8111-111111111111",
      marker: "TOKEN_GROWTH_TEST_MARKER",
    });

    const prepared = await testCase.prepare();

    assertEquals(testCase.id, "durable-token-growth-follow-up");
    assertEquals(prepared.conversationId, "11111111-1111-4111-8111-111111111111");
    assertStringIncludes(prepared.prompt, "TOKEN_GROWTH_TEST_MARKER");
    assertStringIncludes(prepared.followUpPrompt ?? "", "TOKEN_GROWTH_TEST_MARKER");
  });

  it("retains ordered run identities for a two-prompt durable canary", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const { apiClient, createdRunIds } = createCompletedDurableRunCanaryApiClient(conversationId);
    let validationExecutions: DurableRunCanaryExecution[] = [];
    const runner = createDurableRunCanaryRunner(
      {
        agentId: "veryfront",
        apiUrl: "https://api.example.test",
        authToken: "token",
        keepSuccessfulEvidence: false,
        projectId: "project_123",
        requestTimeoutMs: 1_000,
      },
      apiClient,
    );

    const result = await runner.runCase({
      id: "two-prompt",
      label: "Two prompt",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        followUpPrompt: "follow up",
        prompt: "initial",
        title: "Two prompt",
        validate: ({ executions }) => {
          validationExecutions = executions;
        },
      }),
    });

    assertEquals(createdRunIds.length, 2);
    assertEquals(result.runIds, createdRunIds);
    assertEquals(validationExecutions.map(({ runId }) => runId), createdRunIds);
    assertEquals(result.runId, createdRunIds[1]);
  });

  it("identifies durable canary runs as the trusted Studio client", async () => {
    let requestBody: unknown;
    const client = createDurableRunCanaryApiClient({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      projectId: "11111111-1111-4111-8111-111111111111",
      model: "anthropic/claude-sonnet-4-6",
      requestTimeoutMs: 1_000,
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({});
      },
    });

    await client.startDurableRun({
      conversationId: "11111111-1111-4111-8111-111111111111",
      runId: "run_studio_client",
      messageId: "22222222-2222-4222-8222-222222222222",
      prompt: "Exercise Studio-capable durable tools",
      userMessageId: "33333333-3333-4333-8333-333333333333",
    });

    assertEquals(requestBody, {
      kind: "agent",
      owner: {
        kind: "conversation",
        id: "11111111-1111-4111-8111-111111111111",
      },
      public_id: "run_studio_client",
      request: {
        mode: "agent",
        agent_id: "veryfront",
        input: {
          messages: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              role: "user",
              parts: [{ type: "text", text: "Exercise Studio-capable durable tools" }],
            },
          ],
          context: {
            conversation_id: "11111111-1111-4111-8111-111111111111",
            project_id: "11111111-1111-4111-8111-111111111111",
            branch_id: null,
          },
          durable_root_run: {
            run_id: "run_studio_client",
            message_id: "22222222-2222-4222-8222-222222222222",
          },
          forwarded_props: {
            model: "anthropic/claude-sonnet-4-6",
            veryfront: {
              client: {
                id: "veryfront-studio",
                type: "web",
                platform: "durable-canary",
              },
            },
          },
        },
      },
    });
  });

  it("reports exactly one run identity for a one-prompt durable canary", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const { apiClient, createdRunIds } = createCompletedDurableRunCanaryApiClient(conversationId);
    let validationRunIds: string[] = [];
    const runner = createDurableRunCanaryRunner(
      {
        agentId: "veryfront",
        apiUrl: "https://api.example.test",
        authToken: "token",
        keepSuccessfulEvidence: false,
        projectId: "project_123",
        requestTimeoutMs: 1_000,
      },
      apiClient,
    );

    const result = await runner.runCase({
      id: "one-prompt",
      label: "One prompt",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        prompt: "initial",
        title: "One prompt",
        validate: ({ executions }) => {
          validationRunIds = executions.map(({ runId }) => runId);
        },
      }),
    });

    assertEquals(createdRunIds.length, 1);
    assertEquals(result.runIds, createdRunIds);
    assertEquals(validationRunIds, createdRunIds);
    assertEquals(result.runId, createdRunIds[0]);
  });

  it("retains the created initial run identity when starting it fails", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const { apiClient, createdRunIds } = createCompletedDurableRunCanaryApiClient(
      conversationId,
      { failStartPrompt: "initial" },
    );
    const runner = createDurableRunCanaryRunner(
      {
        agentId: "veryfront",
        apiUrl: "https://api.example.test",
        authToken: "token",
        keepSuccessfulEvidence: false,
        projectId: "project_123",
        requestTimeoutMs: 1_000,
      },
      apiClient,
    );

    const result = await runner.runCase({
      id: "initial-start-failure",
      label: "Initial start failure",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        prompt: "initial",
        title: "Initial start failure",
        validate: () => {
          throw new Error("validation must not run");
        },
      }),
    });

    assertEquals(createdRunIds.length, 1);
    assertEquals(result.runIds, createdRunIds);
    assertStringIncludes(result.details, "failed to start initial");
  });

  it("retains the created follow-up run identity when starting it fails", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const { apiClient, createdRunIds } = createCompletedDurableRunCanaryApiClient(
      conversationId,
      { failStartPrompt: "follow up" },
    );
    const runner = createDurableRunCanaryRunner(
      {
        agentId: "veryfront",
        apiUrl: "https://api.example.test",
        authToken: "token",
        keepSuccessfulEvidence: false,
        projectId: "project_123",
        requestTimeoutMs: 1_000,
      },
      apiClient,
    );

    const result = await runner.runCase({
      id: "follow-up-start-failure",
      label: "Follow-up start failure",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        followUpPrompt: "follow up",
        prompt: "initial",
        title: "Follow-up start failure",
        validate: () => {
          throw new Error("validation must not run");
        },
      }),
    });

    assertEquals(createdRunIds.length, 2);
    assertEquals(result.runIds, createdRunIds);
    assertStringIncludes(result.details, "failed to start follow up");
  });

  it("fails a follow-up durable canary when its setup run fails", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const createdRunIds: string[] = [];
    const startRunInputs: Array<{ prompt: string; runId: string }> = [];

    function createRunSummary(
      runId: string,
      status: DurableRunCanaryRunSummary["status"],
    ): DurableRunCanaryRunSummary {
      return {
        runId,
        conversationId,
        messageId: "22222222-2222-4222-8222-222222222222",
        agentId: "veryfront",
        status,
        latestEventId: 1,
        latestExternalEventSequence: null,
        waitingToolCallId: null,
        waitingToolName: null,
        terminalErrorCode: status === "failed" ? "setup_failed" : null,
        terminalErrorMessage: status === "failed" ? "setup failed" : null,
        startedAt: "2026-07-05T19:00:00.000Z",
        finishedAt: "2026-07-05T19:00:01.000Z",
      };
    }

    const apiClient: DurableRunCanaryApiClient = {
      createDurableRootRun: async ({ runId }) => {
        createdRunIds.push(runId);
      },
      getRunSummary: async ({ runId }) =>
        createRunSummary(runId, createdRunIds[0] === runId ? "failed" : "completed"),
      listMessagesForCanary: async () => [],
      sendUserMessageForCanary: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        role: "user",
        parts: [],
      }),
      startDurableRun: async (input) => {
        startRunInputs.push({ prompt: input.prompt, runId: input.runId });
      },
    };

    const runner = createDurableRunCanaryRunner(
      {
        agentId: "veryfront",
        apiUrl: "https://api.example.test",
        authToken: "token",
        keepSuccessfulEvidence: false,
        projectId: "project_123",
        requestTimeoutMs: 1_000,
      },
      apiClient,
    );

    const result = await runner.runCase({
      id: "setup-failure",
      label: "Setup failure",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        followUpPrompt: "follow up",
        prompt: "setup",
        title: "Setup failure",
        validate: ({ run }) => {
          assertEquals(run.status, "completed");
        },
      }),
    });

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "setup failed");
    assertEquals(startRunInputs.map((input) => input.prompt), ["setup"]);
  });

  it("does not revive the legacy agent testing import path", async () => {
    await assertRejects(
      () => import("veryfront/agent/testing"),
      TypeError,
      "Unknown export",
    );
  });
});
