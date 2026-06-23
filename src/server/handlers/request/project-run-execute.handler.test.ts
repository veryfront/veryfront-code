import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent } from "#veryfront/agent";
import type { Message } from "#veryfront/agent/types.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { createAgentServiceEvalAdapter } from "#veryfront/eval/agent-service.ts";
import { runEval as runEvalDefinition } from "#veryfront/eval/runner.ts";
import { datasets, evalAgent, type EvalReport, metrics } from "veryfront/eval";
import {
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
} from "./project-run-execute.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";

const encoder = new TextEncoder();

function encodeDataStreamEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function createStreamingAgent(id: string, text: string): Agent {
  let capturedMessages: Message[] = [];

  return {
    id,
    config: {
      id,
      system: "Answer directly.",
      model: "anthropic/claude-sonnet-4-6",
    } as Agent["config"],
    generate: async () => {
      throw new Error("not used");
    },
    stream: async (input) => {
      capturedMessages = input.messages ?? [];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encodeDataStreamEvent({ type: "message-start", messageId: "msg-1" }));
          controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
          controller.enqueue(
            encodeDataStreamEvent({ type: "text-delta", id: "text-1", delta: text }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
          controller.close();
        },
      });

      return {
        toDataStreamResponse: () =>
          new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
      };
    },
    respond: async () => new Response("not used"),
    getMemory: () => {
      throw new Error("not used");
    },
    getMemoryStats: async () => ({
      totalMessages: capturedMessages.length,
      estimatedTokens: 0,
      type: "conversation",
    }),
    clearMemory: async () => {
      capturedMessages = [];
    },
  };
}

function createDeps(
  overrides: Partial<ProjectRunExecuteHandlerDeps> = {},
): ProjectRunExecuteHandlerDeps {
  return {
    findTaskById: async (target) =>
      target === "sync-calendar-events"
        ? {
          id: "sync-calendar-events",
          name: "Sync calendar events",
          filePath: "tasks/sync-calendar-events.ts",
          exportName: "default",
          definition: { name: "Sync calendar events", run: async () => ({ ok: true }) },
        }
        : null,
    runTask: async (_options) => ({
      success: true,
      result: { synced: 12 },
      durationMs: 42,
    }),
    findWorkflowById: async (target) =>
      target === "publish"
        ? {
          id: "publish",
          filePath: "workflows/publish.ts",
          exportName: "default",
          definition: { id: "publish", steps: [] },
        }
        : null,
    findEvalById: async (target) =>
      target === "eval:deep-research"
        ? {
          id: "eval:deep-research",
          name: "Deep research quality",
          filePath: "evals/deep-research.eval.ts",
          exportName: "default",
          definition: evalAgent({
            id: "eval:deep-research",
            target: "agent:researcher",
            dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
          }),
        }
        : null,
    createWorkflowClient: () => ({
      register: () => {},
      start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
        runId: options?.runId ?? "workflow-run",
      }),
      getRun: async () => ({
        status: "completed",
        output: { deployed: true },
      }),
      destroy: async () => {},
    }),
    runEval: async (definition, options) => ({
      kind: "eval-report",
      runId: options.runId ?? "eval-run",
      definitionId: definition.id,
      targetKind: definition.targetKind,
      target: definition.target,
      startedAt: "2026-06-20T10:00:00.000Z",
      endedAt: "2026-06-20T10:00:01.000Z",
      summary: { records: 1, passed: 1, failed: 0, passRate: 1, metrics: [] },
      records: [],
    }),
    createEvalAgentAdapter: () => async () => ({ text: "Paris" }),
    uploadEvalReport: async () => null,
    executeKnowledgeIngest: async () => ({
      success: true,
      result: { kind: "knowledge_ingest", summary: { ingested_count: 1 } },
      logs: "knowledge ingest completed",
      duration_ms: 51,
    }),
    executeReleaseAssetBuild: async () => ({
      success: true,
      result: { state: "ready", moduleCount: 0, cssCount: 0, routeCount: 0 },
      logs: null,
      duration_ms: 10,
    }),
    ensureProjectDiscovery: async () => {},
    sleep: async () => {},
    now: () => 0,
    ...overrides,
  };
}

