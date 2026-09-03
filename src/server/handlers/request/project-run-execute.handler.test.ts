import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent } from "#veryfront/agent";
import type { Message } from "#veryfront/agent/types.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import type { HandlerContext } from "#veryfront/types";
import { createAgentServiceEvalAdapter } from "#veryfront/eval/agent-service.ts";
import { runEval as runEvalDefinition } from "#veryfront/eval/runner.ts";
import { datasets, evalAgent, evalDataset, type EvalReport, metrics } from "veryfront/eval";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createKnowledgeEventLogger,
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
  projectWorkflowRedisConfig,
  projectWorkflowRedisPrefix,
} from "./project-run-execute.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

const encoder = new TextEncoder();

describe("createKnowledgeEventLogger", () => {
  it("caps the number of accumulated knowledge ingest events", () => {
    const lines: string[] = [];
    const logger = createKnowledgeEventLogger(lines);

    for (let index = 0; index < 2_000; index += 1) {
      logger.info("Knowledge source extraction progress", { slide_current: index + 1 });
    }

    assertEquals(lines.length, 1_001);
    assertStringIncludes(lines.at(-1) ?? "", "Knowledge ingest logs were truncated");
  });

  it("caps the accumulated knowledge ingest log size", () => {
    const lines: string[] = [];
    const logger = createKnowledgeEventLogger(lines);

    for (let index = 0; index < 100; index += 1) {
      logger.info("x".repeat(10_000));
    }

    assertEquals(encoder.encode(lines.join("\n")).byteLength <= 256 * 1_024, true);
    assertStringIncludes(lines.at(-1) ?? "", "Knowledge ingest logs were truncated");
  });
});

describe("projectWorkflowRedisPrefix", () => {
  it("namespaces durable workflow state per project", () => {
    assertEquals(
      projectWorkflowRedisPrefix("proj-1"),
      "vf:workflow:project:proj-1:target::environment::branch::",
    );
    assertEquals(
      projectWorkflowRedisPrefix("proj-1") === projectWorkflowRedisPrefix("proj-2"),
      false,
    );
  });

  it("escapes characters that could collide or match Redis SCAN globs", () => {
    const prefix = projectWorkflowRedisPrefix("proj*:[a]?");
    assertEquals(/^[A-Za-z0-9_.:-]+$/.test(prefix), true);
    // Escaping is injective: ids that differ only in escaped characters
    // never produce the same namespace.
    assertEquals(
      projectWorkflowRedisPrefix("a.b") === projectWorkflowRedisPrefix("a.2e.b"),
      false,
    );
  });

  it("preserves whitespace in the verified project id when configuring Redis", () => {
    const canonical = projectWorkflowRedisConfig("proj-1");
    const whitespacePrefixed = projectWorkflowRedisConfig(" proj-1");

    assertEquals(canonical, {
      prefix: "vf:workflow:project:proj-1:target::environment::branch::",
      streamKey: "vf:workflow:project:proj-1:target::environment::branch::stream",
      groupName: "vf:workflow:project:proj-1:target::environment::branch::workers",
    });
    assertEquals(whitespacePrefixed, {
      prefix: "vf:workflow:project:.20.proj-1:target::environment::branch::",
      streamKey: "vf:workflow:project:.20.proj-1:target::environment::branch::stream",
      groupName: "vf:workflow:project:.20.proj-1:target::environment::branch::workers",
    });
  });

  it("namespaces durable workflow state per runtime target", () => {
    const main = projectWorkflowRedisPrefix("proj-1", {
      runtimeTargetKind: "main_branch",
    });
    const environment = projectWorkflowRedisPrefix("proj-1", {
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "env-1",
    });
    const otherEnvironment = projectWorkflowRedisPrefix("proj-1", {
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "env-2",
    });
    const preview = projectWorkflowRedisPrefix("proj-1", {
      runtimeTargetKind: "preview_branch",
      runtimeTargetBranchId: "branch-1",
    });

    assertEquals(new Set([main, environment, otherEnvironment, preview]).size, 4);
  });

  it("refuses to configure durable persistence without a project scope", () => {
    // An unscoped prefix would let one project's recovery scan enumerate
    // every other project's durable workflow keys, so an empty scope must
    // fail closed instead of falling back to a shared namespace.
    const error = assertThrows(() => projectWorkflowRedisConfig("")) as {
      slug?: string;
      detail?: string;
    };
    assertEquals(error.slug, "input-validation-failed");
    assertStringIncludes(error.detail ?? "", "requires a project scope");
  });
});

function encodeDataStreamEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function createStreamingAgent(
  id: string,
  text: string,
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number },
  onContext?: (context: Record<string, unknown> | undefined) => void,
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
      onContext?.(input.context);
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
    executeDependencyArtifactBuild: async () => ({
      success: true,
      result: { state: "ready", assetCount: 2 },
      logs: null,
      duration_ms: 11,
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

function requestJsonBody(
  init: Parameters<typeof globalThis.fetch>[1],
): Record<string, unknown> | null {
  const body = observeFetchRequestInit(init).body;
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
    requestMethod: "POST",
    requestPath: path,
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

    const result = await handler.handle(request, createCtx(publicKeyPem));

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

    const result = await handler.handle(request, createCtx(publicKeyPem));

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

  it("dispatches dependency artifact builds without project discovery", async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    let attemptedProjectDiscovery = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      ensureProjectDiscovery: async () => {
        attemptedProjectDiscovery = true;
        return createEmptyDiscoveryResult();
      },
      executeDependencyArtifactBuild: async (input) => {
        receivedConfig = input.request.config;
        return {
          success: true,
          result: { state: "ready", assetCount: 2 },
          logs: null,
          duration_ms: 11,
        };
      },
    }));
    const config = {
      artifact_id: "11111111-1111-4111-8111-111111111111",
      attempt_count: 1,
      identity: {
        origin_key: "npm:public",
        package_name: "fixture-package",
        exact_version: "1.2.3",
        subpath: "",
        target: "es2022",
        profile: "standard-v1",
      },
      policy: { decision: "allow" },
    };
    const body = {
      runId: "run_dependency_artifact_1",
      kind: "task",
      target: "task:dependency-artifact-build",
      projectId: "proj-1",
      config,
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_dependency_artifact_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { state: "ready", assetCount: 2 },
      logs: null,
      duration_ms: 11,
    });
    assertEquals(receivedConfig, config);
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

  it("runs a dataset eval without a runtime API token", async () => {
    let adapterCreated = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findEvalById: async (target) =>
        target === "eval:dataset"
          ? {
            id: "eval:dataset",
            name: "Dataset grading",
            filePath: "evals/dataset.eval.ts",
            exportName: "default",
            definition: evalDataset({
              id: "eval:dataset",
              dataset: datasets.inline([{ id: "case-1", input: "text" }]),
            }),
          }
          : null,
      createEvalAgentAdapter: () => {
        adapterCreated = true;
        return async () => ({ text: "" });
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_dataset/execute",
      {
        runId: "run_eval_dataset",
        kind: "eval",
        target: "eval:dataset",
        projectId: "proj-1",
      },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals((await result.response.json()).success, true);
    assertEquals(adapterCreated, false);
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

  it("runs local eval AG-UI requests through discovered source agents", async () => {
    let capturedContext: Record<string, unknown> | undefined;
    agentRegistry.register(
      "researcher",
      createStreamingAgent("researcher", "Paris", {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
      }, (context) => capturedContext = context),
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
      runtimeAgUiEndpoint: "http://localhost:4311/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_source_agent/execute",
      body,
      { "x-token": "runtime-token" },
      "http://localhost:4311",
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
      assertEquals(capturedContext?.runIdBindsToolAuthorization, false);
    } finally {
      agentRegistry.delete("researcher");
    }
  });

  it("runs managed eval targets as durable child agent runs", async () => {
    const requests: Array<
      { method: string; pathname: string; body: Record<string, unknown> | null }
    > = [];
    const conversationId = "11111111-1111-4111-8111-111111111111";
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
              dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
              metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
            }),
          }
          : null,
      runEval: runEvalDefinition,
      createEvalAgentAdapter: (config) =>
        createAgentServiceEvalAdapter({ ...config, requestTimeoutMs: 250 }),
    }));
    const body = {
      runId: "run_eval_durable_agent",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_durable_agent/execute",
      body,
      { "x-token": "runtime-token" },
      "https://veryfront.org",
    );

    const result = await withEnvValue(
      "VERYFRONT_API_BASE_URL",
      "https://api.example.test/",
      () =>
        withMockFetch(
          async (input, init) => {
            const url = new URL(String(input));
            const method = observeFetchRequestInit(init).method ?? "GET";
            const requestBody = requestJsonBody(init);
            requests.push({ method, pathname: url.pathname, body: requestBody });

            if (method === "POST" && url.pathname.endsWith("/runs")) {
              const runId = String(requestBody?.public_id);
              return Response.json({
                accepted: true,
                run: { run_id: runId },
                conversation_id: conversationId,
              }, { status: 202 });
            }

            if (method === "GET" && url.pathname.endsWith("/stream")) {
              return new Response(
                [
                  `event: RunStarted\ndata: ${JSON.stringify({ runId: "eval-child-run" })}\n\n`,
                  `event: TextMessageContent\ndata: ${JSON.stringify({ delta: "Paris" })}\n\n`,
                  `event: RunFinished\ndata: ${JSON.stringify({})}\n\n`,
                ].join(""),
                { headers: { "content-type": "text/event-stream" } },
              );
            }

            return new Response("not found", { status: 404 });
          },
          () => handler.handle(request, createCtx(publicKeyPem)),
        ),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const payload = await result.response.json();
    assertEquals(payload.success, true);
    assertEquals(payload.result.summary.failed, 0);
    assertEquals(payload.result.records[0]?.output?.text, "Paris");

    assertEquals(requests.length, 2);
    const createRequest = requests[0];
    assertEquals(createRequest?.method, "POST");
    assertEquals(createRequest?.body?.kind, "agent");
    assertEquals(createRequest?.body?.owner, { kind: "project", id: "proj-1" });
    assertEquals(createRequest?.body?.parent_run_id, "run_eval_durable_agent");
    assertEquals(createRequest?.body?.conversation_mode, "create_new");
    assertStringIncludes(String(createRequest?.body?.public_id), "eval-run-");
    const createRunRequest = createRequest?.body?.request as Record<string, unknown>;
    const agentInput = createRunRequest.input as Record<string, unknown>;
    assertEquals(agentInput.agent_id, "researcher");
    assertEquals(agentInput.messages, []);
    assertEquals(agentInput.source_target_kind, "project");
    assertEquals(agentInput.runtime_target_kind, "main_branch");
    assertEquals(agentInput.target_environment_id, undefined);
    assertEquals(agentInput.target_branch_id, undefined);
    assertEquals(agentInput.forwarded_props, {
      prompt: "France capital?",
      runtimeOverrides: {
        allowedTools: [],
      },
      veryfront: {
        agentId: "researcher",
        projectId: "proj-1",
        runtimeOverrides: {
          allowedTools: [],
        },
      },
    });
    assertEquals(requests[0]?.pathname, "/runs");
    assertEquals(requests[1]?.method, "GET");
    assertStringIncludes(requests[1]?.pathname ?? "", `/conversations/${conversationId}/runs/`);
    assertStringIncludes(requests[1]?.pathname ?? "", "/stream");
  });

  it("preserves environment and preview targets for durable eval runs", async () => {
    const requests: Array<
      { method: string; pathname: string; body: Record<string, unknown> | null }
    > = [];
    const conversationId = "22222222-2222-4222-8222-222222222222";
    const environmentId = "33333333-3333-4333-8333-333333333333";
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
              dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
              metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
            }),
          }
          : null,
      runEval: runEvalDefinition,
      createEvalAgentAdapter: (config) =>
        createAgentServiceEvalAdapter({ ...config, requestTimeoutMs: 250 }),
    }));
    const execute = async (body: Record<string, unknown>) => {
      const runId = String(body.runId);
      const { request, publicKeyPem } = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        body,
        { "x-token": "runtime-token" },
        "https://veryfront.org",
      );

      return await withEnvValue(
        "VERYFRONT_API_BASE_URL",
        "https://api.example.test/",
        () =>
          withMockFetch(
            async (input, init) => {
              const url = new URL(String(input));
              const method = observeFetchRequestInit(init).method ?? "GET";
              const requestBody = requestJsonBody(init);
              requests.push({ method, pathname: url.pathname, body: requestBody });

              if (method === "POST" && url.pathname.endsWith("/runs")) {
                const publicId = String(requestBody?.public_id);
                return Response.json({
                  accepted: true,
                  run: { run_id: publicId },
                  conversation_id: conversationId,
                }, { status: 202 });
              }

              if (method === "GET" && url.pathname.endsWith("/stream")) {
                return new Response(
                  [
                    `event: RunStarted\ndata: ${JSON.stringify({ runId: "eval-child-run" })}\n\n`,
                    `event: TextMessageContent\ndata: ${JSON.stringify({ delta: "Paris" })}\n\n`,
                    `event: RunFinished\ndata: ${JSON.stringify({})}\n\n`,
                  ].join(""),
                  { headers: { "content-type": "text/event-stream" } },
                );
              }

              return new Response("not found", { status: 404 });
            },
            () => handler.handle(request, createCtx(publicKeyPem)),
          ),
      );
    };
    const body = {
      runId: "run_eval_durable_env_agent",
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: environmentId,
      config: { model: "model-override-1", max_steps: 3 },
    };
    const result = await execute(body);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const payload = await result.response.json();
    assertEquals(payload.success, true);

    assertEquals(requests.length, 2);
    const createRunRequest = requests[0]?.body?.request as Record<string, unknown>;
    const agentInput = createRunRequest.input as Record<string, unknown>;
    assertEquals(agentInput.agent_id, "researcher");
    assertEquals(agentInput.messages, []);
    assertEquals(agentInput.source_target_kind, "environment");
    assertEquals(agentInput.runtime_target_kind, "environment");
    assertEquals(agentInput.target_environment_id, environmentId);
    assertEquals(agentInput.target_branch_id, undefined);
    assertEquals(agentInput.forwarded_props, {
      prompt: "France capital?",
      model: "model-override-1",
      runtimeOverrides: {
        allowedTools: [],
        maxSteps: 3,
      },
      veryfront: {
        agentId: "researcher",
        projectId: "proj-1",
        model: "model-override-1",
        runtimeOverrides: {
          allowedTools: [],
          maxSteps: 3,
        },
      },
    });

    requests.length = 0;
    const branchId = "44444444-4444-4444-8444-444444444444";
    const previewResult = await execute({
      ...body,
      runId: "run_eval_durable_preview_agent",
      runtimeTargetKind: "preview_branch",
      runtimeTargetEnvironmentId: undefined,
      runtimeTargetBranchId: branchId,
    });

    assertExists(previewResult.response);
    assertEquals(previewResult.response.status, 200);
    const previewRequest = requests[0]?.body?.request as Record<string, unknown>;
    const previewInput = previewRequest.input as Record<string, unknown>;
    assertEquals(previewInput.source_target_kind, "preview_branch");
    assertEquals(previewInput.runtime_target_kind, "preview_branch");
    assertEquals(previewInput.target_environment_id, undefined);
    assertEquals(previewInput.target_branch_id, branchId);
    assertEquals(previewInput.messages, []);
    assertEquals(previewInput.forwarded_props, agentInput.forwarded_props);
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

  it("scopes the workflow client to the verified project and runtime target", async () => {
    let clientScope: {
      projectId: string;
      runtimeTargetKind?: string;
      runtimeTargetEnvironmentId?: string | null;
      runtimeTargetBranchId?: string | null;
    } | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: (_config, options) => {
        clientScope = options;
        return {
          register: () => {},
          start: async (
            _workflowId: string,
            _input: unknown,
            startOptions?: { runId?: string },
          ) => ({ runId: startOptions?.runId ?? "workflow-run" }),
          getRun: async () => ({
            status: "completed",
            output: { deployed: true },
          }),
          destroy: async () => {},
        };
      },
    }));
    const body = {
      runId: "run_workflow_scope_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "env-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_scope_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals((await result.response.json()).success, true);
    assertEquals(clientScope, {
      projectId: "proj-1",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "env-1",
      runtimeTargetBranchId: undefined,
    });
  });

  it("executes discovered project tool steps from control-plane workflow runs", async () => {
    await stopEsbuild();
    agentRegistry.clearAll();
    toolRegistryInternal.clearAll();

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
        allowHostProjectCodeExecution: true,
      } as HandlerContext;

      const result = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy(undefined),
        () =>
          runWithRequestContext(
            {
              projectSlug: "demo-project",
              projectId: "proj-1",
              token: "runtime-token",
              productionMode: false,
              branch: "main",
            },
            () => handler.handle(request, ctx),
          ),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const response = await result.response.json();
      assertEquals(response.success, true, response.error ?? undefined);
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
      toolRegistryInternal.clearAll();
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

  it("times out a workflow run that never reaches a terminal status", async () => {
    // Mirrors DEFAULT_WORKFLOW_STATUS_TIMEOUT_MS in the handler (15 minutes).
    const workflowStatusTimeoutMs = 15 * 60 * 1_000;
    let sleepCalls = 0;
    let getRunCalls = 0;
    let clock = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      // Each poll sleep advances the fake clock past the status deadline, and
      // a loop that keeps polling anyway is cut short instead of hanging.
      sleep: async () => {
        sleepCalls++;
        clock += workflowStatusTimeoutMs + 1;
        if (sleepCalls > 3) throw new Error("poll loop kept running past the deadline");
      },
      now: () => clock,
      createWorkflowClient: () => ({
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
        }),
        getRun: async () => {
          getRunCalls++;
          return { status: "running" };
        },
        destroy: async () => {},
      }),
    }));
    const body = {
      runId: "run_workflow_stuck_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: "v1" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_stuck_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const payload = await result.response.json();
    assertEquals(
      payload.success,
      false,
      "a workflow that never reaches a terminal status must time out",
    );
    assertStringIncludes(payload.error, "timed out");
    assertEquals(sleepCalls > 0, true, "the poll loop must sleep between getRun calls");
    assertEquals(getRunCalls > 1, true, "the poll loop must re-check the run after sleeping");
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
