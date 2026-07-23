import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent } from "#veryfront/agent";
import type { Message } from "#veryfront/agent/types.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import type { DiscoveryResult } from "#veryfront/discovery";
import type { HandlerContext } from "#veryfront/types";
import { createAgentServiceEvalAdapter } from "#veryfront/eval/agent-service.ts";
import { runEval as runEvalDefinition } from "#veryfront/eval/runner.ts";
import { datasets, evalAgent, type EvalReport, metrics } from "veryfront/eval";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { toolRegistry } from "#veryfront/tool";
import {
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
} from "./project-run-execute.handler.ts";
import {
  type ControlPlaneTestSigningKey,
  createControlPlaneSignature,
  createControlPlaneTestSigningKey,
  createCtx,
} from "./internal-agent-run.test-helpers.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { getTailwindCSSUrl } from "#veryfront/utils/constants/cdn.ts";
import { __resetServerShuttingDownForTests, markServerShuttingDown } from "../../shutdown-state.ts";

const encoder = new TextEncoder();

function encodeDataStreamEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function createStreamingAgent(
  id: string,
  text: string,
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number },
): Agent {
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
          input.onFinish?.({
            text,
            messages: [],
            toolCalls: [],
            status: "completed",
            ...(usage ? { usage } : {}),
          });
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
    executeIsolatedProjectRun: async () => {
      throw new Error("Unexpected remote project-run isolation call in local-path test");
    },
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
    executeStyleArtifactBuild: async () => ({
      success: true,
      result: {
        state: "ready",
        artifactHash: "hash-1",
        assetPath: "/_vf/css/hash-1.css",
      },
      logs: null,
      duration_ms: 12,
    }),
    ensureProjectDiscovery: async () => {
      const discovery = createEmptyDiscoveryResult();
      discovery.tasks.set("sync-calendar-events", {
        name: "Sync calendar events",
        run: async () => ({ ok: true }),
      });
      return discovery;
    },
    sleep: async () => {},
    now: () => 0,
    ...overrides,
  };
}

function createLocalCtx(publicKeyPem?: string): HandlerContext {
  const ctx = createCtx(publicKeyPem);
  ctx.isLocalProject = true;
  return ctx;
}

function createEmptyDiscoveryResult(): DiscoveryResult {
  return {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors: [],
  };
}

function requestJsonBody(init: RequestInit | undefined): Record<string, unknown> | null {
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) as Record<string, unknown> : null;
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

async function signedRequestWithKey(
  path: string,
  body: Record<string, unknown>,
  signingKey: ControlPlaneTestSigningKey,
): Promise<Request> {
  const rawBody = JSON.stringify(body);
  const { jws } = await createControlPlaneSignature(
    rawBody,
    {
      requestId: String(body.runId),
      projectId: String(body.projectId),
    },
    signingKey,
  );
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-veryfront-control-plane-jws": jws,
    },
    body: rawBody,
  });
}

function createStyleArtifactCtx(
  publicKeyPem: string,
  options: {
    files: Array<{ path: string; content?: string }>;
    stylesheet?: string;
    stylesheetPath?: string;
    contentContext?: {
      sourceType: "branch" | "environment" | "release";
      projectSlug: string;
      branch?: string;
      environmentName?: string;
      releaseId?: string;
    };
  },
): { ctx: HandlerContext; readCalls: string[]; sourceFileCalls: { count: number } } {
  const ctx = createCtx(publicKeyPem);
  const readCalls: string[] = [];
  const sourceFileCalls = { count: 0 };
  const stylesheetPath = options.stylesheetPath ?? "src/styles.css";
  const underlyingAdapter = {
    async getAllSourceFiles() {
      sourceFileCalls.count++;
      return options.files;
    },
    getContentContext() {
      return options.contentContext ?? {
        sourceType: "environment" as const,
        projectSlug: "demo-project",
        environmentName: "Preview",
      };
    },
  };

  ctx.projectDir = "/unrelated-runtime-dir";
  ctx.config = { tailwind: { stylesheet: stylesheetPath } };
  ctx.environmentName = "Preview";
  ctx.adapter = ({
    ...ctx.adapter,
    fs: {
      getUnderlyingAdapter: () => underlyingAdapter,
      async readFile(path: string) {
        readCalls.push(path);
        if (path === stylesheetPath && options.stylesheet !== undefined) {
          return options.stylesheet;
        }
        throw new Error(`Missing test file: ${path}`);
      },
    },
  } as unknown) as HandlerContext["adapter"];

  return { ctx, readCalls, sourceFileCalls };
}