async function signedRequest(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  origin = "https://example.com",
): Promise<{ request: Request; publicKeyPem: string }> {
  const rawBody = JSON.stringify(body);
  const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
    requestId: String(body.runId),
    projectId: String(body.projectId),
  });

  return {
    publicKeyPem,
    request: new Request(`${origin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-veryfront-control-plane-jws": jws,
        ...headers,
      },
      body: rawBody,
    }),
  };
}

async function withEnvValue<T>(
  key: string,
  value: string,
  fn: () => Promise<T>,
): Promise<T> {
  const original = Deno.env.get(key);
  Deno.env.set(key, value);
  try {
    return await fn();
  } finally {
    if (original === undefined) Deno.env.delete(key);
    else Deno.env.set(key, original);
  }
}

describe("server/handlers/request/project-run-execute.handler", () => {
  it("runs a discovered task and returns canonical runtime execution output", async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async (options) => {
        receivedConfig = options.config;
        return {
          success: true,
          result: { synced: 12 },
          durationMs: 42,
        };
      },
    }));
    const body = {
      runId: "run_task_1",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      config: { dry_run: true },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { synced: 12 },
      duration_ms: 42,
      logs: null,
    });
    assertEquals(receivedConfig, { dry_run: true });
  });

  it("dispatches built-in knowledge ingest runs through the reusable ingest executor", async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      executeKnowledgeIngest: async (input) => {
        receivedConfig = input.request.config;
        return {
          success: true,
          result: { kind: "knowledge_ingest", summary: { ingested_count: 1 } },
          logs: "knowledge ingest completed",
          duration_ms: 51,
        };
      },
    }));
    const body = {
      runId: "run_knowledge_1",
      kind: "task",
      target: "task:knowledge-ingest",
      projectId: "proj-1",
      config: { upload_ids: ["upload-1"] },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_knowledge_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { kind: "knowledge_ingest", summary: { ingested_count: 1 } },
      logs: "knowledge ingest completed",
      duration_ms: 51,
    });
    assertEquals(receivedConfig, { upload_ids: ["upload-1"] });
  });

  it("runs a discovered workflow with the canonical run id and input", async () => {
    let started:
      | { workflowId: string; input: unknown; options?: { runId?: string } }
      | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        register: () => {},
        start: async (workflowId: string, input: unknown, options?: { runId?: string }) => {
          started = { workflowId, input, options };
          return { runId: options?.runId ?? "workflow-run" };
        },
        getRun: async () => ({
          status: "completed",
          output: { deployed: true },
        }),
        destroy: async () => {},
      }),
    }));
    const body = {
      runId: "run_workflow_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: "v1" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { deployed: true },
      duration_ms: 0,
      logs: null,
    });
    assertEquals(started, {
      workflowId: "publish",
      input: { release: "v1" },
      options: { runId: "run_workflow_1" },
    });
  });

  it("runs a discovered eval with the canonical run id and local routed AG-UI adapter endpoint", async () => {
    const report: EvalReport = {
      kind: "eval-report",
      runId: "run_eval_1",
      definitionId: "eval:deep-research",
      targetKind: "agent",
      target: "agent:researcher",
      startedAt: "2026-06-20T10:00:00.000Z",
      endedAt: "2026-06-20T10:00:01.000Z",
      summary: { records: 1, passed: 1, failed: 0, passRate: 1, metrics: [] },
      records: [],
    };
    let receivedRunId: string | undefined;
    let receivedBaseDir: string | undefined;
    let receivedEndpoint: string | undefined;
    let receivedAuthToken: string | undefined;
    let receivedAgentId: string | null | undefined;
    let receivedProjectSlug: string | null | undefined;
    let receivedForwardedHost: unknown;
    let receivedForwardedProto: unknown;
    let receivedEnvironment: unknown;
    let receivedEnvironmentId: unknown;
    let receivedProjectIdHeader: unknown;
    let receivedBranchName: unknown;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runEval: async (_definition, options) => {
        receivedRunId = options.runId;
        receivedBaseDir = options.baseDir;
        return report;
      },
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        receivedAuthToken = config.authToken;
        receivedAgentId = config.agentId;
        receivedProjectSlug = (config as { projectSlug?: string | null }).projectSlug;
        receivedForwardedHost = config.forwardedHost;
        receivedForwardedProto = config.forwardedProto;
        receivedEnvironment = config.environment;
        receivedEnvironmentId = config.environmentId;
        receivedProjectIdHeader = config.projectId;
        receivedBranchName = config.branchName;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_1",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
      input: { dataset: "smoke" },
      config: { repetitions: 2 },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_1/execute",
      body,
      {
        "x-token": "runtime-token",
        "x-forwarded-host": "demo-project.preview.veryfront.org",
        "x-forwarded-proto": "https",
        "x-environment": "preview",
        "x-environment-id": "env-1",
        "x-branch-name": "main",
      },
    );

    const result = await withEnvValue(
      "PORT",
      "4311",
      () => handler.handle(request, createCtx(publicKeyPem)),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: report,
      duration_ms: 0,
      logs: null,
    });
    assertEquals(receivedRunId, "run_eval_1");
    assertEquals(receivedBaseDir, "/project");
    assertEquals(receivedEndpoint, "http://127.0.0.1:4311/api/ag-ui");
    assertEquals(receivedAuthToken, "runtime-token");
    assertEquals(receivedAgentId, "researcher");
    assertEquals(receivedProjectSlug, "demo-project");
    assertEquals(receivedForwardedHost, "demo-project.preview.veryfront.org");
    assertEquals(receivedForwardedProto, "https");
    assertEquals(receivedEnvironment, "preview");
    assertEquals(receivedEnvironmentId, "env-1");
    assertEquals(receivedProjectIdHeader, "proj-1");
    assertEquals(receivedBranchName, "main");
  });

  it("returns an eval report artifact path when report upload succeeds", async () => {
    const report: EvalReport = {
      kind: "eval-report",
      runId: "run_eval_report_artifact",
      definitionId: "eval:deep-research",
      targetKind: "agent",
      target: "agent:researcher",
      startedAt: "2026-06-20T10:00:00.000Z",
      endedAt: "2026-06-20T10:00:01.000Z",
      summary: { records: 1, passed: 1, failed: 0, passRate: 1, metrics: [] },
      records: [],
    };
    const reportPath = "evals/reports/deep-research/run_eval_report_artifact.json";
    let receivedReport: EvalReport | undefined;
    let receivedProjectReference: string | undefined;
    let receivedReportPath: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runEval: async () => report,
      uploadEvalReport: async (input) => {
        receivedReport = input.report;
        receivedProjectReference = input.projectReference;
        receivedReportPath = input.reportPath;
        return input.reportPath;
      },
    }));
    const body = {
      runId: "run_eval_report_artifact",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_report_artifact/execute",
      body,
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { ...report, reportPath },
      artifacts: [{ kind: "eval-report", path: reportPath, contentType: "application/json" }],
      duration_ms: 0,
      logs: null,
    });
    assertEquals(receivedReport, report);
    assertEquals(receivedProjectReference, "demo-project");
    assertEquals(receivedReportPath, reportPath);
  });

  it("uses the local AG-UI adapter endpoint when the runtime endpoint is local", async () => {
    let receivedEndpoint: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_local_endpoint",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "http://localhost:4311/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_local_endpoint/execute",
      body,
      {
        "x-token": "runtime-token",
        "x-forwarded-host": "localhost:4311",
        "x-forwarded-proto": "http",
      },
      "http://localhost:4311",
    );

    const result = await withEnvValue(
      "PORT",
      "4311",
      () => handler.handle(request, createCtx(publicKeyPem)),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(receivedEndpoint, "http://127.0.0.1:4311/api/ag-ui");
  });

  it("runs localized eval AG-UI requests through discovered source agents", async () => {
    agentRegistry.register("researcher", createStreamingAgent("researcher", "Paris"));
    const handler = new ProjectRunExecuteHandler(createDeps({
      findEvalById: async (target) =>
        target === "eval:deep-research"
          ? {
            id: "eval:deep-research",
            name: "Deep research quality",
            filePath: "evals/deep-research.eval.ts",
            exportName: "default",
            definition: evalAgent({
              id: "eval:deep-research",
              target: "agent:researcher",
              dataset: datasets.inline([
                { id: "q1", input: "France capital?", reference: "Paris" },
              ]),
              metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
            }),
          }
          : null,
      runEval: runEvalDefinition,
      createEvalAgentAdapter: (config) =>
        createAgentServiceEvalAdapter({ ...config, requestTimeoutMs: 250 }),
    }));
    const body = {
      runId: "run_eval_source_agent",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_source_agent/execute",
      body,
      { "x-token": "runtime-token" },
      "https://veryfront.org",
    );

    try {
      const result = await withEnvValue(
        "PORT",
        "4311",
        () => handler.handle(request, createCtx(publicKeyPem)),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const payload = await result.response.json();
      assertEquals(payload.success, true);
      assertEquals(payload.error, undefined);
      assertEquals(payload.result.summary.failed, 0);
      assertStringIncludes(JSON.stringify(payload.result.records[0]?.output), "Paris");
    } finally {
      agentRegistry.delete("researcher");
    }
  });

  it("forwards managed AG-UI endpoint host context when localizing from a generic control-plane host", async () => {
    let receivedEndpoint: string | undefined;
    let receivedForwardedHost: unknown;
    let receivedForwardedProto: unknown;
    let receivedEnvironment: unknown;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        receivedForwardedHost = config.forwardedHost;
        receivedForwardedProto = config.forwardedProto;
        receivedEnvironment = config.environment;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_generic_control_host",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_generic_control_host/execute",
      body,
      {
        "x-token": "runtime-token",
        "x-forwarded-host": "veryfront.org",
        "x-forwarded-proto": "https",
      },
      "https://veryfront.org",
    );

    const result = await withEnvValue(
      "PORT",
      "4311",
      () => handler.handle(request, createCtx(publicKeyPem)),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(receivedEndpoint, "http://127.0.0.1:4311/api/ag-ui");
    assertEquals(receivedForwardedHost, "demo-project.preview.veryfront.org");
    assertEquals(receivedForwardedProto, "https");
    assertEquals(receivedEnvironment, "preview");
  });

  it("preserves non-sibling eval AG-UI endpoints", async () => {
    let receivedEndpoint: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_custom_endpoint",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://agent-service.example.com/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_custom_endpoint/execute",
      body,
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(receivedEndpoint, "https://agent-service.example.com/api/ag-ui");
  });

  it("uses local AG-UI endpoints for managed preview URLs when control-plane requests use an internal runtime host", async () => {
    let receivedEndpoint: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_internal_host",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_internal_host/execute",
      body,
      { "x-token": "runtime-token" },
      "http://veryfront-server",
    );

    const result = await withEnvValue(
      "PORT",
      "4311",
      () => handler.handle(request, createCtx(publicKeyPem)),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(receivedEndpoint, "http://127.0.0.1:4311/api/ag-ui");
  });

  it("marks eval execution unsuccessful when records contain adapter failures", async () => {
    const report: EvalReport = {
      kind: "eval-report",
      runId: "run_eval_failed_adapter",
      definitionId: "eval:deep-research",
      targetKind: "agent",
      target: "agent:researcher",
      startedAt: "2026-06-20T10:00:00.000Z",
      endedAt: "2026-06-20T10:00:01.000Z",
      summary: { records: 1, passed: 1, failed: 0, passRate: 1, metrics: [] },
      records: [{
        id: "q1:1",
        evalId: "eval:deep-research",
        exampleId: "q1",
        repetition: 1,
        input: "France capital?",
        output: { text: "" },
        metadata: {},
        trace: { events: [], toolCalls: [] },
        usage: {},
        durationMs: 10,
        completed: false,
        error: "AG-UI request failed",
        metrics: [],
        checks: [],
      }],
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      runEval: async () => report,
    }));
    const body = {
      runId: "run_eval_failed_adapter",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_failed_adapter/execute",
      body,
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: false,
      result: report,
      error: "1 eval record failed",
      logs: null,
      duration_ms: 0,
    });
  });

  it("discovers project agents and tools before starting workflow agent steps", async () => {
    const order: string[] = [];
    let hasAgentRegistry = false;
    let hasToolRegistry = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        order.push("discover");
      },
      createWorkflowClient: (config) => {
        hasAgentRegistry = typeof config?.executor?.stepExecutor?.agentRegistry?.get ===
          "function";
        hasToolRegistry = typeof config?.executor?.stepExecutor?.toolRegistry?.get ===
          "function";
        order.push("create-client");
        return {
          register: () => {},
          start: async (
            _workflowId: string,
            _input: unknown,
            options?: { runId?: string },
          ) => {
            order.push("start");
            return { runId: options?.runId ?? "workflow-run" };
          },
          getRun: async () => ({
            status: "completed",
            output: { agent: "ok" },
          }),
          destroy: async () => {},
        };
      },
    }));
    const body = {
      runId: "run_workflow_agent_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: "v1" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_agent_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { agent: "ok" },
      duration_ms: 0,
      logs: null,
    });
    assertEquals(hasAgentRegistry, true);
    assertEquals(hasToolRegistry, true);
    assertEquals(order, ["discover", "create-client", "start"]);
  });

  it("waits for async workflow finalization before destroying the workflow client", async () => {
    const order: string[] = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
          settled: async () => {
            order.push("settled");
          },
        }),
        getRun: async () => ({
          status: "failed",
          error: { message: "step failed" },
        }),
        destroy: async () => {
          order.push("destroy");
        },
      }),
    }));
    const body = {
      runId: "run_workflow_failed_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: "v1" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_failed_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: false,
      error: "step failed",
      logs: null,
      duration_ms: 0,
    });
    assertEquals(order, ["settled", "destroy"]);
  });

  it("treats waiting workflow runs as successful pause boundaries", async () => {
    let destroyed = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
        }),
        getRun: async () => ({
          status: "waiting",
          output: { approvalId: "approval-1" },
        }),
        destroy: async () => {
          destroyed = true;
        },
      }),
    }));
    const body = {
      runId: "run_workflow_waiting_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: "v1" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_waiting_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { approvalId: "approval-1" },
      duration_ms: 0,
      logs: null,
    });
    assertEquals(destroyed, true);
  });

  it("does not report waiting workflow runs as successful without durable workflow state", async () => {
    let destroyed = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "ephemeral",
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
        }),
        getRun: async () => ({
          status: "waiting",
          output: { approvalId: "approval-1" },
        }),
        destroy: async () => {
          destroyed = true;
        },
      }),
    }));
    const body = {
      runId: "run_workflow_waiting_ephemeral_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: "v1" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_waiting_ephemeral_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: false,
      error: "Workflow paused but runtime workflow persistence is not configured",
      duration_ms: 0,
      logs: null,
    });
    assertEquals(destroyed, true);
  });

  it("rejects unsigned execute requests", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps());

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/execute", {
        method: "POST",
        body: JSON.stringify({
          runId: "run_1",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
        }),
      }),
      createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Missing control-plane signature" });
  });
});
