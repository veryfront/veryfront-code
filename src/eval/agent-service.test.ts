import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgUiRequestSchema } from "veryfront/agent";
import { datasets, evalAgent, metrics, runEval } from "veryfront/eval";
import {
  buildAgentServiceEvalRequestBody,
  createAgentServiceEvalAdapter,
  createLiveEvalCaseSupport,
  evaluateAgentServiceEvalEnvironment,
  evaluateRuntimeConfidenceEnv,
  resolveAgentServiceEvalEnvironment,
  runDurableRunCanaryCli,
  runLiveEvalCli,
} from "veryfront/eval/agent-service";

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
      agentId: "veryfront",
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
                providerCostUsd: 0.001,
                veryfrontChargeUsd: 0.0025,
                costCredits: 0.025,
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
        agentId: "veryfront",
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
      providerCostUsd: 0.001,
      veryfrontChargeUsd: 0.0025,
      costCredits: 0.025,
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
      providerCostUsd: 0.001,
      veryfrontChargeUsd: 0.0025,
      costCredits: 0.025,
      costSource: "gateway",
      cacheReadInputTokens: 3,
      cachedInputTokens: 3,
      reasoningTokens: 2,
      usageCaptureStatus: "complete",
    });
    assertEquals(record.durationMs, 0);
    assertStringIncludes(JSON.stringify(record.trace.events), "RUN_FINISHED");
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
    assertEquals(typeof mod.evaluateRuntimeConfidenceEnv, "function");
    assertEquals(typeof runLiveEvalCli, "function");
    assertEquals(typeof runDurableRunCanaryCli, "function");
    assertEquals(typeof evaluateRuntimeConfidenceEnv, "function");
  });

  it("does not revive the legacy agent testing import path", async () => {
    await assertRejects(
      () => import("veryfront/agent/testing"),
      TypeError,
      "Unknown export",
    );
  });
});