function createStyleArtifactFetchRecorder(): {
  upserts: Record<string, unknown>[];
  fetch: typeof fetch;
} {
  const upserts: Record<string, unknown>[] = [];

  return {
    upserts,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
        ? input.url
        : input.toString();
      if (url === getTailwindCSSUrl()) {
        return Promise.resolve(
          new Response("@layer theme, base, components, utilities;", {
            status: 200,
            headers: { "Content-Type": "text/css; charset=utf-8" },
          }),
        );
      }
      if (url.endsWith("/projects/demo-project/style-artifacts/current")) {
        const body = requestJsonBody(init) ?? {};
        upserts.push(body);
        const artifactHash = typeof body.artifact_hash === "string"
          ? body.artifact_hash
          : undefined;

        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: body.status === "failed" ? "failed" : "ready",
              ...(artifactHash ? { artifact_hash: artifactHash } : {}),
              asset_path: artifactHash ? `/_vf/css/${artifactHash}.css` : undefined,
              content_type: "text/css; charset=utf-8",
              etag: artifactHash ? `"${artifactHash}"` : undefined,
              failure_reason: body.failure_reason,
              updated_at: "2026-07-08T00:00:00.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.resolve(new Response("Not found", { status: 404, statusText: "Not Found" }));
    }) as typeof fetch,
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
  afterAll(async () => {
    await stopEsbuild();
  });

  it("runs a discovered task and returns canonical runtime execution output", async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    let receivedEnvironmentId: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async (options) => {
        receivedConfig = options.config;
        receivedEnvironmentId = options.environmentId;
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
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "11111111-1111-4111-8111-111111111111",
      config: { dry_run: true },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_1/execute",
      body,
    );

    const result = await handler.handle(request, createLocalCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { synced: 12 },
      duration_ms: 42,
      logs: null,
    });
    assertEquals(receivedConfig, { dry_run: true });
    assertEquals(receivedEnvironmentId, "11111111-1111-4111-8111-111111111111");
  });

  it("preserves explicit null runtime environment targets", async () => {
    let receivedEnvironmentId: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async (options) => {
        receivedEnvironmentId = options.environmentId;
        return {
          success: true,
          result: { synced: 12 },
          durationMs: 42,
        };
      },
    }));
    const body = {
      runId: "run_task_main",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      runtimeTargetKind: "main_branch",
      runtimeTargetEnvironmentId: null,
      config: {},
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_main/execute",
      body,
    );
    const ctx = {
      ...createCtx(publicKeyPem),
      environmentId: "22222222-2222-4222-8222-222222222222",
      isLocalProject: true,
    } as HandlerContext;

    const result = await handler.handle(request, ctx);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(receivedEnvironmentId, undefined);
  });

  it("runs cloud task targets from project runtime discovery", async () => {
    const order: string[] = [];
    const discovery = createEmptyDiscoveryResult();
    discovery.tasks.set("sync-calendar-events", {
      name: "Sync calendar events",
      run: async () => ({ ok: true }),
    });

    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        order.push("discover");
        return discovery;
      },
      runTask: async (options) => {
        order.push(`run:${options.task.id}`);
        return {
          success: true,
          result: { synced: 12 },
          durationMs: 42,
        };
      },
    }));
    const body = {
      runId: "run_task_runtime_1",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      config: { dry_run: true },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_runtime_1/execute",
      body,
    );

    const result = await handler.handle(request, createLocalCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { synced: 12 },
      duration_ms: 42,
      logs: null,
    });
    assertEquals(order, ["discover", "run:sync-calendar-events"]);
  });

  it("routes remote project tasks to isolation without host discovery or execution", async () => {
    let discoveryCalls = 0;
    let hostTaskCalls = 0;
    let isolatedCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        discoveryCalls++;
        throw new Error("host discovery must not run");
      },
      runTask: async () => {
        hostTaskCalls++;
        throw new Error("host task execution must not run");
      },
      executeIsolatedProjectRun: async (input) => {
        isolatedCalls++;
        assertEquals(input.request.target, "task:sync-calendar-events");
        return {
          success: true,
          result: { isolated: true },
          durationMs: 7,
        };
      },
    }));
    const body = {
      runId: "run_task_isolated",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_isolated/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(await result.response.json(), {
      success: true,
      result: { isolated: true },
      duration_ms: 7,
      logs: null,
    });
    assertEquals({ discoveryCalls, hostTaskCalls, isolatedCalls }, {
      discoveryCalls: 0,
      hostTaskCalls: 0,
      isolatedCalls: 1,
    });
  });

  it("sanitizes remote Worker diagnostics before returning or caching them", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      executeIsolatedProjectRun: async () => ({
        success: false,
        error: "task failed token=remote-secret-canary at file:///runtime/project/task.ts",
        durationMs: 2,
      }),
    }));
    const body = {
      runId: "run_task_remote_sensitive_error",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_remote_sensitive_error/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const responseText = await result.response.text();
    assertEquals(responseText.includes("remote-secret-canary"), false);
    assertEquals(responseText.includes("file:///runtime/project/task.ts"), false);
    assertStringIncludes(responseText, "token=[REDACTED]");
    assertStringIncludes(responseText, "<LOCAL_PATH>");
  });

  it("fails closed when remote project-run isolation is unavailable", async () => {
    let hostDiscoveryCalls = 0;
    let hostTaskCalls = 0;
    const deps = createDeps({
      ensureProjectDiscovery: async () => {
        hostDiscoveryCalls++;
        return createEmptyDiscoveryResult();
      },
      runTask: async () => {
        hostTaskCalls++;
        return { success: true, durationMs: 1 };
      },
    });
    delete (deps as Partial<ProjectRunExecuteHandlerDeps>).executeIsolatedProjectRun;
    const handler = new ProjectRunExecuteHandler(deps);
    const body = {
      runId: "run_task_isolation_unavailable",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_isolation_unavailable/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(await result.response.json(), {
      success: false,
      error: "Remote project run isolation is unavailable",
      logs: null,
      duration_ms: 0,
    });
    assertEquals({ hostDiscoveryCalls, hostTaskCalls }, {
      hostDiscoveryCalls: 0,
      hostTaskCalls: 0,
    });
  });

  it("keeps local project task execution on the local runtime path", async () => {
    let hostTaskCalls = 0;
    let isolatedCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        hostTaskCalls++;
        return { success: true, result: { local: true }, durationMs: 4 };
      },
      executeIsolatedProjectRun: async () => {
        isolatedCalls++;
        throw new Error("local tasks must not enter remote isolation");
      },
    }));
    const body = {
      runId: "run_task_local",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_local/execute",
      body,
    );
    const ctx = createLocalCtx(publicKeyPem);
    ctx.isLocalProject = true;

    const result = await handler.handle(request, ctx);

    assertExists(result.response);
    assertEquals((await result.response.json()).result, { local: true });
    assertEquals({ hostTaskCalls, isolatedCalls }, { hostTaskCalls: 1, isolatedCalls: 0 });
  });

  it("reports runtime discovery failures before task lookup", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        throw new Error("Runtime discovery failed: VFS unavailable");
      },
    }));
    const body = {
      runId: "run_task_discovery_failed",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_discovery_failed/execute",
      body,
    );

    const result = await handler.handle(request, createLocalCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: false,
      error: "Runtime discovery failed: VFS unavailable",
      logs: null,
      duration_ms: 0,
    });
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

  it("dispatches built-in style artifact builds through the reusable style executor", async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    let attemptedProjectDiscovery = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        attemptedProjectDiscovery = true;
        return createEmptyDiscoveryResult();
      },
      executeStyleArtifactBuild: async (input) => {
        receivedConfig = input.request.config;
        return {
          success: true,
          result: {
            state: "ready",
            artifactHash: "hash-1",
            assetPath: "/_vf/css/hash-1.css",
          },
          logs: null,
          duration_ms: 12,
        };
      },
    }));
    const body = {
      runId: "run_style_artifact_1",
      kind: "task",
      target: "task:style-artifact-build",
      projectId: "proj-1",
      config: { environment_name: "preview" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_style_artifact_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: {
        state: "ready",
        artifactHash: "hash-1",
        assetPath: "/_vf/css/hash-1.css",
      },
      logs: null,
      duration_ms: 12,
    });
    assertEquals(receivedConfig, { environment_name: "preview" });
    assertEquals(attemptedProjectDiscovery, false);
  });

  it("builds style artifacts from adapter source files and adapter stylesheet reads", async () => {
    const body = {
      runId: "run_style_artifact_adapter_source",
      kind: "task",
      target: "task:style-artifact-build",
      projectId: "proj-1",
      config: { environment_name: "Preview" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_style_artifact_adapter_source/execute",
      body,
      { "x-token": "test-token" },
    );
    const { ctx, readCalls, sourceFileCalls } = createStyleArtifactCtx(publicKeyPem, {
      files: [{
        path: "pages/index.tsx",
        content:
          'export default function Page() { return <main className="px-4 text-red-500">Hi</main>; }',
      }],
      stylesheet: "@tailwind utilities; .from-css { color: red; }",
      stylesheetPath: "src/styles.css",
    });
    const recorder = createStyleArtifactFetchRecorder();

    const result = await withMockFetch(
      recorder.fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, ctx),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const json = await result.response.json();
    assertEquals(json.success, true);
    assertEquals(sourceFileCalls.count, 1);
    assertEquals(readCalls, ["src/styles.css"]);
    assertEquals(recorder.upserts.length, 1);
    assertEquals(recorder.upserts[0]?.environment_name, "Preview");
    assertEquals(recorder.upserts[0]?.status, "ready");
    assertEquals(typeof recorder.upserts[0]?.artifact_hash, "string");
  });

  it("rejects mismatched style profile hashes before scanning source files", async () => {
    const body = {
      runId: "run_style_artifact_hash_mismatch",
      kind: "task",
      target: "task:style-artifact-build",
      projectId: "proj-1",
      config: {
        environment_name: "Preview",
        style_profile_hash: "queued-profile-hash",
      },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_style_artifact_hash_mismatch/execute",
      body,
      { "x-token": "test-token" },
    );
    const { ctx, sourceFileCalls } = createStyleArtifactCtx(publicKeyPem, {
      files: [{
        path: "pages/index.tsx",
        content: 'export default function Page() { return <main className="px-4">Hi</main>; }',
      }],
      stylesheet: "@tailwind utilities;",
    });
    const recorder = createStyleArtifactFetchRecorder();

    const result = await withMockFetch(
      recorder.fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, ctx),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const json = await result.response.json();
    assertEquals(json.success, false);
    assertStringIncludes(json.error, "Style profile hash mismatch");
    assertEquals(sourceFileCalls.count, 0);
    assertEquals(recorder.upserts.length, 1);
    assertEquals(recorder.upserts[0]?.style_profile_hash, "queued-profile-hash");
    assertEquals(recorder.upserts[0]?.status, "failed");
    assertStringIncludes(
      String(recorder.upserts[0]?.failure_reason),
      "Style profile hash mismatch",
    );
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

  it("routes explicitly remote workflows through the compatibility seam", async () => {
    let hostDiscoveryCalls = 0;
    let hostWorkflowLookupCalls = 0;
    let remoteWorkflowCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        hostDiscoveryCalls++;
        throw new Error("remote workflow must not enter host discovery when the seam is set");
      },
      findWorkflowById: async () => {
        hostWorkflowLookupCalls++;
        throw new Error("remote workflow must not enter host lookup when the seam is set");
      },
      executeRemoteWorkflow: async ({ request }) => {
        remoteWorkflowCalls++;
        assertEquals(request.target, "workflow:publish");
        return {
          success: true,
          result: { delegated: true },
          logs: null,
          duration_ms: 3,
        };
      },
    }));
    const body = {
      runId: "run_workflow_remote_seam",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_remote_seam/execute",
      body,
    );
    const ctx = createCtx(publicKeyPem);
    ctx.isLocalProject = false;

    const result = await handler.handle(request, ctx);

    assertExists(result.response);
    assertEquals(await result.response.json(), {
      success: true,
      result: { delegated: true },
      logs: null,
      duration_ms: 3,
    });
    assertEquals({ hostDiscoveryCalls, hostWorkflowLookupCalls, remoteWorkflowCalls }, {
      hostDiscoveryCalls: 0,
      hostWorkflowLookupCalls: 0,
      remoteWorkflowCalls: 1,
    });
  });

  it("routes remote eval modules to isolation and keeps the runtime endpoint public", async () => {
    let hostEvalDiscoveryCalls = 0;
    let hostEvalCalls = 0;
    let isolatedEndpoint: string | undefined;
    const report: EvalReport = {
      kind: "eval-report",
      runId: "run_eval_isolated",
      definitionId: "eval:deep-research",
      targetKind: "agent",
      target: "agent:researcher",
      startedAt: "2026-06-20T10:00:00.000Z",
      endedAt: "2026-06-20T10:00:01.000Z",
      summary: { records: 0, passed: 0, failed: 0, passRate: 1, metrics: [] },
      records: [],
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      findEvalById: async () => {
        hostEvalDiscoveryCalls++;
        throw new Error("host eval discovery must not run");
      },
      runEval: async () => {
        hostEvalCalls++;
        throw new Error("host eval execution must not run");
      },
      executeIsolatedProjectRun: async (input) => {
        isolatedEndpoint = input.evalAgentAdapter?.endpoint;
        return { success: true, result: report, durationMs: 12 };
      },
    }));
    const body = {
      runId: "run_eval_isolated",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_isolated/execute",
      body,
      { "x-token": "runtime-token" },
      "https://veryfront.org",
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, true);
    assertEquals(payload.result, report);
    assertEquals(isolatedEndpoint, "https://demo-project.preview.veryfront.org/api/ag-ui");
    assertEquals({ hostEvalDiscoveryCalls, hostEvalCalls }, {
      hostEvalDiscoveryCalls: 0,
      hostEvalCalls: 0,
    });
  });

  it("rejects loopback endpoints before remote eval isolation", async () => {
    let isolationCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      executeIsolatedProjectRun: async () => {
        isolationCalls++;
        return { success: true, durationMs: 1 };
      },
    }));
    const body = {
      runId: "run_eval_remote_loopback",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://localhost/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_remote_loopback/execute",
      body,
      { "x-token": "runtime-token" },
      "https://veryfront.org",
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(await result.response.json(), {
      success: false,
      error: "runtimeAgUiEndpoint must target a public project runtime",
      logs: null,
      duration_ms: 0,
    });
    assertEquals(isolationCalls, 0);
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
      () => handler.handle(request, createLocalCtx(publicKeyPem)),
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

    const result = await handler.handle(request, createLocalCtx(publicKeyPem));

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
    const receivedEndpoints: string[] = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      createEvalAgentAdapter: (config) => {
        if (config.endpoint) receivedEndpoints.push(config.endpoint);
        return async () => ({ text: "Paris" });
      },
    }));
    const localEndpoints = [
      { endpoint: "http://localhost:4311/api/ag-ui", origin: "http://localhost:4311" },
      { endpoint: "http://[::1]:4311/api/ag-ui", origin: "http://[::1]:4311" },
    ];

    for (const [index, local] of localEndpoints.entries()) {
      const runId = `run_eval_local_endpoint_${index}`;
      const { request, publicKeyPem } = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        {
          runId,
          kind: "eval",
          target: "eval:deep-research",
          projectId: "proj-1",
          runtimeAgUiEndpoint: local.endpoint,
        },
        { "x-token": "runtime-token" },
        local.origin,
      );

      const result = await withEnvValue(
        "PORT",
        "4311",
        () => handler.handle(request, createLocalCtx(publicKeyPem)),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals((await result.response.json()).success, true);
    }

    assertEquals(receivedEndpoints, [
      "http://127.0.0.1:4311/api/ag-ui",
      "http://127.0.0.1:4311/api/ag-ui",
    ]);
  });

  it("runs localized eval AG-UI requests through discovered source agents", async () => {
    agentRegistry.register(
      "researcher",
      createStreamingAgent("researcher", "Paris", {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
      }),
    );
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
        () => handler.handle(request, createLocalCtx(publicKeyPem)),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const payload = await result.response.json();
      assertEquals(payload.success, true);
      assertEquals(payload.error, undefined);
      assertEquals(payload.result.summary.failed, 0);
      assertEquals(payload.result.summary.usage, {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      });
      assertEquals(payload.result.records[0]?.usage, {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      });
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
      () => handler.handle(request, createLocalCtx(publicKeyPem)),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(receivedEndpoint, "http://127.0.0.1:4311/api/ag-ui");
    assertEquals(receivedForwardedHost, "demo-project.preview.veryfront.org");
    assertEquals(receivedForwardedProto, "https");
    assertEquals(receivedEnvironment, "preview");
  });

  it("rejects untrusted eval AG-UI endpoints before creating an adapter", async () => {
    let adapterCreations = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createEvalAgentAdapter: () => {
        adapterCreations++;
        return async () => ({ text: "Paris" });
      },
    }));
    const endpoints = [
      "https://agent-service.example.com/api/ag-ui",
      "http://169.254.169.254/api/ag-ui",
      "http://10.0.0.5/api/ag-ui",
      "http://demo-project.preview.veryfront.org/api/ag-ui",
      "https://other-project.preview.veryfront.org/api/ag-ui",
      "https://demo-project.preview.veryfront.org/api/ag-ui?redirect=internal",
      "https://user:password@demo-project.preview.veryfront.org/api/ag-ui",
    ];

    for (const [index, runtimeAgUiEndpoint] of endpoints.entries()) {
      const runId = `run_eval_untrusted_endpoint_${index}`;
      const { request, publicKeyPem } = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        {
          runId,
          kind: "eval",
          target: "eval:deep-research",
          projectId: "proj-1",
          runtimeAgUiEndpoint,
        },
        {
          "x-token": "runtime-token",
          "x-forwarded-host": "agent-service.example.com",
          "x-forwarded-proto": "https",
        },
      );

      const result = await handler.handle(request, createLocalCtx(publicKeyPem));

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(await result.response.json(), {
        success: false,
        error: "runtimeAgUiEndpoint must target this project runtime",
        logs: null,
        duration_ms: 0,
      });
    }
    assertEquals(adapterCreations, 0);
  });

  it("localizes an HTTPS AG-UI endpoint only when it matches the request URL origin", async () => {
    let receivedEndpoint: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        return async () => ({ text: "Paris" });
      },
    }));
    const runId = "run_eval_request_origin";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      {
        runId,
        kind: "eval",
        target: "eval:deep-research",
        projectId: "proj-1",
        runtimeAgUiEndpoint: "https://runtime.example.test/api/ag-ui",
      },
      {
        "x-token": "runtime-token",
        "x-forwarded-host": "spoofed.example.test",
        "x-forwarded-proto": "http",
      },
      "https://runtime.example.test",
    );

    const result = await withEnvValue(
      "PORT",
      "4311",
      () => handler.handle(request, createLocalCtx(publicKeyPem)),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals((await result.response.json()).success, true);
    assertEquals(receivedEndpoint, "http://127.0.0.1:4311/api/ag-ui");
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
      () => handler.handle(request, createLocalCtx(publicKeyPem)),
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

    const result = await handler.handle(request, createLocalCtx(publicKeyPem));

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
        return createEmptyDiscoveryResult();
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

  it("executes discovered project tool steps from control-plane workflow runs", async () => {
    await stopEsbuild();
    agentRegistry.clearAll();
    toolRegistry.clearAll();

    try {
      const adapter = createMockAdapter();
      const projectDir = "/runtime-tool-workflow-project";
      await adapter.fs.writeFile(
        `${projectDir}/tools/echo-tool.ts`,
        [
          'import { tool } from "veryfront/tool";',
          "",
          "export default tool({",
          '  id: "echo_tool",',
          '  description: "Echo the provided message",',
          "  inputSchema: {",
          '    type: "object",',
          '    properties: { message: { type: "string" } },',
          '    required: ["message"],',
          "    additionalProperties: false,",
          "  },",
          '  execute: async ({ message }) => ({ message, source: "project-tool" }),',
          "});",
          "",
        ].join("\n"),
      );
      await adapter.fs.writeFile(
        `${projectDir}/workflows/remote-tool-workflow.ts`,
        [
          'import { step, workflow } from "veryfront/workflow";',
          "",
          "export default workflow({",
          '  id: "remote-tool-workflow",',
          '  description: "Run a project tool from the control-plane workflow path.",',
          "  steps: [",
          '    step("lookup", {',
          '      tool: "echo_tool",',
          '      input: { message: "hello from control plane" },',
          "    }),",
          "  ],",
          "});",
          "",
        ].join("\n"),
      );

      const handler = new ProjectRunExecuteHandler();
      const body = {
        runId: "run_workflow_project_tool_1",
        kind: "workflow",
        target: "workflow:remote-tool-workflow",
        projectId: "proj-1",
        input: { ticket: "VF-1" },
      };
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_workflow_project_tool_1/execute",
        body,
        { "x-token": "runtime-token" },
      );
      adapter.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
      const ctx = {
        ...createCtx(publicKeyPem),
        adapter,
        projectDir,
        config: {},
        proxyToken: "runtime-token",
        requestContext: {
          token: "runtime-token",
          slug: "demo-project",
          branch: "main",
          mode: "preview" as const,
        },
        resolvedEnvironment: "preview",
      } as HandlerContext;

      const result = await runWithRequestContext(
        {
          projectSlug: "demo-project",
          projectId: "proj-1",
          token: "runtime-token",
          productionMode: false,
          branch: "main",
        },
        () => handler.handle(request, ctx),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const response = await result.response.json();
      assertEquals(response.success, true);
      assertEquals(response.result, {
        lookup: {
          message: "hello from control plane",
          source: "project-tool",
        },
      });
      assertEquals(response.logs, null);
      assertEquals(typeof response.duration_ms, "number");
      assertEquals(response.duration_ms >= 0, true);
      assertEquals(response.error, undefined);
      assertEquals(response.artifacts, undefined);
    } finally {
      agentRegistry.clearAll();
      toolRegistry.clearAll();
      await stopEsbuild();
    }
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

  it("coalesces concurrent run replays and reuses the completed response", async () => {
    let runTaskCalls = 0;
    let markStarted!: () => void;
    let releaseTask!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const taskGate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        runTaskCalls += 1;
        markStarted();
        await taskGate;
        return { success: true, result: { attempt: runTaskCalls }, durationMs: 17 };
      },
    }));
    const body = {
      runId: "run_task_replay_concurrent",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const path = "/api/control-plane/runs/run_task_replay_concurrent/execute";
    const { request, publicKeyPem } = await signedRequest(path, body);
    const rawBody = JSON.stringify(body);
    const createRetryRequest = () =>
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: rawBody,
      });
    const ctx = createLocalCtx(publicKeyPem);

    const first = handler.handle(request, ctx);
    await started;
    const second = handler.handle(createRetryRequest(), ctx);
    releaseTask();

    const firstResult = await first;
    const secondResult = await second;
    const retryResult = await handler.handle(createRetryRequest(), ctx);
    assertExists(firstResult.response);
    assertExists(secondResult.response);
    assertExists(retryResult.response);
    assertEquals(runTaskCalls, 1);
    assertEquals(await secondResult.response.json(), await firstResult.response.json());
    assertEquals(await retryResult.response.json(), {
      success: true,
      result: { attempt: 1 },
      duration_ms: 17,
      logs: null,
    });
  });

  it("rejects a run id reused with a different signed body", async () => {
    let runTaskCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        runTaskCalls += 1;
        return { success: true, result: { attempt: runTaskCalls }, durationMs: 9 };
      },
    }));
    const signingKey = await createControlPlaneTestSigningKey();
    const path = "/api/control-plane/runs/run_task_replay_conflict/execute";
    const firstBody = {
      runId: "run_task_replay_conflict",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      config: { mode: "first" },
    };
    const conflictingBody = {
      ...firstBody,
      config: { mode: "different" },
    };
    const ctx = createLocalCtx(signingKey.publicKeyPem);

    const firstResult = await handler.handle(
      await signedRequestWithKey(path, firstBody, signingKey),
      ctx,
    );
    const conflictingResult = await handler.handle(
      await signedRequestWithKey(path, conflictingBody, signingKey),
      ctx,
    );

    assertExists(firstResult.response);
    assertExists(conflictingResult.response);
    assertEquals(firstResult.response.status, 200);
    assertEquals(conflictingResult.response.status, 409);
    assertEquals(await conflictingResult.response.json(), {
      error: "Project run identity conflicts with a different request",
    });
    assertEquals(runTaskCalls, 1);
  });

  it("authenticates before entering a remote project source context", async () => {
    let sourceContextEntries = 0;
    let discoveryCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        discoveryCalls++;
        return createEmptyDiscoveryResult();
      },
    }));
    const ctx = createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----");
    ctx.adapter = ({
      ...ctx.adapter,
      fs: {
        isMultiProjectMode: () => true,
        runWithContext: async (
          _slug: string,
          _token: string,
          fn: () => Promise<unknown>,
        ) => {
          sourceContextEntries++;
          return await fn();
        },
      },
    } as unknown) as HandlerContext["adapter"];

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_unsigned/execute", {
        method: "POST",
        body: JSON.stringify({
          runId: "run_unsigned",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
        }),
      }),
      ctx,
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(sourceContextEntries, 0);
    assertEquals(discoveryCalls, 0);
  });

  it("rejects new project runs while the runtime is shutting down", async () => {
    let sourceContextEntries = 0;
    let discoveryCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        discoveryCalls++;
        return createEmptyDiscoveryResult();
      },
    }));
    const body = {
      runId: "run_during_shutdown",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_during_shutdown/execute",
      body,
    );
    const ctx = createCtx(publicKeyPem);
    ctx.adapter = ({
      ...ctx.adapter,
      fs: {
        isMultiProjectMode: () => true,
        runWithContext: async (
          _slug: string,
          _token: string,
          fn: () => Promise<unknown>,
        ) => {
          sourceContextEntries++;
          return await fn();
        },
      },
    } as unknown) as HandlerContext["adapter"];

    markServerShuttingDown();
    let result;
    try {
      result = await handler.handle(request, ctx);
    } finally {
      __resetServerShuttingDownForTests();
    }

    assertExists(result.response);
    assertEquals(result.response.status, 503);
    assertEquals(await result.response.json(), {
      code: "RUNTIME_SHUTTING_DOWN",
      message: "Runtime is shutting down; retry against another instance",
    });
    assertEquals(result.response.headers.get("connection"), "close");
    assertEquals(sourceContextEntries, 0);
    assertEquals(discoveryCalls, 0);
  });

  it("rejects project claim conflicts before entering a remote project source context", async () => {
    const body = {
      runId: "run_project_claim_conflict",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-body",
    };
    const rawBody = JSON.stringify(body);
    const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
      requestId: body.runId,
      projectId: "proj-claim",
    });
    const request = new Request(
      "https://example.com/api/control-plane/runs/run_project_claim_conflict/execute",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body: rawBody,
      },
    );
    let sourceContextEntries = 0;
    const ctx = createCtx(publicKeyPem);
    ctx.projectId = undefined;
    ctx.adapter = ({
      ...ctx.adapter,
      fs: {
        isMultiProjectMode: () => true,
        runWithContext: async (
          _slug: string,
          _token: string,
          fn: () => Promise<unknown>,
        ) => {
          sourceContextEntries++;
          return await fn();
        },
      },
    } as unknown) as HandlerContext["adapter"];

    const result = await new ProjectRunExecuteHandler(createDeps()).handle(request, ctx);

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Invalid control-plane signature" });
    assertEquals(sourceContextEntries, 0);
  });

  it("decodes and validates the canonical run id before execution", async () => {
    let runTaskCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        runTaskCalls++;
        return { success: true, result: { ok: true }, durationMs: 1 };
      },
    }));
    const body = {
      runId: "run_encoded",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run%5Fencoded/execute",
      body,
    );

    const result = await handler.handle(request, createLocalCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals((await result.response.json()).success, true);
    assertEquals(runTaskCalls, 1);
  });

  it("rejects overlong run ids before entering a remote project source context", async () => {
    const runId = "r".repeat(129);
    const body = {
      runId,
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      body,
    );
    let sourceContextEntries = 0;
    const ctx = createCtx(publicKeyPem);
    ctx.adapter = ({
      ...ctx.adapter,
      fs: {
        isMultiProjectMode: () => true,
        runWithContext: async (
          _slug: string,
          _token: string,
          fn: () => Promise<unknown>,
        ) => {
          sourceContextEntries++;
          return await fn();
        },
      },
    } as unknown) as HandlerContext["adapter"];

    const result = await new ProjectRunExecuteHandler(createDeps()).handle(request, ctx);

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(sourceContextEntries, 0);
  });

  it("rejects inconsistent runtime target selectors before project discovery", async () => {
    let discoveryCalls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        discoveryCalls++;
        return createEmptyDiscoveryResult();
      },
    }));
    const body = {
      runId: "run_invalid_runtime_target",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: null,
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_invalid_runtime_target/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid project run execute request" });
    assertEquals(discoveryCalls, 0);
  });

  it("does not fall back to host project files for remote style builds", async () => {
    const body = {
      runId: "run_style_remote_source_missing",
      kind: "task",
      target: "task:style-artifact-build",
      projectId: "proj-1",
      config: { environment_name: "Preview" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_style_remote_source_missing/execute",
      body,
      { "x-token": "test-token" },
    );
    const recorder = createStyleArtifactFetchRecorder();

    const result = await withMockFetch(
      recorder.fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, createCtx(publicKeyPem)),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const response = await result.response.json();
    assertEquals({
      success: response.success,
      error: response.error,
      logs: response.logs,
    }, {
      success: false,
      error: "Remote project source provider is unavailable",
      logs: null,
    });
    assertEquals(typeof response.duration_ms, "number");
    assertEquals(response.duration_ms >= 0, true);
    assertEquals(recorder.upserts.length, 1);
    assertEquals(recorder.upserts[0]?.status, "failed");
    assertEquals(
      recorder.upserts[0]?.failure_reason,
      "Remote project source provider is unavailable",
    );
  });

  it("sanitizes project execution errors before returning or caching them", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        throw new Error(
          "task failed token=private-token-canary at file:///private/runtime/project.ts",
        );
      },
    }));
    const body = {
      runId: "run_task_sensitive_error",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_sensitive_error/execute",
      body,
    );

    const result = await handler.handle(request, createLocalCtx(publicKeyPem));

    assertExists(result.response);
    const responseText = await result.response.text();
    assertEquals(responseText.includes("private-token-canary"), false);
    assertEquals(responseText.includes("file:///private/runtime/project.ts"), false);
    assertStringIncludes(responseText, "token=[REDACTED]");
    assertStringIncludes(responseText, "<LOCAL_PATH>");
  });

  it("returns a bounded failure when project execution output is too large", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => ({
        success: true,
        result: { output: "x".repeat(16 * 1024 * 1024 + 1_024) },
        durationMs: 5,
      }),
    }));
    const body = {
      runId: "run_task_oversized_output",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_oversized_output/execute",
      body,
    );

    const result = await handler.handle(request, createLocalCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const responseText = await result.response.text();
    assertEquals(responseText.length < 4_096, true);
    assertEquals(JSON.parse(responseText), {
      success: false,
      error: "Project run response exceeds the supported limit",
      logs: null,
      duration_ms: 5,
    });
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
