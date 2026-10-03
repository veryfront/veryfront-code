import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";
import { CONTROL_PLANE_OWNED_START } from "#veryfront/workflow/dsl/validation.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import type { Agent } from "#veryfront/agent";
import { tool } from "#veryfront/tool";
import {
  createWorkflowClient,
  step,
  subWorkflow,
  workflow,
  type WorkflowDefinition,
} from "#veryfront/workflow";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { schemaIdentitySha256 } from "#veryfront/schemas/schema-identity.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import type { Message } from "#veryfront/agent/types.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { resolveHostOwnedSourceApiBaseUrl } from "#veryfront/config/host-api-base.ts";
import type { HandlerContext } from "#veryfront/types";
import { createAgentServiceEvalAdapter } from "#veryfront/eval/agent-service.ts";
import { runEval as runEvalDefinition } from "#veryfront/eval/runner.ts";
import { datasets, evalAgent, evalDataset, type EvalReport, metrics } from "veryfront/eval";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  createDenoServer,
  createDenoServerWithRuntime,
  type DenoServeRuntime,
} from "#veryfront/platform/adapters/runtime/deno/http-server.ts";
import {
  inheritRequestPeerProvenance,
  recordRequestTransportLifetime,
} from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

async function expectedReportArtifact(report: EvalReport, sourcePath: string, path = sourcePath) {
  const content = `${JSON.stringify({ ...report, reportPath: sourcePath }, null, 2)}\n`;
  return {
    kind: "eval-report",
    path,
    contentType: "application/json",
    size_bytes: new TextEncoder().encode(content).byteLength,
    sha256: await computeHash(content),
  };
}
import {
  createKnowledgeEventLogger,
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
  projectWorkflowRedisConfig,
  projectWorkflowRedisPrefix,
  uploadEvalReportToProjectFiles,
} from "./project-run-execute.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";
import { MemoryBackend } from "#veryfront/workflow/backends/memory.ts";
import { dependsOn } from "#veryfront/workflow/dsl/workflow.ts";
import { waitForApproval, waitForEvent, waitForRuns } from "#veryfront/workflow/dsl/wait.ts";
import type { WorkflowNode, WorkflowRun } from "#veryfront/workflow/types.ts";
import type { DiscoveredWorkflow } from "#veryfront/workflow/discovery";
import { delay, withEnv } from "#veryfront/testing/deno-compat.ts";
import { createProjectRunInferenceModelResolver } from "#veryfront/agent/runtime/project-run-inference-credential.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import * as otelApi from "npm:@opentelemetry/api@1.9.1";
import { AsyncLocalStorageContextManager } from "npm:@opentelemetry/context-async-hooks@2.9.0";
import { sealIngressCredentials } from "#veryfront/security/http/ingress-credentials.ts";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.9.0";
import {
  _resetShimForTests,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  SpanStatusCode,
} from "#veryfront/observability/tracing/api-shim.ts";

const encoder = new TextEncoder();

/**
 * A model transport that streams one fixed answer.
 *
 * A restricted local eval rebuilds the source agent through the framework
 * factory and streams it for real, so these tests supply a transport instead of
 * replacing a runtime method: the ceiling is then observed exactly where it has
 * to hold, in the tool list and prompt the provider receives.
 */
function createEvalTransportModel(input: {
  text: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  onCall?: (options: ModelRuntimeCallOptions) => void;
}): ModelRuntime<ModelRuntimeCallOptions> {
  return {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    doGenerate: () => {
      throw new Error("Expected the streaming path");
    },
    doStream: (options) => {
      input.onCall?.(options);
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            controller.enqueue({ type: "text-delta", id: "text-1", delta: input.text });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              ...(input.usage ? { usage: input.usage } : {}),
            });
            controller.close();
          },
        }),
      });
    },
  };
}

function manualTaskDeadlineClock() {
  let now = Date.UTC(2026, 9, 3);
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; at: number }>();
  return {
    now: () => now,
    setTimer: (callback: () => void, delayMs: number) => {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delayMs });
      return id;
    },
    clearTimer: (id: number | undefined) => {
      if (id !== undefined) timers.delete(id);
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

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
      "vf:workflow:project:proj-1:target:main_branch:environment::branch::",
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

  it("does not use project-controlled string encoding methods", () => {
    const originalReplace = String.prototype.replace;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalNumberToString = Number.prototype.toString;
    let first: string | undefined;
    let second: string | undefined;
    try {
      String.prototype.replace = () => "shared";
      String.prototype.charCodeAt = () => 0;
      Number.prototype.toString = () => "0";
      first = projectWorkflowRedisPrefix("project.*");
      second = projectWorkflowRedisPrefix("project.?");
    } finally {
      String.prototype.replace = originalReplace;
      String.prototype.charCodeAt = originalCharCodeAt;
      Number.prototype.toString = originalNumberToString;
    }

    assertEquals(first === second, false);
  });

  it("preserves whitespace in the verified project id when configuring Redis", () => {
    const canonical = projectWorkflowRedisConfig("proj-1");
    const whitespacePrefixed = projectWorkflowRedisConfig(" proj-1");

    assertEquals(canonical, {
      prefix: "vf:workflow:project:proj-1:target:main_branch:environment::branch::",
      streamKey: "vf:workflow:project:proj-1:target:main_branch:environment::branch::stream",
      groupName: "vf:workflow:project:proj-1:target:main_branch:environment::branch::workers",
    });
    assertEquals(whitespacePrefixed, {
      prefix: "vf:workflow:project:.20.proj-1:target:main_branch:environment::branch::",
      streamKey: "vf:workflow:project:.20.proj-1:target:main_branch:environment::branch::stream",
      groupName: "vf:workflow:project:.20.proj-1:target:main_branch:environment::branch::workers",
    });
  });

  it("canonicalizes an omitted runtime target kind to the default branch", () => {
    // The control-plane wire format leaves runtimeTargetKind optional and
    // resolveControlPlaneBranchBinding reads an omitted kind as main_branch.
    // Both spellings must land in one namespace or an approval waiting under
    // the explicit spelling is invisible to a recovery scan started under the
    // implicit one.
    assertEquals(
      projectWorkflowRedisPrefix("proj-1", {}),
      projectWorkflowRedisPrefix("proj-1", { runtimeTargetKind: "main_branch" }),
    );
  });

  it("ignores identifiers that do not belong to the selected target kind", () => {
    // A default-branch or environment run carries no preview branch id, so a
    // stray identifier must not split one target across two namespaces.
    const mainBranch = projectWorkflowRedisPrefix("proj-1", {
      runtimeTargetKind: "main_branch",
    });
    assertEquals(
      projectWorkflowRedisPrefix("proj-1", {
        runtimeTargetKind: "main_branch",
        runtimeTargetEnvironmentId: "env-1",
        runtimeTargetBranchId: "branch-1",
      }),
      mainBranch,
    );
    assertEquals(
      projectWorkflowRedisPrefix("proj-1", {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "env-1",
        runtimeTargetBranchId: "branch-1",
      }),
      projectWorkflowRedisPrefix("proj-1", {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "env-1",
      }),
    );
    assertEquals(
      projectWorkflowRedisPrefix("proj-1", {
        runtimeTargetKind: "preview_branch",
        runtimeTargetEnvironmentId: "env-1",
        runtimeTargetBranchId: "branch-1",
      }),
      projectWorkflowRedisPrefix("proj-1", {
        runtimeTargetKind: "preview_branch",
        runtimeTargetBranchId: "branch-1",
      }),
    );
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

/** The waiting payload without its opaque boundary id, which must be a SHA-256 hex digest. */
function withoutWaitId(waiting: Record<string, unknown>): Record<string, unknown> {
  const { wait_id: waitId, ...rest } = waiting;
  assertMatch(String(waitId), /^w(\.[0-9a-f]{16})*$/);
  return rest;
}

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
      cancel: async () => {},
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
    uploadEvalReport: async () => "evals/reports/default.json",
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

const runTaskDefinition: ProjectRunExecuteHandlerDeps["runTask"] = async (options) => {
  const startedAt = performance.now();
  try {
    options.signal?.throwIfAborted();
    const result = await options.task.definition.run({
      env: {},
      config: options.config ?? {},
      input: options.input ?? options.config ?? {},
      runId: options.runId,
      projectId: options.projectId,
      environmentId: options.environmentId,
      signal: options.signal,
      attempt: options.attempt ?? 1,
    });
    return { success: true, result, durationMs: performance.now() - startedAt };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - startedAt,
    };
  }
};

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
    onGetAllSourceFiles?: () => void;
  },
): { ctx: HandlerContext; readCalls: string[]; sourceFileCalls: { count: number } } {
  const ctx = createCtx(publicKeyPem);
  const readCalls: string[] = [];
  const sourceFileCalls = { count: 0 };
  const stylesheetPath = options.stylesheetPath ?? "src/styles.css";
  const underlyingAdapter = {
    async getAllSourceFiles() {
      sourceFileCalls.count++;
      options.onGetAllSourceFiles?.();
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

  for (
    const refusal of [
      { body: { kind: "task", target: "echo-input" }, error: "Invalid task target" },
      { body: { kind: "workflow", target: "publish" }, error: "Invalid workflow target" },
      {
        body: { kind: "task", target: "task:echo-input", deadlineAt: "invalid" },
        error: "Invalid deadlineAt",
      },
    ]
  ) {
    it(`returns the execute request validation detail: ${refusal.error}`, async () => {
      const handler = new ProjectRunExecuteHandler(createDeps());
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_1/execute",
        { runId: "run_1", projectId: "p", ...refusal.body },
      );
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      assertEquals(result.response.status, 400);
      assertEquals(await result.response.json(), { error: refusal.error });
    });
  }

  it("keeps unexpected execute request errors generic", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps());
    const { publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_1/execute",
      { runId: "run_1", projectId: "p", kind: "task", target: "task:echo-input" },
    );
    const request = new Request("https://example.com/api/control-plane/runs/run_1/execute", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error("private transport diagnostic"));
        },
      }),
    });
    const result = await handler.handle(request, createCtx(publicKeyPem));
    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid project run execute request" });
  });

  for (
    const deadlineAt of [
      "invalid",
      12,
      "2026-09-29Tgarbage",
      "2099-01-01T00:00:00",
      "2099-02-30T00:00:00Z",
      "2099-01-01T24:00:00Z",
      "2000-01-01T00:00:00.000Z",
    ]
  ) {
    it(`does not start task code for an invalid or expired deadline: ${deadlineAt}`, async () => {
      let started = false;
      const handler = new ProjectRunExecuteHandler(
        createDeps({
          runTask: async () => {
            started = true;
            return { success: true, durationMs: 0 };
          },
        }),
      );
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_deadline/execute",
        {
          runId: "run_deadline",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          deadlineAt,
        },
      );
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      assertEquals(started, false);
      if (deadlineAt === "2000-01-01T00:00:00.000Z") {
        assertEquals(result.response.status, 200);
        assertEquals((await result.response.json()).error_code, "RUN_TIMEOUT");
      } else assertEquals(result.response.status, 400);
    });
  }

  it("reports every durable workflow-node child dependency with all-of semantics", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
        }),
        getRun: async () => ({
          status: "waiting",
          currentNodes: ["durable-children"],
          nodeStates: {
            "durable-children": {
              status: "running",
              _waitInstanceId: "wait-children",
              input: { type: "child_run", runIds: ["run_child_1", "run_child_2"] },
            },
          },
          pendingApprovals: [],
        }),
        getPendingEventWaits: async () => [],
        cancel: async () => {},
        destroy: async () => {},
      }),
    }));
    const runId = "run_workflow_waiting_on_children";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      {
        runId,
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
      },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const payload = await result.response.json();
    assertEquals(payload.status, "waiting");
    assertEquals(payload.waiting_reason, "child_run");
    assertMatch(payload.waiting.wait_id, /^w\.[0-9a-f]{16}(?:\.[0-9a-f]{16})*$/);
    assertEquals(payload.waiting_on, [
      {
        kind: "run",
        run_id: "run_child_1",
        correlation: { kind: "workflow_node", id: "durable-children" },
      },
      {
        kind: "run",
        run_id: "run_child_2",
        correlation: { kind: "workflow_node", id: "durable-children" },
      },
    ]);
  });

  it("fails the bridge response when parallel child-run waits exceed the aggregate cap", async () => {
    const childIds = (prefix: string) =>
      Array.from({ length: 600 }, (_, index) => `run_${prefix}_${index}`);
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
        }),
        getRun: async () => ({
          status: "waiting",
          currentNodes: ["first-children", "second-children"],
          nodeStates: {
            "first-children": {
              status: "running",
              _waitInstanceId: "wait-first",
              input: { type: "child_run", runIds: childIds("first") },
            },
            "second-children": {
              status: "running",
              _waitInstanceId: "wait-second",
              input: { type: "child_run", runIds: childIds("second") },
            },
          },
          pendingApprovals: [],
        }),
        getPendingEventWaits: async () => [],
        cancel: async () => {},
        destroy: async () => {},
      }),
    }));
    const runId = "run_workflow_too_many_child_dependencies";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      { runId, kind: "workflow", target: "workflow:publish", projectId: "proj-1" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, false);
    assertStringIncludes(payload.error, "at most 1000 child-run dependencies");
    assertEquals(payload.waiting_on, undefined);
  });

  it("preserves a successful task result within its deadline", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps());
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_deadline/execute",
      {
        runId: "run_deadline",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-1",
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      },
    );
    const result = await handler.handle(request, createCtx(publicKeyPem));
    assertExists(result.response);
    assertEquals((await result.response.json()).result, { synced: 12 });
  });

  for (const discoveryThrows of [false, true]) {
    it(`does not start task code when discovery blocks past the deadline (throws: ${discoveryThrows})`, async () => {
      const deps = createDeps();
      const deadline = Date.now() + 100;
      let started = false;
      const handler = new ProjectRunExecuteHandler(createDeps({
        ensureProjectDiscovery: async (ctx) => {
          const discovery = await deps.ensureProjectDiscovery(ctx);
          while (Date.now() <= deadline) { /* simulate synchronous module initialization */ }
          if (discoveryThrows) throw new Error("discovery failed after deadline");
          return discovery;
        },
        runTask: async () => {
          started = true;
          return { success: true, durationMs: 0 };
        },
      }));
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_deadline/execute",
        {
          runId: "run_deadline",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          deadlineAt: new Date(deadline).toISOString(),
        },
      );
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      assertEquals((await result.response.json()).error_code, "RUN_TIMEOUT");
      assertEquals(started, false);
    });
  }

  it("enforces the deadline despite task changes to the clock and abort method", async () => {
    const originalNow = Date.now;
    const originalAbort = AbortController.prototype.abort;
    const deadline = originalNow() + 100;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        while (originalNow() <= deadline) { /* simulate blocking task code */ }
        Date.now = () => 0;
        AbortController.prototype.abort = () => {
          throw new Error("patched abort");
        };
        return { success: true, result: "late", durationMs: 100 };
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_deadline/execute",
      {
        runId: "run_deadline",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-1",
        deadlineAt: new Date(deadline).toISOString(),
      },
    );
    try {
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.success, false);
      assertEquals(body.error_code, "RUN_TIMEOUT");
    } finally {
      Date.now = originalNow;
      AbortController.prototype.abort = originalAbort;
    }
  });

  for (const scope of ["inherited", "accessor"] as const) {
    it(`ignores ${scope} task deadline clocks in host dependencies`, async () => {
      let clockReads = 0;
      const unexpectedClock = {
        now: () => {
          clockReads++;
          throw new Error("untrusted deadline clock");
        },
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      };
      const deps = createDeps({});
      if (scope === "inherited") {
        Object.setPrototypeOf(deps, { taskDeadlineClock: unexpectedClock });
      } else {
        Object.defineProperty(deps, "taskDeadlineClock", {
          get() {
            clockReads++;
            return unexpectedClock;
          },
        });
      }
      const handler = new ProjectRunExecuteHandler(deps);
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_deadline/execute",
        {
          runId: "run_deadline",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          deadlineAt: new Date(Date.now() - 1).toISOString(),
        },
      );
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      assertEquals((await result.response.json()).error_code, "RUN_TIMEOUT");
      assertEquals(clockReads, 0);
    });
  }

  it("preserves the result when task code replaces timer cleanup", async () => {
    const originalClearTimeout = globalThis.clearTimeout;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        globalThis.clearTimeout = () => {
          throw new Error("patched cleanup");
        };
        return { success: true, result: "finished", durationMs: 0 };
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_deadline/execute",
      {
        runId: "run_deadline",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-1",
        deadlineAt: new Date(Date.now() + 100).toISOString(),
      },
    );
    try {
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      assertEquals((await result.response.json()).result, "finished");
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  });

  for (
    const target of [
      "knowledge-ingest",
      "release-asset-build",
      "dependency-artifact-build",
      "style-artifact-build",
    ]
  ) {
    it(`stops reserved task side effects when the run is cancelled: ${target}`, async () => {
      let receivedSignal: AbortSignal | undefined;
      let sideEffects = 0;
      const started = Promise.withResolvers<void>();
      const execute = async (input: unknown) => {
        receivedSignal = (input as { signal?: AbortSignal }).signal;
        started.resolve();
        if (!receivedSignal) return { success: true };
        await new Promise<void>((resolve) =>
          receivedSignal!.addEventListener("abort", () => resolve(), { once: true })
        );
        receivedSignal.throwIfAborted();
        sideEffects++;
        return { success: true };
      };
      const handler = new ProjectRunExecuteHandler(
        createDeps({
          executeKnowledgeIngest: execute,
          executeReleaseAssetBuild: execute,
          executeDependencyArtifactBuild: execute,
          executeStyleArtifactBuild: execute,
        }),
      );
      const signed = await signedRequest(
        "/api/control-plane/runs/run_cancel/execute",
        {
          runId: "run_cancel",
          kind: "task",
          target: `task:${target}`,
          projectId: "proj-1",
        },
      );
      const controller = new AbortController();
      const request = new Request(signed.request, { signal: controller.signal });

      const pending = handler.handle(request, createCtx(signed.publicKeyPem));
      await started.promise;
      controller.abort(new Error("run cancelled"));
      const result = await pending;

      assertExists(result.response);
      assertExists(receivedSignal);
      assertEquals(receivedSignal.aborted, true);
      assertEquals(sideEffects, 0);
      assertEquals((await result.response.json()).success, false);
    });

    it(`stops reserved task side effects when its deadline expires: ${target}`, async () => {
      const clock = manualTaskDeadlineClock();
      const started = Promise.withResolvers<void>();
      let receivedSignal: AbortSignal | undefined;
      let sideEffects = 0;
      const execute = async (input: unknown) => {
        receivedSignal = (input as { signal?: AbortSignal }).signal;
        started.resolve();
        if (!receivedSignal) return { success: true };
        await new Promise<void>((resolve) =>
          receivedSignal!.addEventListener("abort", () => resolve(), { once: true })
        );
        receivedSignal.throwIfAborted();
        sideEffects++;
        return { success: true };
      };
      const handler = new ProjectRunExecuteHandler(
        createDeps({
          taskDeadlineClock: {
            now: Date.now,
            setTimeout: globalThis.setTimeout,
            clearTimeout: globalThis.clearTimeout,
          },
          executeKnowledgeIngest: execute,
          executeReleaseAssetBuild: execute,
          executeDependencyArtifactBuild: execute,
          executeStyleArtifactBuild: execute,
        }),
        clock,
      );
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_deadline/execute",
        {
          runId: "run_deadline",
          kind: "task",
          target: `task:${target}`,
          projectId: "proj-1",
          deadlineAt: new Date(clock.now() + 25).toISOString(),
        },
      );

      const pending = handler.handle(request, createCtx(publicKeyPem));
      await Promise.race([
        started.promise,
        pending.then(() => {
          throw new Error("Deadline test completed before executor admission");
        }),
      ]);
      clock.advance(25);
      const result = await pending;

      assertExists(result.response);
      assertExists(receivedSignal);
      assertEquals(receivedSignal.aborted, true);
      assertEquals(sideEffects, 0);
      assertEquals((await result.response.json()).error_code, "RUN_TIMEOUT");
    });

    it(`bounds a non-cooperative reserved task: ${target}`, async () => {
      let finish: (() => void) | undefined;
      const execute = async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { success: true };
      };
      const handler = new ProjectRunExecuteHandler(
        createDeps({
          executeKnowledgeIngest: execute,
          executeReleaseAssetBuild: execute,
          executeDependencyArtifactBuild: execute,
          executeStyleArtifactBuild: execute,
        }),
      );
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_deadline/execute",
        {
          runId: "run_deadline",
          kind: "task",
          target: `task:${target}`,
          projectId: "proj-1",
          deadlineAt: new Date(Date.now() + 100).toISOString(),
        },
      );
      const guard = setTimeout(() => finish?.(), 1_000);
      try {
        const result = await handler.handle(request, createCtx(publicKeyPem));
        assertExists(result.response);
        assertEquals((await result.response.json()).error_code, "RUN_TIMEOUT");
      } finally {
        clearTimeout(guard);
        finish?.();
      }
    });

    it(`refuses an expired reserved task: ${target}`, async () => {
      let started = false;
      const execute = async () => {
        started = true;
        return { success: true };
      };
      const handler = new ProjectRunExecuteHandler(
        createDeps({
          executeKnowledgeIngest: execute,
          executeReleaseAssetBuild: execute,
          executeDependencyArtifactBuild: execute,
          executeStyleArtifactBuild: execute,
        }),
      );
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_deadline/execute",
        {
          runId: "run_deadline",
          kind: "task",
          target: `task:${target}`,
          projectId: "proj-1",
          deadlineAt: "2000-01-01T00:00:00Z",
        },
      );
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      assertEquals((await result.response.json()).error_code, "RUN_TIMEOUT");
      assertEquals(started, false);
    });
  }

  for (
    const [name, cooperative, maskAborted] of [
      ["hands the task an abort signal that fires at the invocation deadline", true, false],
      [
        "answers with an explicit timeout when a task ignores the signal past its deadline",
        false,
        false,
      ],
      ["preserves timeout classification when a task masks the aborted flag", true, true],
    ] as const
  ) {
    it(name, async () => {
      let signal: AbortSignal | undefined;
      let settle: (() => void) | undefined;
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: async (options) => {
          signal = options.signal;
          await new Promise<void>((resolve) => {
            settle = resolve;
            if (cooperative) {
              signal?.addEventListener("abort", () => {
                if (maskAborted) Object.defineProperty(signal, "aborted", { value: false });
                resolve();
              }, {
                once: true,
              });
            }
          });
          return { success: true, result: "late", durationMs: 1 };
        },
      }));
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_deadline/execute",
        {
          runId: "run_deadline",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          deadlineAt: new Date(Date.now() + 100).toISOString(),
        },
      );
      let guard: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          handler.handle(request, createCtx(publicKeyPem)),
          new Promise<never>((_resolve, reject) => {
            guard = setTimeout(
              () => reject(new Error("execution exceeded deadline grace")),
              1_000,
            );
          }),
        ]);
        assertExists(signal);
        assertEquals(signal.aborted, !maskAborted);
        assertExists(result.response);
        const body = await result.response.json();
        assertEquals(body.success, false);
        assertEquals(body.error_code, "RUN_TIMEOUT");
        assertStringIncludes(body.error, "deadline");
        assertStringIncludes(body.error, "non-cooperative");
      } finally {
        clearTimeout(guard);
        settle?.();
      }
    });
  }

  // veryfront/veryfront-issue-inbox#2100: the API numbers attempts under backoff_limit.
  it("#2100 hands the invocation attempt to the task runner", async () => {
    let receivedAttempt: number | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: (options) => {
        receivedAttempt = options.attempt;
        return Promise.resolve({ success: true, result: null, durationMs: 1 });
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_attempt/execute",
      {
        runId: "run_attempt",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-1",
        attempt: 3,
      },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(receivedAttempt, 3);
  });

  for (const attempt of [0, -1, 1.5, "2"]) {
    it(`#2100 rejects an invalid attempt number: ${JSON.stringify(attempt)}`, async () => {
      let started = false;
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: () => {
          started = true;
          return Promise.resolve({ success: true, durationMs: 0 });
        },
      }));
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_attempt/execute",
        {
          runId: "run_attempt",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          attempt,
        },
      );

      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      assertEquals(result.response.status, 400);
      assertEquals(started, false);
    });
  }

  for (const retryable of [true, undefined]) {
    it(`#2100 answers a ${retryable ? "RetryableError" : "final"} task failure with retryable: ${retryable}`, async () => {
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: () =>
          Promise.resolve({
            success: false,
            error: "Transient failure on attempt 1",
            durationMs: 1,
            ...(retryable ? { retryable } : {}),
          }),
      }));
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_retryable/execute",
        {
          runId: "run_retryable",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          attempt: 1,
        },
      );

      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.success, false);
      assertEquals(body.retryable, retryable);
    });
  }

  // veryfront/veryfront-issue-inbox#2105: business input is any JSON value and reaches the
  // task separately from config.
  it("#2091 forwards non-object task input to the runner", async () => {
    let received: { input?: unknown; config?: unknown } = {};
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: (options) => {
        received = { input: options.input, config: options.config };
        return Promise.resolve({ success: true, result: options.input, durationMs: 1 });
      },
    }));
    const body = {
      runId: "run_task_input",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      config: { dry_run: true },
      input: ["INV-7731", "Harbor Office"],
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_input/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(received, { input: ["INV-7731", "Harbor Office"], config: { dry_run: true } });
    assertEquals((await result.response.json()).result, ["INV-7731", "Harbor Office"]);
  });

  it("#2108 returns schema identities, violations and the input validation code on the wire", async () => {
    const violation = {
      phase: "output" as const,
      reason: "invalid" as const,
      schema_sha256: "b".repeat(64),
      errors: [{ path: "/confidence", message: "must be number" }],
      detected_at: "2026-09-30T00:00:00.000Z",
    };
    let receivedRunId: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: (options) => {
        receivedRunId = options.runId;
        return Promise.resolve({
          success: true,
          result: { confidence: "high" },
          durationMs: 1,
          inputSchemaSha256: "a".repeat(64),
          outputSchemaSha256: "b".repeat(64),
          schemaViolation: violation,
        });
      },
    }));
    const body = {
      runId: "run_task_schema",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_schema/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(receivedRunId, "run_task_schema");
    assertEquals(payload.input_schema_sha256, "a".repeat(64));
    assertEquals(payload.output_schema_sha256, "b".repeat(64));
    assertEquals(payload.schema_violation, violation);
    assertEquals("error_code" in payload, false);
  });

  it("#2108 omits schema fields for a schema-less task so the response is unchanged", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: () =>
        Promise.resolve({
          success: true,
          result: 1,
          durationMs: 1,
          inputSchemaSha256: null,
          outputSchemaSha256: null,
          schemaViolation: null,
        }),
    }));
    const body = {
      runId: "run_task_plain",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_plain/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(Object.keys(await result.response.json()).sort(), [
      "duration_ms",
      "logs",
      "result",
      "success",
    ]);
  });

  it("#2108 reports INPUT_VALIDATION_FAILED with the validation errors", async () => {
    const errors = [{ path: "/ticketText", message: "must be string" }];
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: () =>
        Promise.resolve({
          success: false,
          error: "input failed inputSchema validation",
          errorCode: "INPUT_VALIDATION_FAILED",
          errorDetail: { errors },
          durationMs: 0,
          inputSchemaSha256: "a".repeat(64),
          outputSchemaSha256: null,
          schemaViolation: null,
        }),
    }));
    const body = {
      runId: "run_task_bad_input",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      input: { ticketText: 42 },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_bad_input/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, false);
    assertEquals(payload.error_code, "INPUT_VALIDATION_FAILED");
    assertEquals(payload.error_detail, { errors });
    assertEquals(payload.result, undefined);
  });

  it("#2105 leaves task input undefined when the request carries none", async () => {
    let received: { hasInput?: boolean } = {};
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: (options) => {
        received = { hasInput: options.input !== undefined };
        return Promise.resolve({ success: true, result: null, durationMs: 1 });
      },
    }));
    const body = {
      runId: "run_task_no_input",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      config: { ticket: "T-legacy" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_no_input/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(received, { hasInput: false });
  });

  for (const input of ["a string", ["INV-7731"], 42, false]) {
    it(`#2105 starts a workflow with non-object input ${JSON.stringify(input)} unchanged`, async () => {
      let startedInput: unknown = "unset";
      const handler = new ProjectRunExecuteHandler(createDeps({
        createWorkflowClient: () => ({
          register: () => {},
          start: (_workflowId: string, received: unknown, options?: { runId?: string }) => {
            startedInput = received;
            return Promise.resolve({ runId: options?.runId ?? "workflow-run" });
          },
          getRun: () => Promise.resolve({ status: "completed", output: null }),
          cancel: async () => {},
          destroy: () => Promise.resolve(),
        }),
      }));
      const body = {
        runId: "run_workflow_array",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
        input,
      };
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_workflow_array/execute",
        body,
      );

      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(startedInput, input);
    });
  }

  it("#2105 starts a workflow with {} when its input is null", async () => {
    let startedInput: unknown = "unset";
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        register: () => {},
        start: (_workflowId: string, received: unknown, options?: { runId?: string }) => {
          startedInput = received;
          return Promise.resolve({ runId: options?.runId ?? "workflow-run" });
        },
        getRun: () => Promise.resolve({ status: "completed", output: null }),
        cancel: async () => {},
        destroy: () => Promise.resolve(),
      }),
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_null/execute",
      {
        runId: "run_workflow_null",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
        input: null,
      },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(startedInput, {});
  });

  it("runs a discovered task and returns canonical runtime execution output", async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    let receivedEnvironmentId: string | undefined;
    let receivedRunId: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async (options) => {
        receivedConfig = options.config;
        receivedEnvironmentId = options.environmentId;
        receivedRunId = options.runId;
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
    assertEquals(receivedRunId, "run_task_1");
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

  // veryfront/veryfront-issue-inbox#2113: an output over 1 MiB never crosses the wire.
  it("fails a result larger than 1 MiB with OUTPUT_TOO_LARGE instead of sending it", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: () =>
        Promise.resolve({ success: true, result: "x".repeat(1_048_575), durationMs: 7 }),
    }));
    const body = {
      runId: "run_task_big",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_big/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: false,
      error: "Run output is 1048577 bytes, over the limit of 1048576 bytes",
      error_code: "OUTPUT_TOO_LARGE",
      error_detail: { size_bytes: 1_048_577, limit_bytes: 1_048_576 },
      duration_ms: 7,
      logs: null,
    });
  });

  it("drops an oversized result from a failed run and keeps its own error", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: () =>
        Promise.resolve({
          success: false,
          result: "x".repeat(1_048_575),
          error: "sync failed",
          durationMs: 7,
        }),
    }));
    const body = {
      runId: "run_task_failed_big",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_failed_big/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(await result.response.json(), {
      success: false,
      error: "sync failed",
      duration_ms: 7,
      logs: null,
    });
  });

  it("sends a result of exactly 1 MiB unchanged", async () => {
    const output = "x".repeat(1_048_574);
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: () => Promise.resolve({ success: true, result: output, durationMs: 7 }),
    }));
    const body = {
      runId: "run_task_at_limit",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_at_limit/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(await result.response.json(), {
      success: true,
      result: output,
      duration_ms: 7,
      logs: null,
    });
  });

  it("sends the measured bytes of a result that would grow if serialized again", async () => {
    const rawJSON = (JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON;
    const output = Array.from({ length: 50_000 }, () => rawJSON("1e20"));
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: () => Promise.resolve({ success: true, result: output, durationMs: 7 }),
    }));
    const body = {
      runId: "run_task_raw_json",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_raw_json/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const text = await result.response.text();
    // 250,001 bytes as checked; parsing and serializing again would make it 1,100,001 bytes.
    assert(text.length < 260_000, `expected the checked serialization, got ${text.length} bytes`);
    assertStringIncludes(text, `"result":[1e20,1e20,`);
    const parsed = JSON.parse(text) as { success: boolean; result: number[] };
    assertEquals(parsed.success, true);
    assertEquals(parsed.result.length, 50_000);
  });

  it("measures and sends the same serialization of a result whose toJSON changes", async () => {
    let serializations = 0;
    const stateful = {
      toJSON: () => (++serializations === 1 ? "small" : "x".repeat(1_048_575)),
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: () => Promise.resolve({ success: true, result: stateful, durationMs: 7 }),
    }));
    const body = {
      runId: "run_task_stateful",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_stateful/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(serializations, 1);
    assertEquals(await result.response.json(), {
      success: true,
      result: "small",
      duration_ms: 7,
      logs: null,
    });
  });

  it("enforces and writes the output cap with intrinsics captured before project code runs", async () => {
    const originalJsonStringify = JSON.stringify;
    const originalTextEncoder = globalThis.TextEncoder;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: () => {
        JSON.stringify = (() => '"poisoned"') as typeof JSON.stringify;
        globalThis.TextEncoder = class {
          encode() {
            return new Uint8Array();
          }
        } as unknown as typeof TextEncoder;
        return Promise.resolve({ success: true, result: "x".repeat(1_048_575), durationMs: 7 });
      },
    }));
    const body = {
      runId: "run_task_poisoned_intrinsics",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_poisoned_intrinsics/execute",
      body,
    );

    try {
      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      assertEquals(await result.response.json(), {
        success: false,
        error: "Run output is 1048577 bytes, over the limit of 1048576 bytes",
        error_code: "OUTPUT_TOO_LARGE",
        error_detail: { size_bytes: 1_048_577, limit_bytes: 1_048_576 },
        duration_ms: 7,
        logs: null,
      });
    } finally {
      JSON.stringify = originalJsonStringify;
      globalThis.TextEncoder = originalTextEncoder;
    }
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

  it("runs the default knowledge ingest executor and uploads its generated document", async () => {
    const body = {
      runId: "run_knowledge_default",
      kind: "task",
      target: "task:knowledge-ingest",
      projectId: "proj-1",
      config: { paths: ["uploads/guide.md"], slug: "guide" },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_knowledge_default/execute",
      body,
      { "x-token": "test-token" },
    );
    const uploads: Array<{ url: string; body: Record<string, unknown> }> = [];

    const result = await withMockFetch(
      (async (input, init) => {
        const url = typeof input === "string"
          ? input
          : input instanceof Request
          ? input.url
          : input.toString();
        if (url.endsWith("/projects/demo-project/uploads/uploads%2Fguide.md/url")) {
          return new Response(
            JSON.stringify({
              signed_url: "https://signed.example.test/guide.md",
              expires_at: "2026-09-30T23:00:00.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "https://signed.example.test/guide.md") {
          return new Response("# Guide\n\nCancellation-safe knowledge.", { status: 200 });
        }
        assertStringIncludes(url, "/projects/demo-project/files/knowledge%2Fguide.md");
        uploads.push({ url, body: requestJsonBody(init) ?? {} });
        return new Response(JSON.stringify({ path: "knowledge/guide.md" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
      async () =>
        await new ProjectRunExecuteHandler().handle(
          signed.request,
          createCtx(signed.publicKeyPem),
        ),
    );

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, true, JSON.stringify(payload));
    assertEquals(payload.result.summary.ingested_count, 1);
    assertEquals(uploads.length, 1);
    assertStringIncludes(String(uploads[0]?.body.content), "Cancellation-safe knowledge.");
  });

  it("aborts a pending knowledge upload listing before downloads or writes start", async () => {
    const controller = new AbortController();
    const listingStarted = Promise.withResolvers<void>();
    let listingSignal: AbortSignal | undefined;
    let laterRequests = 0;
    const signed = await signedRequest(
      "/api/control-plane/runs/run_knowledge_cancel_listing/execute",
      {
        runId: "run_knowledge_cancel_listing",
        kind: "task",
        target: "task:knowledge-ingest",
        projectId: "proj-1",
        config: { path_prefix: "uploads", recursive: true },
      },
      { "x-token": "test-token" },
    );
    const request = new Request(signed.request, { signal: controller.signal });

    const pending = withMockFetch(
      ((_input, init) => {
        laterRequests++;
        const signal = observeFetchRequestInit(init).signal ?? undefined;
        listingSignal = signal;
        listingStarted.resolve();
        if (!signal) return Promise.reject(new Error("missing abort signal"));
        return new Promise<Response>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        );
      }) as typeof fetch,
      async () =>
        await new ProjectRunExecuteHandler().handle(
          request,
          createCtx(signed.publicKeyPem),
        ),
    );

    await listingStarted.promise;
    controller.abort(new Error("run cancelled"));
    const result = await pending;

    assertExists(result.response);
    assertEquals((await result.response.json()).success, false);
    assertExists(listingSignal);
    assertEquals(listingSignal.aborted, true);
    assertEquals(laterRequests, 1);
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

  it("runs the default dependency artifact executor and publishes its graph", async () => {
    const body = {
      runId: "run_dependency_artifact_default",
      kind: "task",
      target: "task:dependency-artifact-build",
      projectId: "proj-1",
      config: {
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
      },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_dependency_artifact_default/execute",
      body,
      { "x-token": "test-token" },
    );
    let uploads = 0;
    let publications = 0;

    const result = await withMockFetch(
      (async (input) => {
        const url = String(input);
        if (url.startsWith("https://esm.sh/")) {
          return new Response("export const ready = true;", {
            status: 200,
            headers: { "Content-Type": "text/javascript" },
          });
        }
        if (url.includes("/assets/")) {
          uploads++;
          return new Response(JSON.stringify({ stored: true, existed: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/result")) {
          publications++;
          return new Response(JSON.stringify({ accepted: true, state: "ready" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch,
      async () =>
        await new ProjectRunExecuteHandler().handle(
          signed.request,
          createCtx(signed.publicKeyPem),
        ),
    );

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, true);
    assertEquals(payload.result.state, "ready");
    assertEquals(uploads, 1);
    assertEquals(publications, 1);
  });

  it("aborts an in-flight dependency asset upload and never publishes the result", async () => {
    const controller = new AbortController();
    const uploadStarted = Promise.withResolvers<void>();
    let uploadSignal: AbortSignal | undefined;
    let publications = 0;
    const body = {
      runId: "run_dependency_artifact_cancel_upload",
      kind: "task",
      target: "task:dependency-artifact-build",
      projectId: "proj-1",
      config: {
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
      },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_dependency_artifact_cancel_upload/execute",
      body,
      { "x-token": "test-token" },
    );
    const request = new Request(signed.request, { signal: controller.signal });

    const pending = withMockFetch(
      ((input, init) => {
        const url = String(input);
        if (url.startsWith("https://esm.sh/")) {
          return Promise.resolve(
            new Response("export const ready = true;", {
              status: 200,
              headers: { "Content-Type": "text/javascript" },
            }),
          );
        }
        if (url.includes("/assets/")) {
          const signal = observeFetchRequestInit(init).signal ?? undefined;
          uploadSignal = signal;
          uploadStarted.resolve();
          if (!signal) return Promise.reject(new Error("missing abort signal"));
          return new Promise<Response>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            })
          );
        }
        if (url.endsWith("/result")) publications++;
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }) as typeof fetch,
      async () =>
        await new ProjectRunExecuteHandler().handle(request, createCtx(signed.publicKeyPem)),
    );

    await uploadStarted.promise;
    controller.abort(new Error("run cancelled"));
    const result = await pending;

    assertExists(result.response);
    assertEquals((await result.response.json()).success, false);
    assertEquals(uploadSignal?.aborted, true);
    assertEquals(publications, 0);
  });

  it("does not continue a release asset build after its start request is cancelled", async () => {
    const controller = new AbortController();
    const body = {
      runId: "run_release_asset_cancelled",
      kind: "task",
      target: "task:release-asset-build",
      projectId: "proj-1",
      config: { release_id: "release-1", release_version: 1 },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_release_asset_cancelled/execute",
      body,
      { "x-token": "test-token" },
    );
    const request = new Request(signed.request, { signal: controller.signal });
    const ctx = createCtx(signed.publicKeyPem);
    ctx.config = {};
    let fetchCalls = 0;

    const result = await withMockFetch(
      (async (input) => {
        fetchCalls++;
        assertStringIncludes(String(input), "/releases/release-1/asset-manifest/builds");
        controller.abort(new Error("run cancelled"));
        return new Response(
          JSON.stringify({ id: "build-1", manifest_version: 1, state: "building" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, ctx),
    );

    assertExists(result.response);
    assertEquals((await result.response.json()).success, false);
    assertEquals(fetchCalls, 1);
  });

  it("runs the default release asset executor through upload and manifest publication", async () => {
    const body = {
      runId: "run_release_asset_default",
      kind: "task",
      target: "task:release-asset-build",
      projectId: "proj-1",
      config: { release_id: "release-1", release_version: 1 },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_release_asset_default/execute",
      body,
      { "x-token": "test-token" },
    );
    const ctx = createCtx(signed.publicKeyPem);
    ctx.config = {};
    const requests: string[] = [];

    const result = await withMockFetch(
      (async (input, init) => {
        const url = String(input);
        requests.push(`${observeFetchRequestInit(init).method ?? "GET"} ${url}`);
        if (url.endsWith("/asset-manifest/builds")) {
          return new Response(
            JSON.stringify({ id: "build-1", manifest_version: 1, state: "building" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/releases/release-1/files?")) {
          return new Response(
            JSON.stringify({
              data: [{
                id: "file-1",
                version_id: "version-1",
                path: "pages/index.tsx",
                content: "export default function Page() { return null; }",
                type: "page",
                size: 49,
                updated_at: "2026-09-30T00:00:00.000Z",
              }],
              page_info: { self: null, first: null, next: null, prev: null },
              release_id: "release-1",
              release_version: "1",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/asset-manifest/assets")) {
          return new Response(JSON.stringify({ stored: true, existed: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/asset-manifest")) {
          return new Response(JSON.stringify({ state: "ready", manifest_version: 1 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch,
      async () => await new ProjectRunExecuteHandler().handle(signed.request, ctx),
    );

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, true, payload.error);
    assertEquals(payload.result.state, "ready");
    assertEquals(requests.some((request) => request.includes("asset-manifest/assets")), true);
    assertEquals(requests.some((request) => request.startsWith("PUT ")), true);
  });

  it("aborts an in-flight release asset upload and never publishes the manifest", async () => {
    const controller = new AbortController();
    const uploadStarted = Promise.withResolvers<void>();
    let uploadSignal: AbortSignal | undefined;
    let manifestPuts = 0;
    const body = {
      runId: "run_release_asset_cancel_upload",
      kind: "task",
      target: "task:release-asset-build",
      projectId: "proj-1",
      config: { release_id: "release-1", release_version: 1 },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_release_asset_cancel_upload/execute",
      body,
      { "x-token": "test-token" },
    );
    const request = new Request(signed.request, { signal: controller.signal });
    const ctx = createCtx(signed.publicKeyPem);
    ctx.config = {};

    const pending = withMockFetch(
      ((input, init) => {
        const url = String(input);
        if (url.endsWith("/asset-manifest/builds")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: "build-1", manifest_version: 1, state: "building" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (url.includes("/releases/release-1/files?")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{
                  id: "file-1",
                  version_id: "version-1",
                  path: "pages/index.tsx",
                  content: "export default function Page() { return null; }",
                  type: "page",
                  size: 49,
                  updated_at: "2026-09-30T00:00:00.000Z",
                }],
                page_info: { self: null, first: null, next: null, prev: null },
                release_id: "release-1",
                release_version: "1",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (url.endsWith("/asset-manifest/assets")) {
          const signal = observeFetchRequestInit(init).signal ?? undefined;
          uploadSignal = signal;
          uploadStarted.resolve();
          if (!signal) return Promise.reject(new Error("missing abort signal"));
          return new Promise<Response>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            })
          );
        }
        if (
          url.endsWith("/asset-manifest") && observeFetchRequestInit(init).method === "PUT"
        ) manifestPuts++;
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }) as typeof fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, ctx),
    );

    await uploadStarted.promise;
    controller.abort(new Error("run cancelled"));
    const result = await pending;

    assertExists(result.response);
    assertEquals((await result.response.json()).success, false);
    assertEquals(uploadSignal?.aborted, true);
    assertEquals(manifestPuts, 0);
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

  it("preserves the style build failure when failed-status reporting is unavailable", async () => {
    const body = {
      runId: "run_style_artifact_failure_report_unavailable",
      kind: "task",
      target: "task:style-artifact-build",
      projectId: "proj-1",
      config: {
        environment_name: "Preview",
        style_profile_hash: "queued-profile-hash",
      },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_style_artifact_failure_report_unavailable/execute",
      body,
      { "x-token": "test-token" },
    );
    const { ctx } = createStyleArtifactCtx(publicKeyPem, {
      files: [],
      stylesheet: "@tailwind utilities;",
    });

    const result = await withMockFetch(
      (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "style result API unavailable" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, ctx),
    );

    assertExists(result.response);
    const json = await result.response.json();
    assertEquals(json.success, false);
    assertStringIncludes(json.error, "Style profile hash mismatch");
  });

  it("preserves cancellation while a style build failure is being reported", async () => {
    const controller = new AbortController();
    const reportingStarted = Promise.withResolvers<void>();
    const body = {
      runId: "run_style_artifact_cancel_failure_report",
      kind: "task",
      target: "task:style-artifact-build",
      projectId: "proj-1",
      config: {
        environment_name: "Preview",
        style_profile_hash: "queued-profile-hash",
      },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_style_artifact_cancel_failure_report/execute",
      body,
      { "x-token": "test-token" },
    );
    const request = new Request(signed.request, { signal: controller.signal });
    const { ctx } = createStyleArtifactCtx(signed.publicKeyPem, {
      files: [],
      stylesheet: "@tailwind utilities;",
    });

    const pending = withMockFetch(
      ((_input, init) => {
        const signal = observeFetchRequestInit(init).signal;
        reportingStarted.resolve();
        if (!signal) return Promise.reject(new Error("missing abort signal"));
        return new Promise<Response>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        );
      }) as typeof fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, ctx),
    );

    await reportingStarted.promise;
    controller.abort(new Error("run cancelled during failed style reporting"));
    const result = await pending;

    assertExists(result.response);
    const json = await result.response.json();
    assertEquals(json.success, false);
    assertEquals(json.error, "run cancelled during failed style reporting");
  });

  it("does not publish a ready or failed style artifact after cancellation", async () => {
    const controller = new AbortController();
    const body = {
      runId: "run_style_artifact_cancelled",
      kind: "task",
      target: "task:style-artifact-build",
      projectId: "proj-1",
      config: { environment_name: "Preview" },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_style_artifact_cancelled/execute",
      body,
      { "x-token": "test-token" },
    );
    const request = new Request(signed.request, { signal: controller.signal });
    const { ctx } = createStyleArtifactCtx(signed.publicKeyPem, {
      files: [{
        path: "pages/index.tsx",
        content: 'export default function Page() { return <main className="px-4">Hi</main>; }',
      }],
      stylesheet: "@tailwind utilities;",
      onGetAllSourceFiles: () => controller.abort(new Error("run cancelled")),
    });
    const recorder = createStyleArtifactFetchRecorder();

    const result = await withMockFetch(
      recorder.fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, ctx),
    );

    assertExists(result.response);
    assertEquals((await result.response.json()).success, false);
    assertEquals(recorder.upserts, []);
  });

  it("aborts an in-flight style artifact publication", async () => {
    const controller = new AbortController();
    const publicationStarted = Promise.withResolvers<void>();
    let publicationSignal: AbortSignal | undefined;
    const body = {
      runId: "run_style_artifact_cancel_publication",
      kind: "task",
      target: "task:style-artifact-build",
      projectId: "proj-1",
      config: { environment_name: "Preview" },
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_style_artifact_cancel_publication/execute",
      body,
      { "x-token": "test-token" },
    );
    const request = new Request(signed.request, { signal: controller.signal });
    const { ctx } = createStyleArtifactCtx(signed.publicKeyPem, {
      files: [{
        path: "pages/index.tsx",
        content: 'export default function Page() { return <main className="px-4">Hi</main>; }',
      }],
      stylesheet: "@tailwind utilities;",
    });

    const pending = withMockFetch(
      ((_input, init) => {
        const signal = observeFetchRequestInit(init).signal ?? undefined;
        publicationSignal = signal;
        publicationStarted.resolve();
        if (!signal) return Promise.reject(new Error("missing abort signal"));
        return new Promise<Response>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        );
      }) as typeof fetch,
      async () => await new ProjectRunExecuteHandler().handle(request, ctx),
    );

    await publicationStarted.promise;
    controller.abort(new Error("run cancelled"));
    const result = await pending;

    assertExists(result.response);
    assertEquals((await result.response.json()).success, false);
    assertEquals(publicationSignal?.aborted, true);
  });

  it("runs a discovered workflow with the canonical run id and input", async () => {
    let started:
      | {
        workflowId: string;
        input: unknown;
        options?: { runId?: string; [CONTROL_PLANE_OWNED_START]?: true };
      }
      | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        register: () => {},
        start: async (
          workflowId: string,
          input: unknown,
          options?: { runId?: string; [CONTROL_PLANE_OWNED_START]?: true },
        ) => {
          started = { workflowId, input, options };
          return { runId: options?.runId ?? "workflow-run" };
        },
        getRun: async () => ({
          status: "completed",
          output: { deployed: true },
        }),
        cancel: async () => {},
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
      options: { runId: "run_workflow_1", [CONTROL_PLANE_OWNED_START]: true },
    });
  });

  it("runs task:eval through the task runner and returns its summary and report artifact", async () => {
    const report: EvalReport = {
      kind: "eval-report",
      runId: "run_task_eval_1",
      definitionId: "eval:deep-research",
      targetKind: "agent",
      target: "agent:researcher",
      startedAt: "2026-09-30T10:00:00.000Z",
      endedAt: "2026-09-30T10:00:01.000Z",
      summary: { records: 2, passed: 2, failed: 0, passRate: 1, metrics: [] },
      records: [],
    };
    const reportPath = "evals/reports/deep-research/run_task_eval_1.json";
    let receivedEvalId: string | undefined;
    let receivedRepetitions: number | undefined;
    let receivedTaskId: string | undefined;
    let receivedAgentId: string | null | undefined;
    let receivedAuthToken: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async (options) => {
        receivedTaskId = options.task.id;
        return await runTaskDefinition(options);
      },
      findEvalById: async (evalId, options) => {
        receivedEvalId = evalId;
        return await createDeps().findEvalById(evalId, options);
      },
      runEval: async (definition, options) => {
        receivedRepetitions = definition.repetitions;
        options.onProgress?.({
          type: "record-finished",
          evalId: "eval:private-customer\nforged-eval-row",
          recordId: "session-123\nforged-record-row",
          exampleId: "customer-456\nforged-example-row",
          repetition: 1,
          index: 0,
          total: 2,
          completed: true,
          durationMs: 10,
        });
        options.onProgress?.({
          type: "record-finished",
          evalId: definition.id,
          recordId: "q1:2",
          exampleId: "q1",
          repetition: 2,
          index: 1,
          total: 2,
          completed: true,
          durationMs: 11,
        });
        return report;
      },
      createEvalAgentAdapter: (config) => {
        receivedAgentId = config.agentId;
        receivedAuthToken = config.authToken;
        return async () => ({ text: "Paris" });
      },
      uploadEvalReport: async () => reportPath,
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_eval_1/execute",
      {
        runId: "run_task_eval_1",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        config: { eval_id: "eval:deep-research", repetitions: 2 },
      },
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const payload = await result.response.json();
    assertEquals(payload.success, true);
    assertEquals(payload.result, report.summary);
    assertEquals(payload.artifacts, [await expectedReportArtifact(report, reportPath)]);
    assertEquals(String(payload.logs).split("\n"), [
      '{"level":"info","message":"Eval case completed","case_index":1,"total_cases":2,"repetition":1}',
      '{"level":"info","message":"Eval case completed","case_index":2,"total_cases":2,"repetition":2}',
    ]);
    assertEquals(String(payload.logs).includes("private-customer"), false);
    assertEquals(String(payload.logs).includes("session-123"), false);
    assertEquals(String(payload.logs).includes("customer-456"), false);
    assertEquals(String(payload.logs).split("\n").length, 2);
    assertEquals(receivedTaskId, "eval");
    assertEquals(receivedEvalId, "eval:deep-research");
    assertEquals(receivedRepetitions, 2);
    assertEquals(receivedAgentId, "researcher");
    assertEquals(receivedAuthToken, "runtime-token");
  });

  for (
    const uploadFailure of [
      {
        name: "returns no artifact path",
        upload: () => Promise.resolve(null),
        error: "Eval report upload failed: report was not stored",
      },
      {
        name: "rejects",
        upload: () => Promise.reject(new Error("project file service unavailable")),
        error: "Eval report upload failed: project file service unavailable",
      },
    ]
  ) {
    it(`fails task:eval when report upload ${uploadFailure.name}`, async () => {
      const report: EvalReport = {
        kind: "eval-report",
        runId: "run_task_eval_upload_failed",
        definitionId: "eval:deep-research",
        targetKind: "agent",
        target: "agent:researcher",
        startedAt: "2026-09-30T10:00:00.000Z",
        endedAt: "2026-09-30T10:00:01.000Z",
        summary: { records: 1, passed: 1, failed: 0, passRate: 1, metrics: [] },
        records: [],
      };
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: runTaskDefinition,
        runEval: async () => report,
        uploadEvalReport: uploadFailure.upload,
      }));
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_task_eval_upload_failed/execute",
        {
          runId: "run_task_eval_upload_failed",
          kind: "task",
          target: "task:eval",
          projectId: "proj-1",
          config: { eval_id: "eval:deep-research" },
        },
        { "x-token": "runtime-token" },
      );

      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      const payload = await result.response.json();
      assertEquals(payload.success, false);
      assertEquals(payload.error, uploadFailure.error);
      assertEquals(payload.result, report.summary);
      assertEquals(payload.artifacts, undefined);
    });
  }

  const cyclicEvalInput: Record<string, unknown> = {};
  cyclicEvalInput.self = cyclicEvalInput;
  for (
    const invalidInput of [{ name: "bigint", input: 1n }, { name: "cycle", input: cyclicEvalInput }]
  ) {
    it(`preserves the completed eval summary when ${invalidInput.name} prevents report serialization`, async () => {
      let uploads = 0;
      const report: EvalReport = {
        kind: "eval-report",
        runId: "run_eval_unserializable",
        definitionId: "eval:deep-research",
        targetKind: "agent",
        target: "agent:researcher",
        startedAt: "2026-09-30T10:00:00.000Z",
        endedAt: "2026-09-30T10:00:01.000Z",
        summary: { records: 1, passed: 1, failed: 0, passRate: 1, metrics: [] },
        records: [{
          id: "q1:1",
          evalId: "eval:deep-research",
          exampleId: "q1",
          repetition: 1,
          input: invalidInput.input,
          output: "Paris",
          metadata: {},
          trace: { events: [], toolCalls: [] },
          usage: {},
          durationMs: 10,
          completed: true,
        }],
      };
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: runTaskDefinition,
        runEval: async () => report,
        uploadEvalReport: async () => {
          uploads++;
          return "evals/report.json";
        },
      }));
      const signed = await signedRequest(
        "/api/control-plane/runs/run_eval_unserializable/execute",
        {
          runId: "run_eval_unserializable",
          kind: "task",
          target: "task:eval",
          projectId: "proj-1",
          config: { eval_id: "eval:deep-research" },
        },
        { "x-token": "runtime-token" },
      );
      const result = await handler.handle(signed.request, createCtx(signed.publicKeyPem));
      assertExists(result.response);
      const payload = await result.response.json();
      assertEquals(payload.success, false);
      assertEquals(payload.result, report.summary);
      assertStringIncludes(payload.error, "Eval report upload failed:");
      assertStringIncludes(payload.logs, "Eval report upload failed:");
      assertEquals(payload.artifacts, undefined);
      assertEquals(uploads, 0);
    });
  }

  for (const cancelled of [true, false]) {
    it(`eval report upload ${cancelled ? "aborts while pending" : "succeeds exactly once"}`, async () => {
      const uploadStarted = Promise.withResolvers<void>();
      const finishUpload = Promise.withResolvers<void>();
      let uploads = 0;
      let written = false;
      let uploadSignal: AbortSignal | undefined;
      const report: EvalReport = {
        kind: "eval-report",
        runId: "run_eval_report_upload",
        definitionId: "eval:deep-research",
        targetKind: "agent",
        target: "agent:researcher",
        startedAt: "2026-09-30T10:00:00.000Z",
        endedAt: "2026-09-30T10:00:01.000Z",
        summary: { records: 1, passed: 1, failed: 0, passRate: 1, metrics: [] },
        records: [],
      };
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: runTaskDefinition,
        runEval: async () => report,
        uploadEvalReport: async (input) => {
          uploads++;
          uploadSignal = input.signal;
          uploadStarted.resolve();
          await finishUpload.promise;
          uploadSignal?.throwIfAborted();
          written = true;
          return input.reportPath;
        },
      }));
      const signed = await signedRequest(
        "/api/control-plane/runs/run_eval_report_upload/execute",
        {
          runId: "run_eval_report_upload",
          kind: "task",
          target: "task:eval",
          projectId: "proj-1",
          config: { eval_id: "eval:deep-research" },
        },
        { "x-token": "runtime-token" },
      );
      const controller = new AbortController();
      const request = new Request(signed.request, { signal: controller.signal });
      const pending = handler.handle(request, createCtx(signed.publicKeyPem));
      await uploadStarted.promise;
      if (cancelled) controller.abort(new Error("Run cancelled"));
      finishUpload.resolve();
      const result = await pending;
      assertExists(result.response);
      const payload = await result.response.json();
      assertExists(uploadSignal);
      assertEquals(uploadSignal.aborted, cancelled);
      assertEquals(uploads, 1);
      assertEquals(written, !cancelled);
      assertEquals(payload.success, !cancelled);
      if (cancelled) {
        assertStringIncludes(payload.error, "cancelled");
        assertEquals(payload.artifacts, undefined);
      } else {
        assertEquals(
          payload.artifacts[0].path,
          "evals/reports/deep-research/run_eval_report_upload.json",
        );
      }
    });
  }

  for (const cancelled of [true, false]) {
    it(`eval report upload HTTP transport ${cancelled ? "receives cancellation" : "stores one report"}`, async () => {
      const uploadStarted = Promise.withResolvers<void>();
      const finishUpload = Promise.withResolvers<void>();
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: runTaskDefinition,
        uploadEvalReport: async (input) => {
          uploadedContent = `${
            JSON.stringify({ ...input.report, reportPath: input.reportPath }, null, 2)
          }\n`;
          return await uploadEvalReportToProjectFiles(input);
        },
      }));
      const signed = await signedRequest(
        "/api/control-plane/runs/run_eval_report_http/execute",
        {
          runId: "run_eval_report_http",
          kind: "task",
          target: "task:eval",
          projectId: "proj-1",
          config: { eval_id: "eval:deep-research" },
        },
        { "x-token": "runtime-token" },
      );
      const controller = new AbortController();
      const request = new Request(signed.request, { signal: controller.signal });
      let written = false;
      let uploads = 0;
      let uploadedContent = "";
      let signal: AbortSignal | null | undefined;
      const result = await withMockFetch(async (url, init) => {
        const options = observeFetchRequestInit(init);
        assertStringIncludes(String(url), "/files/evals%2Freports%2Fdeep-research%2F");
        assertEquals(options.method, "PUT");
        signal = options.signal;
        uploads++;
        uploadStarted.resolve();
        await finishUpload.promise;
        signal?.throwIfAborted();
        written = true;
        return Response.json({ path: "evals/reports/deep-research/run_eval_report_http.json" });
      }, async () => {
        const pending = handler.handle(request, createCtx(signed.publicKeyPem));
        await uploadStarted.promise;
        if (cancelled) controller.abort(new Error("Run cancelled"));
        finishUpload.resolve();
        return await pending;
      });
      assertExists(signal);
      assertEquals(signal.aborted, cancelled);
      assertEquals(uploads, 1);
      assertEquals(written, !cancelled);
      assertExists(result.response);
      const payload = await result.response.json();
      assertEquals(payload.success, !cancelled);
      if (cancelled) {
        assertStringIncludes(payload.error, "cancelled");
        assertEquals(payload.artifacts, undefined);
      } else {
        assertEquals(payload.artifacts[0].sha256, await computeHash(uploadedContent));
        assertEquals(
          payload.artifacts[0].size_bytes,
          new TextEncoder().encode(uploadedContent).byteLength,
        );
        assertEquals(
          payload.artifacts[0].path,
          "evals/reports/deep-research/run_eval_report_http.json",
        );
      }
    });
  }

  it("reports a clear error when task:eval names an unknown eval", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({ runTask: runTaskDefinition }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_eval_missing/execute",
      {
        runId: "run_task_eval_missing",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        config: { eval_id: "eval:missing" },
      },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(await result.response.json(), {
      success: false,
      error: "Eval not found: eval:missing",
      logs: null,
      duration_ms: 0,
    });
  });

  it("rejects the retired eval run kind and points callers to task:eval", async () => {
    const handler = new ProjectRunExecuteHandler();
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_legacy/execute",
      {
        runId: "run_eval_legacy",
        kind: "eval",
        target: "eval:deep-research",
        projectId: "proj-1",
      },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertStringIncludes(await result.response.text(), "task:eval");
  });

  it("reports task:eval as cancelled and does not begin another case", async () => {
    const startedCases: string[] = [];
    const firstCaseFinished = Promise.withResolvers<void>();
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      runEval: async (definition, options) => {
        const signal = options.signal;
        startedCases.push("q1");
        options.onProgress?.({
          type: "record-finished",
          evalId: definition.id,
          recordId: "q1:1",
          exampleId: "q1",
          repetition: 1,
          index: 0,
          total: 2,
          completed: true,
          durationMs: 1,
        });
        firstCaseFinished.resolve();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        startedCases.push("q2");
        throw new Error("unreachable");
      },
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_task_eval_cancel/execute",
      {
        runId: "run_task_eval_cancel",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        config: { eval_id: "eval:deep-research" },
      },
      { "x-token": "runtime-token" },
    );
    const controller = new AbortController();
    const request = new Request(signed.request, { signal: controller.signal });

    const pending = handler.handle(request, createCtx(signed.publicKeyPem));
    await firstCaseFinished.promise;
    controller.abort(new Error("Run cancelled"));
    const result = await pending;

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, false);
    assertStringIncludes(payload.error, "cancelled");
    assertEquals(
      payload.logs,
      '{"level":"info","message":"Eval case completed","case_index":1,"total_cases":2,"repetition":1}',
    );
    assertEquals(startedCases, ["q1"]);
  });

  it("bounds task:eval progress logs and emits one eval truncation marker", async () => {
    const report: EvalReport = {
      kind: "eval-report",
      runId: "run_task_eval_many_cases",
      definitionId: "eval:deep-research",
      targetKind: "agent",
      target: "agent:researcher",
      startedAt: "2026-09-30T10:00:00.000Z",
      endedAt: "2026-09-30T10:00:01.000Z",
      summary: { records: 2_000, passed: 2_000, failed: 0, passRate: 1, metrics: [] },
      records: [],
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      runEval: async (definition, options) => {
        for (let index = 0; index < 2_000; index += 1) {
          options.onProgress?.({
            type: "record-finished",
            evalId: definition.id,
            recordId: `private-record-${index}`,
            exampleId: `private-example-${index}`,
            repetition: 1,
            index,
            total: 2_000,
            completed: true,
            durationMs: 1,
          });
        }
        return report;
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_eval_many_cases/execute",
      {
        runId: "run_task_eval_many_cases",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        config: { eval_id: "eval:deep-research" },
      },
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    const lines = String(payload.logs).split("\n");
    assertEquals(lines.length, 1_001);
    assertEquals(
      lines.filter((line) => line.includes("Eval progress logs were truncated")).length,
      1,
    );
    assertEquals(String(payload.logs).includes("private-example"), false);
    assertEquals(String(payload.logs).includes("private-record"), false);
  });

  it("fails task:eval with RUN_TIMEOUT when its task deadline expires", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      runEval: async (_definition, options) => {
        const signal = options.signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        throw new Error("unreachable");
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_task_eval_timeout/execute",
      {
        runId: "run_task_eval_timeout",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        config: { eval_id: "eval:deep-research" },
        deadlineAt: new Date(Date.now() + 25).toISOString(),
      },
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, false);
    assertEquals(payload.error_code, "RUN_TIMEOUT");
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
      runTask: runTaskDefinition,
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
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
      input: { dataset: "smoke" },
      config: { eval_id: "eval:deep-research", repetitions: 2 },
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
      result: report.summary,
      artifacts: [
        await expectedReportArtifact(
          report,
          "evals/reports/deep-research/run_eval_1.json",
          "evals/reports/default.json",
        ),
      ],
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

  it("rejects schema-invalid eval input before the eval executes", async () => {
    let executed = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      findEvalById: async () => ({
        id: "eval:invoice-lookup",
        name: "Invoice lookup",
        filePath: "evals/invoice-lookup.eval.ts",
        exportName: "default",
        definition: evalAgent({
          id: "eval:invoice-lookup",
          target: "agent:invoice-lookup",
          dataset: datasets.inline([{ id: "invoice-1", input: "Find an invoice" }]),
          inputSchema: defineSchema((v) => v.object({ invoiceId: v.string() }))(),
        }),
      }),
      runEval: async () => {
        executed = true;
        throw new Error("eval must not execute");
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_invalid_input/execute",
      {
        runId: "run_eval_invalid_input",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        input: { invoiceId: 42 },
        config: { eval_id: "eval:invoice-lookup" },
      },
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const body = await result.response.json();
    assertEquals(body.success, false);
    assertEquals(body.error_code, "INPUT_VALIDATION_FAILED");
    assertEquals(body.error_detail.errors.length, 1);
    assertEquals(body.error_detail.errors[0].path, "/invoiceId");
    assertEquals(executed, false);
  });

  it("executes an eval whose run input matches its schema", async () => {
    let executed = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      findEvalById: async () => ({
        id: "eval:invoice-lookup",
        name: "Invoice lookup",
        filePath: "evals/invoice-lookup.eval.ts",
        exportName: "default",
        definition: evalAgent({
          id: "eval:invoice-lookup",
          target: "agent:invoice-lookup",
          dataset: datasets.inline([{ id: "invoice-1", input: "Find an invoice" }]),
          inputSchema: defineSchema((v) => v.object({ invoiceId: v.string() }))(),
        }),
      }),
      runEval: async (definition, options) => {
        executed = true;
        return createDeps().runEval(definition, options);
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_valid_input/execute",
      {
        runId: "run_eval_valid_input",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        input: { invoiceId: "INV-7731" },
        config: { eval_id: "eval:invoice-lookup" },
      },
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals((await result.response.json()).success, true);
    assertEquals(executed, true);
  });

  it("executes a schema-less eval with any JSON run input", async () => {
    let executed = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      runEval: async (definition, options) => {
        executed = true;
        return createDeps().runEval(definition, options);
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_schema_less/execute",
      {
        runId: "run_eval_schema_less",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        input: ["any", { json: true }, 42],
        config: { eval_id: "eval:deep-research" },
      },
      { "x-token": "runtime-token" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals((await result.response.json()).success, true);
    assertEquals(executed, true);
  });

  it("parses the eval step ceiling with intrinsics captured before project discovery", async () => {
    const definition = evalAgent({
      id: "eval:deep-research",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
    });
    const originalIsFinite = Number.isFinite;
    const originalParseInt = Number.parseInt;
    const originalTrim = String.prototype.trim;
    const originalTrunc = Math.trunc;
    let receivedMaxSteps: number | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      findEvalById: async () => ({
        id: "eval:deep-research",
        name: "Deep research quality",
        filePath: "evals/deep-research.eval.ts",
        exportName: "default",
        definition,
      }),
      ensureProjectDiscovery: async () => {
        Number.isFinite = () => false;
        Number.parseInt = () => 99;
        String.prototype.trim = function (): string {
          return String(this) === "2.9" ? "" : Reflect.apply(originalTrim, this, []);
        };
        Math.trunc = () => 99;
        return createEmptyDiscoveryResult();
      },
      createEvalAgentAdapter: (config) => {
        receivedMaxSteps = config.maxSteps;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_intrinsic_step_limit",
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      config: { eval_id: "eval:deep-research", max_steps: "2.9" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_intrinsic_step_limit/execute",
      body,
      { "x-token": "runtime-token" },
    );

    let result;
    try {
      result = await handler.handle(request, createCtx(publicKeyPem));
    } finally {
      Number.isFinite = originalIsFinite;
      Number.parseInt = originalParseInt;
      String.prototype.trim = originalTrim;
      Math.trunc = originalTrunc;
    }

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals((await result.response.json()).success, true);
    assertEquals(receivedMaxSteps, 2);
  });

  it("runs a dataset eval without a runtime API token", async () => {
    let adapterCreated = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
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
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        config: { eval_id: "eval:dataset" },
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
      runTask: runTaskDefinition,
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
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      config: { eval_id: "eval:deep-research" },
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
      result: report.summary,
      artifacts: [await expectedReportArtifact(report, reportPath)],
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
      runTask: runTaskDefinition,
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_local_endpoint",
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "http://localhost:4311/api/ag-ui",
      config: { eval_id: "eval:deep-research" },
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
    // Control-plane eval runs carry a runtime ceiling, so the run streams
    // through a framework-rebuilt restricted agent rather than through the
    // source agent's own stream implementation.
    const sourceAgent = createStreamingAgent("researcher", "Paris", {
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
    agentRegistry.register("researcher", {
      ...sourceAgent,
      config: {
        ...sourceAgent.config,
        resolveModelTransport: (request: { context?: Record<string, unknown> }) => {
          capturedContext = request.context;
          return Promise.resolve({
            model: createEvalTransportModel({
              text: "Paris",
              usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
            }),
          });
        },
      } as Agent["config"],
    });
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
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
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "http://localhost:4311/api/ag-ui",
      config: { eval_id: "eval:deep-research" },
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
      assertEquals(payload.result.failed, 0);
      assertEquals(payload.result.usage, {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      });
      assertEquals(capturedContext?.runIdBindsToolAuthorization, false);
    } finally {
      agentRegistry.delete("researcher");
    }
  });

  it("applies forwarded eval tool restrictions to local source agent runs", async () => {
    let sourceAgentStreamCalls = 0;
    let observedToolNames: string[] = [];
    const sourceAgent = createStreamingAgent("researcher", "Paris", undefined, () => {
      sourceAgentStreamCalls += 1;
    });
    agentRegistry.register("researcher", {
      ...sourceAgent,
      config: {
        ...sourceAgent.config,
        tools: {
          eval_allowed_lookup: tool({
            id: "eval_allowed_lookup",
            description: "Allowed by the forwarded eval ceiling.",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => Promise.resolve("ok"),
          }),
          eval_denied_delete: tool({
            id: "eval_denied_delete",
            description: "Denied by the forwarded eval ceiling.",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => Promise.resolve("ok"),
          }),
        },
        providerTools: ["web_search", "web_fetch"],
        mcpServers: [{ kind: "veryfront-api" }],
        maxSteps: 20,
        resolveModelTransport: () =>
          Promise.resolve({
            model: createEvalTransportModel({
              text: "Paris",
              onCall: (options) => {
                observedToolNames = (options.tools ?? [])
                  .map((definition) => definition.name)
                  .toSorted();
              },
            }),
          }),
      } as Agent["config"],
    });

    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
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
      runId: "run_eval_restricted_tools",
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "http://localhost:4311/api/ag-ui",
      config: {
        eval_id: "eval:deep-research",
        allowedTools: ["eval_allowed_lookup", "web_fetch"],
        max_steps: 2,
      },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_restricted_tools/execute",
      body,
      { "x-token": "runtime-token" },
      "http://localhost:4311",
    );
    const nativeRequest = globalThis.Request;
    let replacementSawLocalEvalRequest = false;
    const replacementRequest = function (
      this: Request,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Request {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (
        url === "http://localhost:4311/api/ag-ui" &&
        typeof init?.body === "string"
      ) {
        replacementSawLocalEvalRequest = true;
        const payload = JSON.parse(init.body) as {
          forwardedProps?: { veryfront?: { runtimeOverrides?: unknown } };
        };
        if (payload.forwardedProps?.veryfront) {
          delete payload.forwardedProps.veryfront.runtimeOverrides;
        }
        return new nativeRequest(input, { ...init, body: JSON.stringify(payload) });
      }
      return new nativeRequest(input, init);
    } as unknown as typeof Request;
    replacementRequest.prototype = nativeRequest.prototype;
    globalThis.Request = replacementRequest;
    const originalArrayFilter = Array.prototype.filter;
    const originalJsonStringify = JSON.stringify;
    const originalObjectKeys = Object.keys;
    const originalObjectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    const originalInheritedAllowedTools = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "allowed_tools",
    );
    let replacementSawEvalSerialization = false;
    let objectToJsonSawEvalBody = false;
    Array.prototype.filter = function <T>(
      this: T[],
      predicate: (value: T, index: number, array: T[]) => unknown,
      thisArg?: unknown,
    ): T[] {
      const filtered = Reflect.apply(originalArrayFilter, this, [predicate, thisArg]) as T[];
      if (
        this[0] === "eval_allowed_lookup" &&
        this[1] === "web_fetch"
      ) {
        filtered[filtered.length] = "eval_denied_delete" as T;
      }
      return filtered;
    };
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      if (
        typeof value === "object" && value !== null &&
        "forwardedProps" in value
      ) {
        replacementSawEvalSerialization = true;
        const payload = structuredClone(value) as {
          forwardedProps?: { veryfront?: { runtimeOverrides?: unknown } };
        };
        if (payload.forwardedProps?.veryfront) {
          delete payload.forwardedProps.veryfront.runtimeOverrides;
        }
        return Reflect.apply(originalJsonStringify, JSON, [payload, ...args]);
      }
      return Reflect.apply(originalJsonStringify, JSON, [value, ...args]);
    }) as typeof JSON.stringify;
    Object.keys = ((value: object) => {
      if (
        Object.hasOwn(value, "eval_allowed_lookup") &&
        !Object.hasOwn(value, "eval_denied_delete")
      ) {
        (value as Record<string, unknown>).eval_denied_delete = true;
      }
      return originalObjectKeys(value);
    }) as typeof Object.keys;
    Object.defineProperty(Object.prototype, "allowed_tools", {
      configurable: true,
      value: ["eval_denied_delete"],
    });
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value(this: Record<string, unknown>) {
        if (!("forwardedProps" in this)) return this;
        objectToJsonSawEvalBody = true;
        const payload = { ...this } as {
          forwardedProps?: { veryfront?: { runtimeOverrides?: unknown } };
        };
        if (payload.forwardedProps?.veryfront) {
          const veryfront = payload.forwardedProps.veryfront;
          payload.forwardedProps = {
            ...payload.forwardedProps,
            veryfront: { ...veryfront },
          };
          delete payload.forwardedProps.veryfront?.runtimeOverrides;
        }
        return payload;
      },
    });

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
      // The eval runs against the restricted configuration: only the
      // allowlisted local and provider tools reach the model, and the source
      // agent's own unrestricted surface never runs.
      assertEquals(observedToolNames, ["eval_allowed_lookup", "web_fetch"]);
      assertEquals(sourceAgentStreamCalls, 0);
      assertEquals(replacementSawLocalEvalRequest, false);
      assertEquals(replacementSawEvalSerialization, false);
      assertEquals(objectToJsonSawEvalBody, true);
    } finally {
      if (originalObjectToJson) {
        Object.defineProperty(Object.prototype, "toJSON", originalObjectToJson);
      } else {
        delete (Object.prototype as { toJSON?: unknown }).toJSON;
      }
      if (originalInheritedAllowedTools) {
        Object.defineProperty(Object.prototype, "allowed_tools", originalInheritedAllowedTools);
      } else {
        delete (Object.prototype as { allowed_tools?: unknown }).allowed_tools;
      }
      Object.keys = originalObjectKeys;
      JSON.stringify = originalJsonStringify;
      Array.prototype.filter = originalArrayFilter;
      globalThis.Request = nativeRequest;
      agentRegistry.delete("researcher");
    }
  });

  it("runs managed eval targets as durable child agent runs", async () => {
    const requests: Array<
      { method: string; pathname: string; body: Record<string, unknown> | null }
    > = [];
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
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
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
      config: { eval_id: "eval:deep-research" },
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
    assertEquals(payload.result.failed, 0);

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
      runTask: runTaskDefinition,
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
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: environmentId,
      config: { eval_id: "eval:deep-research", model: "model-override-1", max_steps: 3 },
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
      runTask: runTaskDefinition,
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
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
      config: { eval_id: "eval:deep-research" },
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
      runTask: runTaskDefinition,
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_custom_endpoint",
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://agent-service.example.com/api/ag-ui",
      config: { eval_id: "eval:deep-research" },
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
      runTask: runTaskDefinition,
      createEvalAgentAdapter: (config) => {
        receivedEndpoint = config.endpoint;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_internal_host",
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "https://demo-project.preview.veryfront.org/api/ag-ui",
      config: { eval_id: "eval:deep-research" },
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
      runTask: runTaskDefinition,
      runEval: async () => report,
    }));
    const body = {
      runId: "run_eval_failed_adapter",
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      config: { eval_id: "eval:deep-research" },
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
      result: report.summary,
      error: "1 eval record failed",
      artifacts: [
        await expectedReportArtifact(
          report,
          "evals/reports/deep-research/run_eval_failed_adapter.json",
          "evals/reports/default.json",
        ),
      ],
      logs: null,
      duration_ms: 0,
    });
  });

  it("discovers project agents and tools before starting workflow agent steps", async () => {
    const order: string[] = [];
    let hasAgentRegistry = false;
    let hasToolRegistry = false;
    let retainsStopEvidence = false;
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
        retainsStopEvidence = config?.executor?.retainExecutionStopEvidence === true;
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
          cancel: async () => {},
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
    assertEquals(retainsStopEvidence, true, "the per-request client acknowledges stops (#2365)");
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
          cancel: async () => {},
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

  it("fails a workflow run whose input fails its inputSchema with INPUT_VALIDATION_FAILED (#2091)", async () => {
    let executions = 0;
    const definition = workflow({
      id: "publish",
      inputSchema: defineSchema((v) => v.object({ release: v.string() }))(),
      steps: [
        step("side-effect", {
          tool: tool({
            id: "side-effect",
            description: "Must not run",
            inputSchema: defineSchema((v) => v.object({}).passthrough())(),
            execute: () => {
              executions++;
              return Promise.resolve({});
            },
          }),
        }),
      ],
    }).definition as unknown as WorkflowDefinition;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: "publish",
        filePath: "workflows/publish.ts",
        exportName: "default",
        definition,
      }),
      createWorkflowClient: () => createWorkflowClient(),
    }));
    const body = {
      runId: "run_workflow_invalid_input_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: 1 },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_invalid_input_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const response = await result.response.json();
    assertEquals(response.success, false);
    assertEquals(response.error_code, "INPUT_VALIDATION_FAILED");
    assertEquals(response.error_detail.errors.length, 1);
    assertEquals(response.error_detail.errors[0].path, "/release");
    assertStringIncludes(response.error, "/release");
    assertEquals(executions, 0);
  });

  it("#2176 reports nested input validation code and paths without executing child steps", async () => {
    let executions = 0;
    const child = workflow({
      id: "number-child",
      inputSchema: defineSchema((v) => v.object({ n: v.number() }))(),
      steps: [step("child-side-effect", {
        tool: tool({
          id: "child-side-effect",
          description: "Record child execution",
          inputSchema: defineSchema((v) => v.object({}).passthrough())(),
          execute: () => {
            executions++;
            return Promise.resolve({});
          },
        }),
      })],
    });
    const definition = workflow({
      id: "nested-number-parent",
      steps: [subWorkflow("nested", {
        workflow: child.definition as unknown as WorkflowDefinition,
        input: { n: "x" },
      })],
    }).definition as unknown as WorkflowDefinition;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: definition.id,
        filePath: "workflows/nested-number-parent.ts",
        exportName: "default",
        definition,
      }),
      createWorkflowClient: () => createWorkflowClient(),
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_nested_invalid/execute",
      {
        runId: "run_workflow_nested_invalid",
        kind: "workflow",
        target: "workflow:nested-number-parent",
        projectId: "proj-1",
      },
    );
    const result = await handler.handle(request, createCtx(publicKeyPem));
    assertExists(result.response);
    const response = await result.response.json();
    assertEquals(response.success, false);
    assertEquals(response.error_code, "INPUT_VALIDATION_FAILED");
    assertEquals(response.error_detail.errors.map((error: { path: string }) => error.path), ["/n"]);
    assertEquals(executions, 0);
  });

  it("reports workflow output schema failures with structured validation errors (#2174)", async () => {
    const definition = workflow({
      id: "invalid-output",
      steps: [
        step("n", {
          tool: tool({
            id: "invalid-number",
            description: "Return an invalid number",
            inputSchema: defineSchema((v) => v.object({}).passthrough())(),
            execute: () => Promise.resolve("x"),
          }),
        }),
      ],
      outputSchema: defineSchema((v) => v.object({ n: v.number() }))(),
      output: (context) => ({ n: context.n }),
    }).definition as unknown as WorkflowDefinition;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: "invalid-output",
        filePath: "workflows/invalid-output.ts",
        exportName: "default",
        definition,
      }),
      createWorkflowClient: () => createWorkflowClient(),
    }));
    const body = {
      runId: "run_workflow_invalid_output_1",
      kind: "workflow",
      target: "workflow:invalid-output",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_invalid_output_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const response = await result.response.json();
    assertEquals(response.success, false);
    assertEquals(response.result, undefined);
    assertEquals(response.error_code, "OUTPUT_VALIDATION_FAILED");
    assertEquals(response.error_detail, {
      errors: [{ path: "/n", message: "Invalid input: expected number, received string" }],
    });
    assertStringIncludes(response.error, "/n");
  });

  it("reports nested default output schema failures with structured validation errors (#2215)", async () => {
    const definition = workflow({
      id: "parent-invalid-nested-output",
      steps: [subWorkflow("child", {
        workflow: {
          id: "invalid-nested-output",
          outputSchema: defineSchema((v) => v.object({ n: v.number() }))(),
          steps: [
            step("n", {
              tool: tool({
                id: "invalid-nested-number",
                description: "Return an invalid nested number",
                inputSchema: defineSchema((v) => v.object({}).passthrough())(),
                execute: () => Promise.resolve("x"),
              }),
            }),
          ],
        },
      })],
    }).definition as unknown as WorkflowDefinition;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: "parent-invalid-nested-output",
        filePath: "workflows/parent-invalid-nested-output.ts",
        exportName: "default",
        definition,
      }),
      createWorkflowClient: () => createWorkflowClient(),
    }));
    const body = {
      runId: "run_workflow_invalid_nested_output_1",
      kind: "workflow",
      target: "workflow:parent-invalid-nested-output",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_invalid_nested_output_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const response = await result.response.json();
    assertEquals(response.success, false);
    assertEquals(response.result, undefined);
    assertEquals(response.error_code, "OUTPUT_VALIDATION_FAILED");
    assertEquals(response.error_detail, {
      errors: [{ path: "/n", message: "Invalid input: expected number, received string" }],
    });
    assertStringIncludes(response.error, "/n");
  });

  it("#2108 returns the declared workflow input and output schema identities on the wire", async () => {
    const inputSchema = defineSchema((v) => v.object({ ticketText: v.string() }))();
    const outputSchema = defineSchema((v) =>
      v.object({ category: v.string(), confidence: v.number() })
    )();
    const definition = {
      id: "classify-ticket-flow",
      inputSchema,
      outputSchema,
      steps: [],
    } as unknown as WorkflowDefinition;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: "classify-ticket-flow",
        filePath: "workflows/classify-ticket-flow.ts",
        exportName: "default",
        definition,
      }),
      createWorkflowClient: () => ({
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
        }),
        getRun: async () => ({
          status: "completed",
          output: { category: "billing", confidence: 0.9 },
        }),
        cancel: async () => {},
        destroy: async () => {},
      }),
    }));
    const body = {
      runId: "run_workflow_schema_identity",
      kind: "workflow",
      target: "workflow:classify-ticket-flow",
      projectId: "proj-1",
      input: { ticketText: "I was charged twice" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_schema_identity/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, true);
    assertEquals(payload.input_schema_sha256, await schemaIdentitySha256(inputSchema));
    assertEquals(payload.output_schema_sha256, await schemaIdentitySha256(outputSchema));
    assertMatch(payload.input_schema_sha256, /^[0-9a-f]{64}$/);
    assertMatch(payload.output_schema_sha256, /^[0-9a-f]{64}$/);
    assertEquals("schema_violation" in payload, false);
  });

  it("#2108 reports the workflow input schema identity with INPUT_VALIDATION_FAILED", async () => {
    const inputSchema = defineSchema((v) => v.object({ release: v.string() }))();
    const definition = workflow({
      id: "publish",
      inputSchema,
      steps: [step("noop", {
        tool: tool({
          id: "noop",
          description: "Must not run",
          inputSchema: defineSchema((v) => v.object({}).passthrough())(),
          execute: () => Promise.resolve({}),
        }),
      })],
    }).definition as unknown as WorkflowDefinition;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: "publish",
        filePath: "workflows/publish.ts",
        exportName: "default",
        definition,
      }),
      createWorkflowClient: () => createWorkflowClient(),
    }));
    const body = {
      runId: "run_workflow_identity_invalid_input",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: 1 },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_identity_invalid_input/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.error_code, "INPUT_VALIDATION_FAILED");
    assertEquals(payload.input_schema_sha256, await schemaIdentitySha256(inputSchema));
    // No outputSchema is declared, so the field is omitted as on a schema-less task.
    assertEquals("output_schema_sha256" in payload, false);
  });

  it("#2108 keeps the workflow schema identities when execution throws after discovery", async () => {
    const inputSchema = defineSchema((v) => v.object({ ticketText: v.string() }))();
    const outputSchema = defineSchema((v) => v.object({ category: v.string() }))();
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: "classify-ticket-flow",
        filePath: "workflows/classify-ticket-flow.ts",
        exportName: "default",
        definition: {
          id: "classify-ticket-flow",
          inputSchema,
          outputSchema,
          steps: [],
        } as unknown as WorkflowDefinition,
      }),
      createWorkflowClient: () => Promise.reject(new Error("workflow backend unavailable")),
    }));
    const body = {
      runId: "run_workflow_identity_throws",
      kind: "workflow",
      target: "workflow:classify-ticket-flow",
      projectId: "proj-1",
      input: { ticketText: "I was charged twice" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_identity_throws/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, false);
    assertEquals(payload.error, "workflow backend unavailable");
    assertEquals(payload.input_schema_sha256, await schemaIdentitySha256(inputSchema));
    assertEquals(payload.output_schema_sha256, await schemaIdentitySha256(outputSchema));
  });

  function publishWorkflow(): DiscoveredWorkflow {
    const definition = workflow({
      id: "publish",
      inputSchema: defineSchema((v) => v.object({ release: v.string() }))(),
      steps: [
        step("noop", {
          tool: tool({
            id: "noop",
            description: "Does nothing",
            inputSchema: defineSchema((v) => v.object({}).passthrough())(),
            execute: () => Promise.resolve({}),
          }),
        }),
      ],
    }).definition as unknown as WorkflowDefinition;
    return { id: "publish", filePath: "workflows/publish.ts", exportName: "default", definition };
  }

  it("answers a workflow run whose client cleanup never settles (#2109)", async () => {
    let destroyCalls = 0;
    const client = createWorkflowClient();
    const releaseClient = client.destroy.bind(client);
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => publishWorkflow(),
      // Durable Redis cleanup can wait forever for a reply that never comes.
      createWorkflowClient: () =>
        Object.assign(client, {
          destroy: () => {
            destroyCalls++;
            return new Promise<void>(() => {});
          },
        }),
      workflowClientDestroyTimeoutMs: 5,
    }));
    const body = {
      runId: "run_workflow_cleanup_hang_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: 1 },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_cleanup_hang_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const response = await result.response.json();
    assertEquals(response.success, false);
    assertEquals(response.error_code, "INPUT_VALIDATION_FAILED");
    assertEquals(response.error_detail.errors[0].path, "/release");
    assertEquals(destroyCalls, 1);
    await releaseClient();
  });

  it("answers a workflow run whose client cleanup fails (#2109)", async () => {
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => publishWorkflow(),
      createWorkflowClient: () => {
        const client = createWorkflowClient();
        const releaseClient = client.destroy.bind(client);
        return Object.assign(client, {
          destroy: async () => {
            await releaseClient();
            throw new Error("socket already closed");
          },
        });
      },
    }));
    const body = {
      runId: "run_workflow_cleanup_fail_1",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: { release: "1.0.0" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_cleanup_fail_1/execute",
      body,
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const response = await result.response.json();
    assertEquals(response.success, true);
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
        cancel: async () => {},
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

  // veryfront-issue-inbox#2085, #2102, #2110: a durable pause is reported as
  // `waiting` with what it waits on and its earliest deadline, and the pause
  // payload is never sent as a result.
  it("reports a durable approval pause as waiting with its pending nodes and deadline, never as a result", async () => {
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
          pendingApprovals: [
            {
              id: "apr_1",
              nodeId: "review",
              status: "pending",
              expiresAt: new Date("2026-09-29T21:00:00.000Z"),
            },
            { id: "apr_0", nodeId: "earlier", status: "approved" },
          ],
        }),
        getPendingEventWaits: async () => [],
        cancel: async () => {},
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
    const waitingBody = await result.response.json();
    assertEquals({ ...waitingBody, waiting: withoutWaitId(waitingBody.waiting) }, {
      success: true,
      status: "waiting",
      waiting_reason: "approval",
      waiting: { pending_approvals: ["review"], resume_at: "2026-09-29T21:00:00.000Z" },
      duration_ms: 0,
      logs: null,
    });
    assertEquals(destroyed, true);
  });

  it("keeps polling a run that reads waiting before its pause records are saved", async () => {
    // The runtime writes `waiting` before it saves the approvals and event
    // waits the run pauses on. A poll in between must not report a pause that
    // names no wait, or only some of several parallel waits.
    let polls = 0;
    const approvals = [{ id: "apr_1", nodeId: "review", status: "pending" }];
    const waits = [{
      id: "wait_1",
      nodeId: "invoice",
      eventName: "invoice.received",
      waitKind: "event",
    }];
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
        }),
        getRun: async () => ({
          status: "waiting",
          output: null,
          pendingApprovals: polls >= 1 ? approvals : [],
        }),
        getPendingEventWaits: async () => (polls >= 2 ? waits : []),
        cancel: async () => {},
        destroy: async () => {},
      }),
      sleep: async () => {
        polls++;
      },
    }));
    const runId = "run_workflow_waiting_unsaved";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      { runId, kind: "workflow", target: "workflow:publish", projectId: "proj-1", input: {} },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.status, "waiting");
    assertEquals(payload.waiting_reason, "approval");
    assertEquals(withoutWaitId(payload.waiting), {
      pending_approvals: ["review"],
      event: "invoice.received",
      events: ["invoice.received"],
    });
    assertEquals(polls, 3);
  });

  for (
    const scenario of [
      {
        name: "an event wait reports the event and its timeout",
        waits: [{
          nodeId: "invoice",
          eventName: "invoice.received",
          waitKind: "event",
          status: "pending",
          expiresAt: "2026-09-29T22:00:00.000Z",
        }],
        waiting: {
          event: "invoice.received",
          events: ["invoice.received"],
          resume_at: "2026-09-29T22:00:00.000Z",
        },
      },
      {
        name: "a delay reports only its wake-up",
        waits: [{
          nodeId: "cool-off",
          eventName: "__veryfront_delay__",
          waitKind: "delay",
          status: "pending",
          expiresAt: new Date("2026-09-29T20:05:00.000Z"),
        }],
        waiting: { resume_at: "2026-09-29T20:05:00.000Z" },
      },
      {
        name: "an event wait without a timeout reports no deadline",
        waits: [{ nodeId: "invoice", eventName: "invoice.received", waitKind: "event" }],
        waiting: { event: "invoice.received", events: ["invoice.received"] },
      },
    ] as const
  ) {
    it(`reports a durable event pause as waiting: ${scenario.name}`, async () => {
      const handler = new ProjectRunExecuteHandler(createDeps({
        createWorkflowClient: () => ({
          statePersistence: "durable",
          register: () => {},
          start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
            runId: options?.runId ?? "workflow-run",
          }),
          getRun: async () => ({
            status: "waiting",
            output: { paused: true },
            pendingApprovals: [],
          }),
          getPendingEventWaits: async () => [...scenario.waits],
          cancel: async () => {},
          destroy: async () => {},
        }),
      }));
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_workflow_event_1/execute",
        {
          runId: "run_workflow_event_1",
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
        },
      );

      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      const payload = await result.response.json();
      assertEquals(payload.status, "waiting");
      assertEquals(payload.waiting_reason, "event");
      assertEquals(withoutWaitId(payload.waiting), scenario.waiting);
      assertEquals("result" in payload, false);
    });
  }

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
        cancel: async () => {},
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

  // veryfront-issue-inbox#2085: a durable pause is not a completed run. The
  // response must carry the lifecycle outcome so the backend can keep the
  // canonical run `waiting` instead of mapping `success` to `completed`.
  for (
    const scenario of [
      {
        name: "approval",
        pendingApprovals: [{ id: "approval-1", nodeId: "review" }],
      },
      { name: "event", pendingApprovals: [] },
    ] as const
  ) {
    it(`reports a durable ${scenario.name} pause as waiting, not as a completed result`, async () => {
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
            pendingApprovals: scenario.pendingApprovals,
          }),
          getPendingEventWaits: async () =>
            scenario.name === "event"
              ? [{ nodeId: "invoice", eventName: "invoice.received", waitKind: "event" }]
              : [],
          cancel: async () => {},
          destroy: async () => {},
        }),
      }));
      const runId = `run_workflow_waiting_outcome_${scenario.name}`;
      const { request, publicKeyPem } = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        {
          runId,
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
          input: { release: "v1" },
        },
      );

      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const payload = await result.response.json();
      assertEquals(
        payload.status,
        "waiting",
        "a paused workflow must report status waiting across the runtime/backend boundary",
      );
      assertEquals(payload.waiting_reason, scenario.name);
    });
  }

  it("refreshes approval metadata after the initial pause finishes persisting", async () => {
    let settled = false;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        cancel: () => Promise.resolve(),
        start: (_id, _input, options) =>
          Promise.resolve({
            runId: options!.runId!,
            settled: () => {
              settled = true;
              return Promise.resolve();
            },
          }),
        getRun: () => {
          const pendingApprovals = settled ? [{ id: "approval", nodeId: "review" }] : [];
          settled = true;
          return Promise.resolve({ status: "waiting", pendingApprovals });
        },
        getPendingEventWaits: () => Promise.resolve([]),
        destroy: () => Promise.resolve(),
      }),
    }));
    const runId = "run_pending_approval_metadata";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      {
        runId,
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
      },
    );
    const result = await handler.handle(request, createCtx(publicKeyPem));
    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.waiting_reason, "approval");
    assertEquals(payload.waiting.pending_approvals, ["review"]);
  });

  it("cancels a run that advances past its pause after the request aborts", async () => {
    const controller = new AbortController();
    let status = "waiting";
    let cancellations = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        cancel: () => {
          cancellations++;
          status = "cancelled";
          return Promise.resolve();
        },
        start: (_id, _input, options) =>
          Promise.resolve({
            runId: options!.runId!,
            // The abort lands after the last poll saw the pause, and a delay
            // expires while the execution settles.
            settled: () => {
              controller.abort();
              status = "running";
              return Promise.resolve();
            },
          }),
        getRun: () =>
          Promise.resolve({
            status,
            pendingApprovals: status === "waiting" ? [{ id: "approval", nodeId: "review" }] : [],
          }),
        getPendingEventWaits: () => Promise.resolve([]),
        destroy: () => Promise.resolve(),
      }),
    }));
    const runId = "run_advanced_after_abort";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      {
        runId,
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
      },
    );
    const result = await handler.handle(
      new Request(request, { signal: controller.signal }),
      createCtx(publicKeyPem),
    );
    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.success, false);
    assertEquals(payload.error, "Workflow run cancelled");
    assertEquals(cancellations, 1);
  });

  it("waits for a new pause reached during settlement to persist its records", async () => {
    let phase: "first" | "unsaved" | "saved" = "first";
    let reads = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        cancel: () => Promise.resolve(),
        start: (_id, _input, options) =>
          Promise.resolve({
            runId: options!.runId!,
            // A delay expires while the execution settles and the run pauses
            // again on a later approval whose record is not saved yet.
            settled: () => {
              phase = "unsaved";
              return Promise.resolve();
            },
          }),
        getRun: () => {
          if (phase === "unsaved" && ++reads > 1) phase = "saved";
          const pendingApprovals = phase === "first"
            ? [{ id: "approval-1", nodeId: "review" }]
            : phase === "saved"
            ? [{ id: "approval-2", nodeId: "sign-off" }]
            : [];
          return Promise.resolve({ status: "waiting", pendingApprovals });
        },
        getPendingEventWaits: () => Promise.resolve([]),
        destroy: () => Promise.resolve(),
      }),
    }));
    const runId = "run_new_pause_during_settlement";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      {
        runId,
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
      },
    );
    const result = await handler.handle(request, createCtx(publicKeyPem));
    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.waiting_reason, "approval");
    assertEquals(payload.waiting.pending_approvals, ["sign-off"]);
  });

  // veryfront-issue-inbox#2102 and #2110: a waiting run the control plane
  // dispatches again under the same run id is continued, never started anew.
  function resumableClient(initial: Record<string, unknown>) {
    const calls: Array<[string, ...unknown[]]> = [];
    let state: Record<string, unknown> = initial;
    const settle = (next: Record<string, unknown>) => {
      state = next;
    };
    const client = {
      statePersistence: "durable" as const,
      register: () => {},
      start: (..._args: unknown[]) => {
        calls.push(["start"]);
        return Promise.reject(new Error("a resumed run must not be started again"));
      },
      getRun: () => Promise.resolve(state as { status: string }),
      getPendingEventWaits: () =>
        Promise.resolve(
          (state.eventWaits ?? []) as Array<
            { nodeId: string; eventName: string; waitKind: string }
          >,
        ),
      approve: (
        runId: string,
        approvalId: string,
        approver: string,
        comment?: string,
        data?: unknown,
      ) => {
        calls.push([
          "approve",
          runId,
          approvalId,
          approver,
          comment,
          ...(data === undefined ? [] : [data]),
        ]);
        settle({ status: "completed", output: { stage: "paid" } });
        return Promise.resolve();
      },
      reject: (runId: string, approvalId: string, approver: string, comment?: string) => {
        calls.push(["reject", runId, approvalId, approver, comment]);
        settle({ status: "failed", error: { message: "Approval rejected" } });
        return Promise.resolve();
      },
      publishEvent: (runId: string, name: string, payload?: unknown): Promise<string> => {
        calls.push(["publishEvent", runId, name, payload]);
        settle({ status: "completed", output: { invoice: payload } });
        return Promise.resolve("delivered");
      },
      retryEventDelivery: (runId: string, name: string) => {
        calls.push(["retryEventDelivery", runId, name]);
        return Promise.resolve(false);
      },
      resumeChildRuns: (...args: unknown[]) => {
        calls.push(["resumeChildRuns", ...args]);
        return Promise.resolve(true);
      },
      getApprovalManager: () => ({
        checkExpiredApprovals: () => {
          calls.push(["releaseDueWaits"]);
          settle((initial.onDeadline ?? { status: "completed" }) as Record<string, unknown>);
          return Promise.resolve();
        },
      }),
      getEventWaitManager: () => ({ checkExpiredEventWaits: () => Promise.resolve() }),
      cancel: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    return { client, calls, settle };
  }

  async function executeResume(
    client: ReturnType<typeof resumableClient>["client"],
    resume: Record<string, unknown>,
    deps: Partial<ProjectRunExecuteHandlerDeps> = {},
    signal?: AbortSignal,
  ) {
    const handler = new ProjectRunExecuteHandler(
      createDeps({ createWorkflowClient: () => client, ...deps }),
    );
    const runId = "run_27714e62-7b05-466e-809e-0d8f1cdf1e62";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      { runId, kind: "workflow", target: "workflow:publish", projectId: "proj-1", resume },
    );
    const result = await handler.handle(
      signal ? new Request(request, { signal }) : request,
      createCtx(publicKeyPem),
    );
    assertExists(result.response);
    return { status: result.response.status, payload: await result.response.json(), runId };
  }

  const waitingOnReview = {
    status: "waiting",
    pendingApprovals: [{ id: "apr_1", nodeId: "manager-review", status: "pending" }],
  };

  it("applies an approval decision to the same durable run and reports its completion", async () => {
    const { client, calls } = resumableClient(waitingOnReview);

    const { payload, runId } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      comment: "ok",
      approver: "user:u1",
    });

    assertEquals(calls, [["approve", runId, "apr_1", "user:u1", "ok"]]);
    assertEquals(payload, { success: true, result: { stage: "paid" }, logs: null, duration_ms: 0 });
  });

  it("forwards the structured response of an approval decision", async () => {
    const { client, calls } = resumableClient(waitingOnReview);

    const { runId } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
      data: { amount: 120 },
    });

    assertEquals(calls, [["approve", runId, "apr_1", "user:u1", undefined, { amount: 120 }]]);
  });

  it("applies a rejection and reports the run as failed", async () => {
    const { client, calls } = resumableClient(waitingOnReview);

    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: false,
      approver: "user:u1",
    });

    assertEquals(calls.map(([name]) => name), ["reject"]);
    assertEquals(payload.success, false);
    assertEquals(payload.error, "Approval rejected");
  });

  it("delivers an event to the same durable run", async () => {
    const { client, calls } = resumableClient({
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [{
        nodeId: "invoice",
        eventName: "invoice.received",
        waitKind: "event",
        status: "pending",
      }],
    });

    const { payload, runId } = await executeResume(client, {
      type: "event",
      name: "invoice.received",
      payload: { id: 7 },
    });

    assertEquals(calls, [["publishEvent", runId, "invoice.received", { id: 7 }]]);
    assertEquals(payload, {
      success: true,
      result: { invoice: { id: 7 } },
      logs: null,
      duration_ms: 0,
    });
  });

  it("releases a passed delay on a deadline dispatch and reports the next boundary", async () => {
    const { client, calls } = resumableClient({
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [{
        nodeId: "cool-off",
        eventName: "__veryfront_delay__",
        waitKind: "delay",
        status: "pending",
        expiresAt: new Date(Date.now() - 1_000),
      }],
      onDeadline: { status: "completed", output: { cooled: true } },
    });

    const { payload } = await executeResume(client, { type: "deadline" });

    assertEquals(calls, [["releaseDueWaits"]]);
    assertEquals(payload, { success: true, result: { cooled: true }, logs: null, duration_ms: 0 });
  });

  it("reports an approval timeout on a deadline dispatch as a failure with the runtime's timeout error", async () => {
    const { client } = resumableClient({
      status: "waiting",
      pendingApprovals: [{
        id: "apr_1",
        nodeId: "manager-review",
        status: "pending",
        expiresAt: new Date(Date.now() - 1_000),
      }],
      onDeadline: { status: "failed", error: { message: 'Approval "apr_1" expired' } },
    });

    const { payload } = await executeResume(client, { type: "deadline" });

    assertEquals(payload.success, false);
    assertEquals(payload.error, 'Approval "apr_1" expired');
  });

  it("polls past the boundary it released while the resumed execution catches up", async () => {
    const { client, settle } = resumableClient(waitingOnReview);
    let polls = 0;
    client.approve = () => {
      // The decision is durable, but the run still reads the old boundary for
      // a few polls before the resumed execution finishes.
      return Promise.resolve();
    };
    const { payload } = await executeResume(
      client,
      { type: "approval", node_id: "manager-review", approved: true, approver: "user:u1" },
      {
        sleep: () => {
          polls++;
          if (polls === 3) settle({ status: "completed", output: { stage: "paid" } });
          return Promise.resolve();
        },
      },
    );

    assertEquals(polls, 3);
    assertEquals(payload.result, { stage: "paid" });
  });

  /** The wait_id a pause reports: a deadline dispatch with nothing due re-reports it. */
  async function reportedWaitId(parked: Record<string, unknown>): Promise<string> {
    const { client } = resumableClient({ ...parked, onDeadline: parked });
    const { payload } = await executeResume(client, { type: "deadline" });
    return payload.waiting.wait_id;
  }

  it("applies nothing when a retried decision names a boundary the run already left", async () => {
    // The first dispatch approved apr_1 and the run parked again on the same
    // node (a loop), but its response never reached the control plane.
    const parkedAgain = {
      status: "waiting",
      pendingApprovals: [{ id: "apr_2", nodeId: "manager-review", status: "pending" }],
    };
    const earlierWaitId = await reportedWaitId(waitingOnReview);
    const { client, calls } = resumableClient(parkedAgain);

    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
      wait_id: earlierWaitId,
    });

    assertEquals(calls, []);
    assertEquals(payload.status, "waiting");
    assertEquals(payload.waiting.wait_id, await reportedWaitId(parkedAgain));
    assertNotEquals(payload.waiting.wait_id, earlierWaitId);
  });

  it("does not release a later boundary when a deadline dispatch names an earlier wait", async () => {
    const earlierWaitId = await reportedWaitId({
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [{
        id: "delay-1",
        nodeId: "cool-off",
        eventName: "__veryfront_delay__",
        waitKind: "delay",
        status: "pending",
      }],
    });
    const parkedAgain = {
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [{
        id: "delay-2",
        nodeId: "cool-off",
        eventName: "__veryfront_delay__",
        waitKind: "delay",
        status: "pending",
        expiresAt: new Date(Date.now() - 1_000),
      }],
    };
    const { client, calls } = resumableClient(parkedAgain);

    const { payload } = await executeResume(client, {
      type: "deadline",
      wait_id: earlierWaitId,
    });

    assertEquals(calls, []);
    assertEquals(payload.status, "waiting");
    assertNotEquals(payload.waiting.wait_id, earlierWaitId);
  });

  it("polls on when a retried decision finds its approval already applied and nothing pending", async () => {
    // The first dispatch marked apr_1 approved, then died before the released
    // node finished: the run still reads waiting, with nothing pending.
    const waitId = await reportedWaitId(waitingOnReview);
    const { client, calls, settle } = resumableClient({ status: "waiting", pendingApprovals: [] });
    let polls = 0;

    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
      wait_id: waitId,
    }, {
      sleep: () => {
        polls += 1;
        settle({ status: "completed", output: { stage: "paid" } });
        return Promise.resolve();
      },
    });

    assertEquals(calls, []);
    assertEquals(polls, 1);
    assertEquals(payload.result, { stage: "paid" });
  });

  it("polls on when a retried decision finds its event already applied and nothing pending", async () => {
    // The first dispatch delivered the event, then died before the released
    // node finished: publishing it again would buffer a duplicate.
    const waitId = await reportedWaitId(waitingOnInvoice);
    const { client, calls, settle } = resumableClient({ status: "waiting", pendingApprovals: [] });
    let polls = 0;

    const { payload } = await executeResume(client, {
      type: "event",
      name: "invoice.received",
      wait_id: waitId,
    }, {
      sleep: () => {
        polls += 1;
        settle({ status: "completed", output: { stage: "paid" } });
        return Promise.resolve();
      },
    });

    assertEquals(calls, []);
    assertEquals(polls, 1);
    assertEquals(payload.result, { stage: "paid" });
  });

  it("bounds a blocked approval application and keeps its client alive until it settles", async () => {
    const { client, settle } = resumableClient(waitingOnReview);
    let finish!: () => void;
    let destroyed = false;
    const messages: string[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => messages.push(entry.message));
    client.approve = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    client.destroy = () => {
      destroyed = true;
      return Promise.reject(new Error("cleanup unavailable"));
    };
    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
    }, { workflowResumeTimeoutMs: 5 });
    // The resumed execution keeps running, so the canonical run stays waiting
    // and is dispatched again shortly to report where the run got to.
    assertEquals(payload.success, true);
    assertEquals(payload.status, "waiting");
    assertExists(payload.waiting.resume_at);
    assertEquals(destroyed, false);
    settle({ status: "completed", output: {} });
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(destroyed, true);
    assertEquals(
      messages.some((message) => message.includes("Failed to destroy workflow client")),
      true,
    );
    unsubscribe();
  });

  it("does not turn a timed-out resume request into durable workflow cancellation", async () => {
    const { client, settle } = resumableClient(waitingOnReview);
    const requestController = new AbortController();
    let finish!: () => void;
    let cancelCalls = 0;
    let destroyed = false;
    client.approve = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    client.cancel = () => {
      cancelCalls += 1;
      return Promise.resolve();
    };
    client.destroy = () => {
      destroyed = true;
      return Promise.resolve();
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => client,
      workflowResumeTimeoutMs: 5,
      sleep: () => {
        settle({ status: "completed", output: {} });
        return Promise.resolve();
      },
    }));
    const runId = "run_27714e62-7b05-466e-809e-0d8f1cdf1e62";
    const signed = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      {
        runId,
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
        resume: {
          type: "approval",
          node_id: "manager-review",
          approved: true,
          approver: "user:u1",
        },
      },
    );
    const request = new Request(signed.request, { signal: requestController.signal });

    const result = await handler.handle(request, createCtx(signed.publicKeyPem));
    assertExists(result.response);
    const payload = await result.response.json();
    assertEquals(payload.status, "waiting");

    requestController.abort(new Error("request closed after timeout response"));
    settle({ status: "running" });
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(cancelCalls, 0);
    assertEquals(destroyed, true);
  });

  it("does not cancel durable execution when a timed-out resume request disconnects", async () => {
    const { client } = resumableClient(waitingOnReview);
    let finish!: () => void;
    let destroyed = false;
    let cancelled = false;
    const controller = new AbortController();
    client.cancel = () => {
      cancelled = true;
      return Promise.resolve();
    };
    client.approve = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    client.destroy = () => {
      destroyed = true;
      return Promise.resolve();
    };
    const { payload } = await executeResume(
      client,
      {
        type: "approval",
        node_id: "manager-review",
        approved: true,
        approver: "user:u1",
      },
      { workflowResumeTimeoutMs: 5 },
      controller.signal,
    );
    assertEquals(payload.success, true);
    assertEquals(payload.status, "waiting");
    assertEquals(destroyed, false);
    controller.abort();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(destroyed, true);
    assertEquals(cancelled, false);
  });

  it("cancels durable execution immediately while an approval decision is pending", async () => {
    const { client } = resumableClient(waitingOnReview);
    let finish!: () => void;
    let destroyed = false;
    let cancelled = false;
    let cancellations = 0;
    const controller = new AbortController();
    client.cancel = () => {
      cancelled = true;
      cancellations++;
      if (cancellations > 1) return Promise.reject(new Error("already cancelled"));
      return Promise.resolve();
    };
    client.approve = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        controller.abort();
      });
    client.destroy = () => {
      destroyed = true;
      return Promise.resolve();
    };
    const { payload } = await executeResume(
      client,
      {
        type: "approval",
        node_id: "manager-review",
        approved: true,
        approver: "user:u1",
      },
      { workflowResumeTimeoutMs: 5 },
      controller.signal,
    );
    assertEquals(payload.success, false);
    assertEquals(payload.error, "Workflow run cancelled");
    assertEquals(destroyed, false);
    assertEquals(cancelled, true);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(destroyed, true);
    assertEquals(cancellations, 1);
    assertEquals(cancelled, true);
  });

  it("keeps the client alive until cancellation settles after resume rejects", async () => {
    const { client } = resumableClient(waitingOnReview);
    const controller = new AbortController();
    let finishCancel!: () => void;
    let destroyed = false;
    client.cancel = () =>
      new Promise<void>((resolve) => {
        finishCancel = resolve;
      });
    client.destroy = () => {
      destroyed = true;
      return Promise.resolve();
    };
    client.approve = () => {
      controller.abort();
      return Promise.reject(new Error("resume failed"));
    };
    const { payload } = await executeResume(
      client,
      {
        type: "approval",
        node_id: "manager-review",
        approved: true,
        approver: "user:u1",
      },
      { workflowResumeTimeoutMs: 5 },
      controller.signal,
    );
    assertEquals(payload.status, "waiting");
    assertEquals(destroyed, false);
    finishCancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(destroyed, true);
  });

  it("cancels a persisted resume when its request aborts during discovery", async () => {
    const { client, calls } = resumableClient(waitingOnReview);
    const controller = new AbortController();
    let cancellations = 0;
    client.cancel = () => {
      cancellations++;
      return Promise.resolve();
    };
    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
    }, {
      ensureProjectDiscovery: () => {
        controller.abort();
        return Promise.resolve(createEmptyDiscoveryResult());
      },
    }, controller.signal);
    assertEquals(payload.success, false);
    assertEquals(cancellations, 1);
    assertEquals(calls, []);
  });

  it("preserves completion when request cancellation races a resumed result", async () => {
    const { client, settle } = resumableClient(waitingOnReview);
    const controller = new AbortController();
    let cancellations = 0;
    client.cancel = () => {
      cancellations++;
      return Promise.reject(new Error("already completed"));
    };
    client.approve = () => {
      settle({ status: "completed", output: { done: true } });
      controller.abort();
      return Promise.resolve();
    };
    const { payload } = await executeResume(
      client,
      {
        type: "approval",
        node_id: "manager-review",
        approved: true,
        approver: "user:u1",
      },
      {},
      controller.signal,
    );
    assertEquals(payload.result, { done: true });
    assertEquals(cancellations, 0);
  });

  it("applies a decision whose discovery outlasts the resume timeout", async () => {
    const { client, calls } = resumableClient(waitingOnReview);
    const getRun = client.getRun;
    let reads = 0;
    client.getRun = () => {
      reads++;
      if (reads > 1) return getRun();
      return new Promise((resolve) => setTimeout(() => resolve(getRun()), 20));
    };
    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
    }, { workflowResumeTimeoutMs: 5 });
    assertEquals(payload.status, "waiting");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assertEquals(calls.map(([name]) => name), ["approve"]);
  });

  it("reports a completion that cancellation found when the resume times out", async () => {
    const { client, settle } = resumableClient(waitingOnReview);
    const controller = new AbortController();
    let finish!: () => void;
    let cancellations = 0;
    client.cancel = () => {
      cancellations++;
      return Promise.resolve();
    };
    client.approve = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        settle({ status: "completed", output: { done: true } });
        controller.abort();
      });
    const { payload } = await executeResume(
      client,
      {
        type: "approval",
        node_id: "manager-review",
        approved: true,
        approver: "user:u1",
      },
      { workflowResumeTimeoutMs: 5 },
      controller.signal,
    );
    finish();
    assertEquals(payload.success, true);
    assertEquals(payload.result, { done: true });
    assertEquals(cancellations, 0);
  });

  it("leaves a run to the recheck while a timed-out cancellation is unresolved", async () => {
    const { client, settle } = resumableClient(waitingOnReview);
    const controller = new AbortController();
    let finish!: () => void;
    let finishRead!: () => void;
    const getRun = client.getRun;
    client.getRun = () =>
      controller.signal.aborted
        ? new Promise((resolve) => {
          finishRead = () => resolve(getRun());
        })
        : getRun();
    client.cancel = () => Promise.resolve();
    client.approve = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        settle({ status: "completed", output: { done: true } });
        controller.abort();
      });
    const { payload } = await executeResume(
      client,
      {
        type: "approval",
        node_id: "manager-review",
        approved: true,
        approver: "user:u1",
      },
      { workflowResumeTimeoutMs: 5 },
      controller.signal,
    );
    finishRead();
    finish();
    assertEquals(payload.success, true);
    assertEquals(payload.status, "waiting");
  });

  it("applies a decision whose wait_id names the boundary the run is parked on", async () => {
    const { client, calls } = resumableClient(waitingOnReview);

    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
      wait_id: await reportedWaitId(waitingOnReview),
    });

    assertEquals(calls.map(([name]) => name), ["approve"]);
    assertEquals(payload.result, { stage: "paid" });
  });

  it("delivers the second of two parallel event waits under the wait_id of their shared pause", async () => {
    const invoiceWait = {
      id: "wait-invoice",
      nodeId: "invoice",
      eventName: "invoice.received",
      waitKind: "event",
      status: "pending",
    };
    const receiptWait = {
      id: "wait-receipt",
      nodeId: "receipt",
      eventName: "receipt.received",
      waitKind: "event",
      status: "pending",
    };
    const bothPending = {
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [invoiceWait, receiptWait],
    };
    const waitId = await reportedWaitId(bothPending);
    // The first event was delivered: only the receipt wait is left.
    const { client, calls } = resumableClient({
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [receiptWait],
    });

    const { payload, runId } = await executeResume(client, {
      type: "event",
      name: "receipt.received",
      payload: { id: 9 },
      wait_id: waitId,
    });

    assertEquals(calls, [["publishEvent", runId, "receipt.received", { id: 9 }]]);
    assertEquals(payload.result, { invoice: { id: 9 } });
  });

  it("does not let an old child-only wait_id release a boundary that gained another child wait", async () => {
    const state = {
      status: "waiting",
      currentNodes: ["first-children", "second-children"],
      nodeStates: {
        "first-children": {
          status: "running",
          _waitInstanceId: "wait-first",
          input: { type: "child_run", runIds: ["run_child_a"] },
        },
        "second-children": {
          status: "running",
          _waitInstanceId: "wait-second",
          input: { type: "child_run", runIds: ["run_child_b"] },
        },
      },
      pendingApprovals: [],
    };
    const { client, calls } = resumableClient(state);
    const firstHash = (await computeHash("child:wait-first:run_child_a")).slice(0, 16);

    const { payload } = await executeResume(client, {
      type: "child_run",
      wait_id: `w.${firstHash}`,
    });

    assertEquals(calls, []);
    assertEquals(payload.status, "waiting");
    assertEquals(payload.waiting_reason, "child_run");
    assertEquals(payload.waiting_on, [
      {
        kind: "run",
        run_id: "run_child_a",
        correlation: { kind: "workflow_node", id: "first-children" },
      },
      {
        kind: "run",
        run_id: "run_child_b",
        correlation: { kind: "workflow_node", id: "second-children" },
      },
    ]);
  });

  it("does not deliver an event to a later pause on the same node than the one its wait_id names", async () => {
    const earlier = {
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [{
        id: "wait-1",
        nodeId: "invoice",
        eventName: "invoice.received",
        waitKind: "event",
      }],
    };
    const waitId = await reportedWaitId(earlier);
    const { client, calls } = resumableClient({
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [{
        id: "wait-2",
        nodeId: "invoice",
        eventName: "invoice.received",
        waitKind: "event",
      }],
    });

    const { payload } = await executeResume(client, {
      type: "event",
      name: "invoice.received",
      wait_id: waitId,
    });

    assertEquals(calls, []);
    assertEquals(payload.status, "waiting");
  });

  it("releases nothing on a deadline dispatch at the exact expiry instant and re-reports the pause", async () => {
    const at = 1_700_000_000_000;
    const parked = {
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [{
        id: "delay-1",
        nodeId: "cool-off",
        eventName: "__veryfront_delay__",
        waitKind: "delay",
        status: "pending",
        expiresAt: new Date(at),
      }],
    };
    const waitId = await reportedWaitId(parked);
    const { client } = resumableClient({ ...parked, onDeadline: parked });

    const { payload } = await executeResume(client, { type: "deadline", wait_id: waitId }, {
      now: () => at,
      sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
      workflowResumeTimeoutMs: 200,
    });

    assertEquals(payload.status, "waiting");
    assertEquals(payload.waiting.wait_id, waitId);
  });

  it("fails fast when the workflow backend cannot persist the event wait a run parked on", async () => {
    // The run parked on a `waitForEvent()` the backend saved no record for.
    const { client } = resumableClient({ status: "waiting", pendingApprovals: [] });
    let clock = 0;
    let cancelled = 0;
    const eventless = {
      ...client,
      persistsEventWaits: false,
      start: () => Promise.resolve({ runId: "run_27714e62-7b05-466e-809e-0d8f1cdf1e62" }),
      cancel: () => {
        cancelled += 1;
        return Promise.resolve();
      },
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => eventless,
      now: () => clock,
      sleep: () => {
        clock += 1_000;
        return Promise.resolve();
      },
    }));
    const runId = "run_27714e62-7b05-466e-809e-0d8f1cdf1e62";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      { runId, kind: "workflow", target: "workflow:publish", projectId: "proj-1" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));
    assertExists(result.response);
    const payload = await result.response.json();

    assertEquals(payload.success, false);
    assertStringIncludes(payload.error, "cannot persist event waits");
    assertEquals(cancelled, 1);
    assertEquals(clock < 60_000, true);
  });

  it("keeps polling an approval pause whose record is slow to persist on a backend without event waits", async () => {
    // The run is marked waiting on an approval node before its approval record is saved.
    let clock = 0;
    let cancelled = 0;
    const saved = {
      status: "waiting",
      currentNodes: ["sign-off"],
      nodeStates: { "sign-off": { input: { type: "approval" } } },
      pendingApprovals: [{ id: "approval-1", nodeId: "sign-off", status: "pending" }],
    };
    const { client } = resumableClient(saved);
    const eventless = {
      ...client,
      persistsEventWaits: false,
      start: () => Promise.resolve({ runId: "run_27714e62-7b05-466e-809e-0d8f1cdf1e62" }),
      getRun: () => Promise.resolve(clock < 20_000 ? { ...saved, pendingApprovals: [] } : saved),
      cancel: () => {
        cancelled += 1;
        return Promise.resolve();
      },
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => eventless,
      now: () => clock,
      sleep: () => {
        clock += 1_000;
        return Promise.resolve();
      },
    }));
    const runId = "run_27714e62-7b05-466e-809e-0d8f1cdf1e62";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      { runId, kind: "workflow", target: "workflow:publish", projectId: "proj-1" },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));
    assertExists(result.response);
    const payload = await result.response.json();

    assertEquals(cancelled, 0);
    assertEquals(payload.status, "waiting");
    assertEquals(payload.waiting_reason, "approval");
  });

  it("reports every awaited event name when a run waits on several", async () => {
    const parked = {
      status: "waiting",
      pendingApprovals: [],
      eventWaits: [
        { nodeId: "invoice", eventName: "invoice.received", waitKind: "event" },
        { nodeId: "receipt", eventName: "receipt.received", waitKind: "event" },
        { nodeId: "cool-off", eventName: "__veryfront_delay__", waitKind: "delay" },
      ],
    };
    const { client } = resumableClient({ ...parked, onDeadline: parked });

    const { payload } = await executeResume(client, { type: "deadline" });

    assertEquals(withoutWaitId(payload.waiting), {
      event: "invoice.received",
      events: ["invoice.received", "receipt.received"],
    });
  });

  it("reports a resumed run that paused again on a new approval as waiting", async () => {
    const { client, settle } = resumableClient(waitingOnReview);
    client.approve = () => {
      settle({
        status: "waiting",
        pendingApprovals: [{ id: "apr_2", nodeId: "finance-review", status: "pending" }],
      });
      return Promise.resolve();
    };

    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
    });

    assertEquals(payload.status, "waiting");
    assertEquals(withoutWaitId(payload.waiting), { pending_approvals: ["finance-review"] });
  });

  it("keeps polling while the decided approval has left the pending set but the run still reads waiting", async () => {
    const { client, settle } = resumableClient(waitingOnReview);
    let polls = 0;
    client.approve = () => {
      // The approval is decided, so it is no longer pending, but the resumed
      // execution has not moved the run off `waiting` yet.
      settle({
        status: "waiting",
        pendingApprovals: [{ id: "apr_1", nodeId: "manager-review", status: "approved" }],
      });
      return Promise.resolve();
    };

    const { payload } = await executeResume(
      client,
      { type: "approval", node_id: "manager-review", approved: true, approver: "user:u1" },
      {
        sleep: () => {
          polls++;
          if (polls === 2) settle({ status: "completed", output: { stage: "paid" } });
          return Promise.resolve();
        },
      },
    );

    assertEquals(polls, 2);
    assertEquals(payload.success, true);
    assertEquals(payload.result, { stage: "paid" });
  });

  it("accepts an empty approval comment, as the control plane does", async () => {
    const { client, calls } = resumableClient(waitingOnReview);

    const { status, payload, runId } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      comment: "",
      approver: "user:u1",
    });

    assertEquals(status, 200);
    assertEquals(calls, [["approve", runId, "apr_1", "user:u1", ""]]);
    assertEquals(payload.success, true);
  });

  const waitingOnInvoice = {
    status: "waiting",
    pendingApprovals: [],
    eventWaits: [{
      nodeId: "invoice",
      eventName: "invoice.received",
      waitKind: "event",
      status: "pending",
    }],
  };

  it("retries a failed event delivery once and fails the dispatch when it still fails, without polling", async () => {
    const { client, calls } = resumableClient(waitingOnInvoice);
    client.publishEvent = (runId: string, name: string, payload?: unknown) => {
      calls.push(["publishEvent", runId, name, payload]);
      return Promise.resolve("delivery-failed");
    };
    let polls = 0;

    const { payload, runId } = await executeResume(
      client,
      { type: "event", name: "invoice.received" },
      { sleep: () => Promise.resolve(void polls++) },
    );

    assertEquals(calls, [
      ["publishEvent", runId, "invoice.received", undefined],
      ["retryEventDelivery", runId, "invoice.received"],
    ]);
    assertEquals(polls, 0);
    assertEquals(payload.success, false);
    assertStringIncludes(payload.error, "invoice.received");
  });

  it("reports the terminal run when an event reaches a run that already ended", async () => {
    const { client, settle } = resumableClient(waitingOnInvoice);
    client.publishEvent = () => {
      settle({ status: "cancelled", error: { message: "Run cancelled" } });
      return Promise.resolve("run-terminal");
    };
    let polls = 0;

    const { payload } = await executeResume(
      client,
      { type: "event", name: "invoice.received" },
      { sleep: () => Promise.resolve(void polls++) },
    );

    assertEquals(polls, 0);
    assertEquals(payload.success, false);
  });

  it("re-reports the same pause on a deadline dispatch when only a decided approval is past its deadline", async () => {
    const past = new Date(Date.now() - 60_000);
    const unchanged = {
      status: "waiting",
      pendingApprovals: [{
        id: "apr_1",
        nodeId: "manager-review",
        status: "approved",
        expiresAt: past,
      }],
      eventWaits: [{
        nodeId: "invoice",
        eventName: "invoice.received",
        waitKind: "event",
        status: "pending",
      }],
    };
    const { client } = resumableClient({ ...unchanged, onDeadline: unchanged });
    let polls = 0;

    const { payload } = await executeResume(client, { type: "deadline" }, {
      now: () => Date.now(),
      sleep: () => Promise.resolve(void polls++),
    });

    // One poll confirms the pause names the same waits twice.
    assertEquals(polls, 1);
    assertEquals(payload.status, "waiting");
    assertEquals(withoutWaitId(payload.waiting), {
      event: "invoice.received",
      events: ["invoice.received"],
    });
  });

  // The production wiring: a real workflow client on a shared durable backend.
  // The run was started by one runtime instance and is continued by another,
  // as on a re-dispatch to a fresh process (#2102 Demo step 6, #2110 Demo).
  describe("on a real workflow client sharing the durable backend", () => {
    const runId = "run_3f0e6c1a-9b2d-4c7e-8a5f-1d2e3f4a5b6c";

    async function parkRun(
      steps: WorkflowNode[],
      output?: (context: Record<string, unknown>) => unknown,
    ) {
      const backend = new MemoryBackend();
      const definition = workflow({ id: "publish", steps, ...(output ? { output } : {}) })
        .definition;
      const first = createWorkflowClient({ backend });
      first.register(definition);
      const handle = await first.start("publish", {}, { runId, [CONTROL_PLANE_OWNED_START]: true });
      await handle.settled?.();
      first.getApprovalManager().stop();
      first.getEventWaitManager().stop();
      assertEquals((await backend.getRun(runId))?.status, "waiting");
      return { backend, definition };
    }

    async function dispatchResume(
      parked: Awaited<ReturnType<typeof parkRun>>,
      resume: Record<string, unknown>,
    ) {
      const handler = new ProjectRunExecuteHandler(createDeps({
        findWorkflowById: async () => ({
          id: "publish",
          filePath: "workflows/publish.ts",
          exportName: "default",
          definition: parked.definition,
        }),
        createWorkflowClient: () =>
          Object.assign(createWorkflowClient({ backend: parked.backend }), {
            statePersistence: "durable" as const,
          }),
        now: () => Date.now(),
        sleep: (ms: number) => delay(Math.min(ms, 10)),
      }));
      const { request, publicKeyPem } = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        { runId, kind: "workflow", target: "workflow:publish", projectId: "proj-1", resume },
      );
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      return await result.response.json();
    }

    async function childRunWaitId(
      parked: Awaited<ReturnType<typeof parkRun>>,
      nodeId: string,
      runIds: string[],
    ): Promise<string> {
      const run = await parked.backend.getRun(runId);
      const waitInstanceId = run?.nodeStates[nodeId]?._waitInstanceId;
      assertExists(waitInstanceId);
      const hashes = await Promise.all(
        runIds.map((childRunId) =>
          computeHash(`child:${waitInstanceId}:${childRunId}`).then((hash) => hash.slice(0, 16))
        ),
      );
      return ["w", ...hashes].join(".");
    }

    const finalize = step("finalize", {
      tool: {
        id: "finalize-tool",
        type: "function",
        description: "Finalize the release",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: () => Promise.resolve({ finalized: true }),
      },
    });

    it("continues an approved run to completion through a second client", async () => {
      const parked = await parkRun([
        waitForApproval("manager-review", { message: "Ship it?" }),
        dependsOn(finalize, "manager-review"),
      ]);

      const payload = await dispatchResume(parked, {
        type: "approval",
        node_id: "manager-review",
        approved: true,
        comment: "ok",
        approver: "user:u1",
      });

      assertEquals(payload.success, true);
      assertEquals(payload.status, undefined);
      assertEquals(payload.error, undefined);
    });

    // #2102/#2114: a resumed run must report the workflow's selected final
    // output (#2107), exactly as the same workflow run without a pause does.
    describe("final output of a resumed run", () => {
      const prepare = step("prepare", {
        tool: {
          id: "prepare-claim",
          type: "function",
          description: "Prepare the claim",
          inputSchema: defineSchema((v) => v.object({}).passthrough())(),
          execute: () => Promise.resolve({ stage: "awaiting-review", claimId: "EXP-1" }),
        },
      });
      const pay = step("finalize", {
        tool: {
          id: "finalize-claim",
          type: "function",
          description: "Pay the claim",
          inputSchema: defineSchema((v) => v.object({}).passthrough())(),
          execute: () => Promise.resolve({ stage: "paid", claimId: "EXP-1" }),
        },
      });
      const selectFinal = (context: Record<string, unknown>) => context.finalize;

      async function uninterruptedOutput(): Promise<unknown> {
        const client = createWorkflowClient({ backend: new MemoryBackend() });
        try {
          client.register(
            workflow({ id: "publish", steps: [prepare, pay], output: selectFinal }).definition,
          );
          const handle = await client.start("publish", {});
          await handle.settled?.();
          const run = await client.getRun(handle.runId);
          assertEquals(run?.status, "completed");
          return run?.output;
        } finally {
          await client.destroy();
        }
      }

      it("completes an approved run with the same output as the run without a pause", async () => {
        const expected = await uninterruptedOutput();
        assertEquals(expected, { stage: "paid", claimId: "EXP-1" });
        const parked = await parkRun([
          prepare,
          waitForApproval("manager-review", { message: "Pay it?" }),
          pay,
        ], selectFinal);

        const payload = await dispatchResume(parked, {
          type: "approval",
          node_id: "manager-review",
          approved: true,
          approver: "user:u1",
        });

        assertEquals(payload.success, true);
        assertEquals(payload.result, expected);
      });

      it("fails a rejected run with no output", async () => {
        const parked = await parkRun([
          prepare,
          waitForApproval("manager-review", { message: "Pay it?" }),
          pay,
        ], selectFinal);

        const payload = await dispatchResume(parked, {
          type: "approval",
          node_id: "manager-review",
          approved: false,
          approver: "user:u1",
        });

        assertEquals(payload.success, false);
        assertEquals(payload.result ?? null, null);
        assertStringIncludes(payload.error, "rejected");
      });
    });

    it("continues all child-run waits without resolving their ids or replaying earlier nodes", async () => {
      let resolutions = 0;
      const parked = await parkRun([
        waitForRuns("durable-children", {
          runIds: () => {
            resolutions++;
            return ["run_child_1", "run_child_2"];
          },
        }),
        dependsOn(finalize, "durable-children"),
      ]);
      assertEquals(resolutions, 1);
      const waitId = await childRunWaitId(
        parked,
        "durable-children",
        ["run_child_1", "run_child_2"],
      );

      const payload = await dispatchResume(parked, { type: "child_run", wait_id: waitId });

      assertEquals(payload.success, true);
      assertEquals(
        resolutions,
        1,
        "resume must consume persisted ids instead of replaying the node",
      );
    });

    it("continues after the child completion patch committed before its resume nudge", async () => {
      const parked = await parkRun([
        waitForRuns("children", { runIds: ["run_child_1"] }),
        dependsOn(finalize, "children"),
      ]);
      const waiting = await parked.backend.getRun(runId);
      const childState = waiting?.nodeStates.children;
      assertExists(childState?._waitInstanceId);
      await parked.backend.updateRun(runId, {
        context: { children: { runIds: ["run_child_1"] } },
        nodeStates: {
          children: {
            ...childState,
            nodeId: "children",
            status: "completed",
            attempt: childState?.attempt ?? 1,
            output: { runIds: ["run_child_1"] },
            completedAt: new Date(),
          },
        },
      });
      const waitId = await childRunWaitId(parked, "children", ["run_child_1"]);

      const payload = await dispatchResume(parked, { type: "child_run", wait_id: waitId });

      assertEquals(payload.success, true);
      assertEquals(payload.status, undefined);
    });

    it("fails an approval that timed out on a deadline dispatch", async () => {
      using time = new FakeTime(Date.UTC(2026, 9, 2));
      const parked = await parkRun([
        waitForApproval("manager-review", { message: "Ship it?", timeout: 50 }),
        dependsOn(finalize, "manager-review"),
      ]);
      const [approval] = await parked.backend.getPendingApprovals(runId);
      assertExists(approval);
      assertEquals(approval.expiresAt?.getTime(), Date.UTC(2026, 9, 2) + 50);
      await time.tickAsync(80);

      const payload = await dispatchResume(parked, { type: "deadline" });

      assertEquals(payload.success, false);
      assertEquals(payload.error, `Approval "${approval.id}" expired`);
    });

    it("fails an event wait that timed out on a deadline dispatch", async () => {
      using time = new FakeTime(Date.UTC(2026, 9, 2));
      const parked = await parkRun([
        waitForEvent("invoice", { eventName: "invoice.received", timeout: 50 }),
        dependsOn(finalize, "invoice"),
      ]);
      const [eventWait] = await parked.backend.getPendingEventWaits(runId);
      assertExists(eventWait);
      assertEquals(eventWait.expiresAt?.getTime(), Date.UTC(2026, 9, 2) + 50);
      await time.tickAsync(80);

      const payload = await dispatchResume(parked, { type: "deadline" });

      assertEquals(payload.success, false);
      assertStringIncludes(payload.error, 'Wait for event "invoice.received"');
      assertStringIncludes(payload.error, "timed out");
    });
  });

  it("does not apply a decision twice when a re-dispatch finds the run already past it", async () => {
    const { client, calls } = resumableClient({ status: "completed", output: { stage: "paid" } });

    const { payload } = await executeResume(client, {
      type: "approval",
      node_id: "manager-review",
      approved: true,
      approver: "user:u1",
    });

    assertEquals(calls, []);
    assertEquals(payload.result, { stage: "paid" });
  });

  it("rejects a resume block on a non-workflow run and a malformed resume block", async () => {
    for (
      const body of [
        {
          runId: "run_task_1",
          kind: "task",
          target: "task:sync",
          projectId: "proj-1",
          resume: { type: "deadline" },
        },
        {
          runId: "run_task_1",
          kind: "workflow",
          target: "workflow:x",
          projectId: "proj-1",
          resume: { type: "later" },
        },
        {
          runId: "run_task_1",
          kind: "workflow",
          target: "workflow:x",
          projectId: "proj-1",
          resume: { type: "child_run" },
        },
        {
          runId: "run_task_1",
          kind: "task",
          target: "task:sync",
          projectId: "proj-1",
          resume: { type: "manual" },
        },
      ]
    ) {
      const handler = new ProjectRunExecuteHandler(createDeps());
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_task_1/execute",
        body,
      );
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      assertEquals(result.response.status >= 400 && result.response.status < 500, true);
    }
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
        cancel: async () => {},
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

  it("refuses a run signed for another project whatever trace context the request carries", async () => {
    const executed: string[] = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async (options) => {
        executed.push(options.projectId ?? "");
        return { success: true, result: {}, durationMs: 1 };
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_other/execute",
      {
        runId: "run_other",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-other",
        parentRunId: "run_proj_1_parent",
        rootRunId: "run_proj_1_root",
      },
      {
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        baggage: "project.id=proj-1,run.id=run_proj_1_parent,root.run.id=run_proj_1_root",
      },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Invalid control-plane signature" });
    assertEquals(executed, []);
  });

  it("rejects runtime targets that carry no identifier for their kind", async () => {
    // Both selections would canonicalize to the empty identifier, so every
    // environment run missing its environment id — and every preview run
    // missing its branch id — would share one durable workflow namespace and
    // could resume another target's runs and approval decision claims.
    const handler = new ProjectRunExecuteHandler(createDeps());

    for (
      const body of [
        {
          runId: "run_bad_environment",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          runtimeTargetKind: "environment",
        },
        {
          runId: "run_bad_preview",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          runtimeTargetKind: "preview_branch",
        },
      ]
    ) {
      const { request, publicKeyPem } = await signedRequest(
        `/api/control-plane/runs/${body.runId}/execute`,
        body,
      );

      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      assertEquals(result.response.status, 400);
    }
  });

  it("rejects runtime targets carrying an identifier from a different kind", async () => {
    // A selection that names both an environment and a preview branch is
    // malformed rather than a namespace: it is exactly what
    // validateRuntimeAgentTargetSelection rejects on the agent invocation
    // contract, and accepting it here would let one request choose which
    // target's durable state it resumes.
    const handler = new ProjectRunExecuteHandler(createDeps());

    for (
      const body of [
        {
          runId: "run_cross_environment",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          runtimeTargetKind: "environment",
          runtimeTargetEnvironmentId: "env-1",
          runtimeTargetBranchId: "branch-1",
        },
        {
          runId: "run_cross_preview",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
          runtimeTargetKind: "preview_branch",
          runtimeTargetEnvironmentId: "env-1",
          runtimeTargetBranchId: "branch-1",
        },
      ]
    ) {
      const { request, publicKeyPem } = await signedRequest(
        `/api/control-plane/runs/${body.runId}/execute`,
        body,
      );

      const result = await handler.handle(request, createCtx(publicKeyPem));

      assertExists(result.response);
      assertEquals(result.response.status, 400);
    }
  });
});

describe("project run execution span", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  async function executeTracedTask(
    runTask: ProjectRunExecuteHandlerDeps["runTask"],
    callerSpanContext?: otelApi.SpanContext,
    lineage: { parentRunId?: string; rootRunId?: string } = {},
    caller: { headers?: Record<string, string>; baggage?: Record<string, string> } = {},
  ): Promise<{
    spans: ReturnType<InMemorySpanExporter["getFinishedSpans"]>;
    body: Record<string, unknown>;
  }> {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    otelApi.context.setGlobalContextManager(contextManager);
    setGlobalTracerProvider(provider as never);
    setGlobalActiveSpanAccessor(otelApi.trace as never);
    setGlobalContextAccessor(otelApi.context as never);

    try {
      const handler = new ProjectRunExecuteHandler(createDeps({ runTask }));
      const body = {
        runId: "run_task_traced",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-1",
        ...lineage,
      };
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_task_traced/execute",
        body,
        caller.headers,
      );

      const tracedContext = callerSpanContext
        ? otelApi.trace.setSpanContext(otelApi.context.active(), callerSpanContext)
        : otelApi.context.active();
      const callerContext = caller.baggage
        ? otelApi.propagation.setBaggage(
          tracedContext,
          otelApi.propagation.createBaggage(
            Object.fromEntries(
              Object.entries(caller.baggage).map(([key, value]) => [key, { value }]),
            ),
          ),
        )
        : tracedContext;
      const result = await otelApi.context.with(
        callerContext,
        () => handler.handle(request, createCtx(publicKeyPem)),
      );
      assertEquals(result.response?.status, 200);
      return { spans: exporter.getFinishedSpans(), body: await result.response!.json() };
    } finally {
      _resetShimForTests();
      contextManager.disable();
      otelApi.context.disable();
      await provider.shutdown();
    }
  }

  it("identifies the run on the execution span", async () => {
    const { spans } = await executeTracedTask(async () => ({
      success: true,
      result: { synced: 1 },
      durationMs: 5,
    }));

    const span = spans.find((candidate) => candidate.name === "project_run.execute");
    assertExists(span);
    assertEquals(span.attributes["run.id"], "run_task_traced");
    assertEquals(span.attributes["run.kind"], "task");
    assertEquals(span.attributes["project.id"], "proj-1");
    assertEquals(span.status.code === SpanStatusCode.ERROR, false);
  });

  it("names the parent and root run of a child run on the execution span", async () => {
    const { spans } = await executeTracedTask(
      async () => ({ success: true, result: { synced: 1 }, durationMs: 5 }),
      undefined,
      { parentRunId: "run_workflow_parent", rootRunId: "run_sched_root" },
    );

    const span = spans.find((candidate) => candidate.name === "project_run.execute");
    assertExists(span);
    assertEquals(span.attributes["parent.run.id"], "run_workflow_parent");
    assertEquals(span.attributes["root.run.id"], "run_sched_root");
  });

  it("marks the execution span as failed when the run fails", async () => {
    const { spans } = await executeTracedTask(async () => ({
      success: false,
      error: "Exactly one style artifact selector is required",
      durationMs: 5,
    }));

    const span = spans.find((candidate) => candidate.name === "project_run.execute");
    assertExists(span);
    assertEquals(span.status.code, SpanStatusCode.ERROR);
  });

  it("marks the execution span as failed when the run throws", async () => {
    const { spans } = await executeTracedTask(() => Promise.reject(new Error("task crashed")));

    const span = spans.find((candidate) => candidate.name === "project_run.execute");
    assertExists(span);
    assertEquals(span.status.code, SpanStatusCode.ERROR);
  });

  it("keeps thrown run error text out of the execution span", async () => {
    const { spans } = await executeTracedTask(() =>
      Promise.reject(new Error("Invoice INV-4471 for jordan@example.test failed"))
    );

    const span = spans.find((candidate) => candidate.name === "project_run.execute");
    assertExists(span);
    assertEquals(span.status.code, SpanStatusCode.ERROR);
    assertEquals(span.status.message, "Error");
    assertEquals(JSON.stringify(span.events).includes("INV-4471"), false);
  });

  it("reports an unserializable run result as a failed execution", async () => {
    const { spans, body } = await executeTracedTask(async () => ({
      success: true,
      result: { total: 1n },
      durationMs: 5,
    }));

    assertEquals(body.success, false);
    const span = spans.find((candidate) => candidate.name === "project_run.execute");
    assertExists(span);
    assertEquals(span.status.code, SpanStatusCode.ERROR);
  });

  it("keeps the signed project and lineage when the caller's trace context names another project's run", async () => {
    const otherProjectCaller = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: otelApi.TraceFlags.SAMPLED,
      isRemote: true,
    };
    const otherProjectLineage = {
      "project.id": "proj-other",
      "run.id": "run_other_project",
      "parent.run.id": "run_other_project",
      "root.run.id": "run_other_project",
    };
    const ranFor: Array<string | undefined> = [];
    const { spans } = await executeTracedTask(
      async (options) => {
        ranFor.push(options.projectId);
        return { success: true, result: { synced: 1 }, durationMs: 5 };
      },
      otherProjectCaller,
      { parentRunId: "run_workflow_parent", rootRunId: "run_sched_root" },
      {
        headers: {
          traceparent: `00-${otherProjectCaller.traceId}-${otherProjectCaller.spanId}-01`,
          baggage: Object.entries(otherProjectLineage).map(([key, value]) => `${key}=${value}`)
            .join(","),
        },
        baggage: otherProjectLineage,
      },
    );

    assertEquals(ranFor, ["proj-1"]);
    const span = spans.find((candidate) => candidate.name === "project_run.execute");
    assertExists(span);
    assertEquals(span.attributes["project.id"], "proj-1");
    assertEquals(span.attributes["run.id"], "run_task_traced");
    assertEquals(span.attributes["parent.run.id"], "run_workflow_parent");
    assertEquals(span.attributes["root.run.id"], "run_sched_root");
    // The caller's context only links the traces; it never parents the run.
    assertEquals(span.parentSpanContext, undefined);
    assertEquals(span.links.map((link) => link.context.traceId), [otherProjectCaller.traceId]);
    const attributeValues = Object.values(span.attributes);
    assertEquals(attributeValues.includes("proj-other"), false);
    assertEquals(attributeValues.includes("run_other_project"), false);
  });

  it("records the execution span as its own trace linked to a sampled-out caller", async () => {
    const caller = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: otelApi.TraceFlags.NONE,
      isRemote: true,
    };
    const { spans } = await executeTracedTask(async () => ({
      success: true,
      result: { synced: 1 },
      durationMs: 5,
    }), caller);

    const span = spans.find((candidate) => candidate.name === "project_run.execute");
    assertExists(span);
    assertEquals(span.parentSpanContext, undefined);
    assertEquals(span.links.map((link) => link.context.traceId), [caller.traceId]);
  });
});

describe("project run inference credential header", () => {
  const INFERENCE_TOKEN = "project-run-inference-credential-canary";
  const taskBody = {
    runId: "run_task_inference",
    kind: "task",
    target: "task:sync-calendar-events",
    projectId: "proj-1",
  };
  const taskPath = "/api/control-plane/runs/run_task_inference/execute";

  async function withCapturedConsole<T>(
    fn: () => Promise<T>,
  ): Promise<{ value: T; lines: string[] }> {
    const lines: string[] = [];
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const originals = methods.map((method) => console[method]);
    for (const method of methods) {
      console[method] = (...args: unknown[]) => {
        lines.push(
          args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "),
        );
      };
    }
    try {
      return { value: await fn(), lines };
    } finally {
      methods.forEach((method, index) => {
        console[method] = originals[index]!;
      });
    }
  }

  it("scopes a managed-model resolver to a task run that carries the header", async () => {
    let resolverInScope: boolean | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        resolverInScope = createProjectRunInferenceModelResolver() !== undefined;
        return { success: true, result: { ok: true }, durationMs: 1 };
      },
    }));
    const { request, publicKeyPem } = await signedRequest(taskPath, taskBody, {
      "X-Veryfront-Inference-Token": INFERENCE_TOKEN,
    });

    const { value: result, lines } = await withCapturedConsole(() =>
      handler.handle(request, createCtx(publicKeyPem))
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(resolverInScope, true);
    // Out of scope once the execution settles.
    assertEquals(createProjectRunInferenceModelResolver(), undefined);
    assertEquals(lines.some((line) => line.includes(INFERENCE_TOKEN)), false);
  });

  it("scopes the resolver to a workflow run that carries the header", async () => {
    let resolverInScope: boolean | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => {
          resolverInScope = createProjectRunInferenceModelResolver() !== undefined;
          return { runId: options?.runId ?? "workflow-run" };
        },
        getRun: async () => ({ status: "completed", output: { deployed: true } }),
        cancel: async () => {},
        destroy: async () => {},
      }),
    }));
    const body = {
      runId: "run_workflow_inference",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_workflow_inference/execute",
      body,
      { "X-Veryfront-Inference-Token": INFERENCE_TOKEN },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(resolverInScope, true);
  });

  it("keeps the current behaviour when the header is absent", async () => {
    let resolverInScope: boolean | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        resolverInScope = createProjectRunInferenceModelResolver() !== undefined;
        return { success: true, result: { synced: 12 }, durationMs: 42 };
      },
    }));
    const { request, publicKeyPem } = await signedRequest(taskPath, taskBody);

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      success: true,
      result: { synced: 12 },
      duration_ms: 42,
      logs: null,
    });
    assertEquals(resolverInScope, false);
  });

  const MALFORMED_HEADERS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["an internal space", [`${INFERENCE_TOKEN} ${INFERENCE_TOKEN}`]],
    // Two headers are joined with ", ", which the credential check refuses.
    ["a duplicated header", [INFERENCE_TOKEN, INFERENCE_TOKEN]],
    ["a value over the inference credential bound", [INFERENCE_TOKEN + "x".repeat(16 * 1024)]],
    ["an empty value", [""]],
  ];

  for (const [label, values] of MALFORMED_HEADERS) {
    it(`rejects ${label} before running anything, without echoing it`, async () => {
      let ran = false;
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: async () => {
          ran = true;
          return { success: true, result: null, durationMs: 0 };
        },
      }));
      const signed = await signedRequest(taskPath, taskBody);
      const headers = new Headers(signed.request.headers);
      for (const value of values) headers.append("X-Veryfront-Inference-Token", value);
      const request = new Request(signed.request, { headers });

      const { value: result, lines } = await withCapturedConsole(() =>
        handler.handle(request, createCtx(signed.publicKeyPem))
      );

      assertExists(result.response);
      assertEquals(result.response.status, 400);
      const text = await result.response.text();
      assertEquals(text.includes(INFERENCE_TOKEN), false);
      assertEquals(ran, false);
      assertEquals(lines.some((line) => line.includes(INFERENCE_TOKEN)), false);
    });
  }

  it("reads both run credentials from a request the runtime sealed at ingress", async () => {
    let receivedAuthToken: string | undefined;
    let resolverInScope: boolean | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      createEvalAgentAdapter: (config) => {
        receivedAuthToken = config.authToken;
        resolverInScope = createProjectRunInferenceModelResolver() !== undefined;
        return async () => ({ text: "Paris" });
      },
    }));
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_sealed/execute",
      {
        runId: "run_eval_sealed",
        kind: "task",
        target: "task:eval",
        projectId: "proj-1",
        config: { eval_id: "eval:deep-research", agent_id: "researcher" },
      },
      { "x-token": "project-runtime-token", "X-Veryfront-Inference-Token": INFERENCE_TOKEN },
    );
    const sealed = sealIngressCredentials(request);
    assertEquals(sealed.headers.get("x-token"), null);
    assertEquals(sealed.headers.get("X-Veryfront-Inference-Token"), null);

    const result = await handler.handle(sealed, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200, JSON.stringify(await result.response.json()));
    assertEquals(receivedAuthToken, "project-runtime-token");
    assertEquals(resolverInScope, true);
  });

  it("keeps the credential out of reach of eval project code that patches Headers.get", async () => {
    const seen: unknown[] = [];
    const originalGet = Headers.prototype.get;
    let receivedAuthToken: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: runTaskDefinition,
      // Stands in for loading the project eval module: from here on, project
      // code has replaced Headers.prototype.get and records every value.
      findEvalById: async (target, options) => {
        Headers.prototype.get = function (this: Headers, name: string) {
          // Whatever header the framework asks for, also read the credential
          // from the same Headers object with the saved original getter.
          seen.push(originalGet.call(this, "X-Veryfront-Inference-Token"));
          return originalGet.call(this, name);
        };
        return await createDeps().findEvalById(target, options);
      },
      createEvalAgentAdapter: (config) => {
        receivedAuthToken = config.authToken;
        return async () => ({ text: "Paris" });
      },
    }));
    const body = {
      runId: "run_eval_inference",
      kind: "task",
      target: "task:eval",
      projectId: "proj-1",
      config: { eval_id: "eval:deep-research", agent_id: "researcher" },
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_eval_inference/execute",
      body,
      { "x-token": "project-runtime-token", "X-Veryfront-Inference-Token": INFERENCE_TOKEN },
    );

    let result;
    try {
      result = await handler.handle(request, createCtx(publicKeyPem));
    } finally {
      Headers.prototype.get = originalGet;
    }

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    // The patched getter ran against the execution's request, which has no credential.
    assertEquals(seen.length > 0, true);
    assertEquals(seen.includes(INFERENCE_TOKEN), false);
    assertEquals(receivedAuthToken, "project-runtime-token");
  });

  it("copies the request without running patched header iteration over the credential", async () => {
    const seen: string[] = [];
    const record = (value: unknown) => seen.push(JSON.stringify(value) ?? "");
    const prototype = Headers.prototype as unknown as Record<PropertyKey, unknown>;
    const iteratorPrototype = Object.getPrototypeOf(new Headers().entries()) as Record<
      string,
      unknown
    >;
    const originals = {
      iterator: prototype[Symbol.iterator] as (this: Headers) => IterableIterator<[string, string]>,
      entries: prototype.entries as (this: Headers) => IterableIterator<[string, string]>,
      forEach: prototype.forEach as (this: Headers, ...args: unknown[]) => void,
      next: iteratorPrototype.next as (this: unknown) => IteratorResult<unknown>,
    };
    // Installed before the execute request, as by a project module from an earlier run.
    prototype[Symbol.iterator] = function (this: Headers) {
      for (const entry of originals.entries.call(this)) record(entry);
      return originals.iterator.call(this);
    };
    prototype.entries = function (this: Headers) {
      for (const entry of originals.iterator.call(this)) record(entry);
      return originals.entries.call(this);
    };
    prototype.forEach = function (this: Headers, ...args: unknown[]) {
      for (const entry of originals.iterator.call(this)) record(entry);
      return originals.forEach.apply(this, args);
    };
    iteratorPrototype.next = function (this: unknown) {
      const step = originals.next.call(this);
      record(step.value);
      return step;
    };
    let received: Request | undefined;
    let result;
    try {
      const handler = new ProjectRunExecuteHandler(createDeps({
        executeKnowledgeIngest: async ({ req }) => {
          received = req;
          return { success: true, result: null, logs: null, duration_ms: 0 };
        },
      }));
      const { request, publicKeyPem } = await signedRequest(
        "/api/control-plane/runs/run_iterate_inference/execute",
        {
          runId: "run_iterate_inference",
          kind: "task",
          target: "task:knowledge-ingest",
          projectId: "proj-1",
        },
        { "x-token": "project-runtime-token", "X-Veryfront-Inference-Token": INFERENCE_TOKEN },
      );
      // Only what the handler does from here on is observed.
      seen.length = 0;
      result = await handler.handle(request, createCtx(publicKeyPem));
    } finally {
      prototype[Symbol.iterator] = originals.iterator;
      prototype.entries = originals.entries;
      prototype.forEach = originals.forEach;
      iteratorPrototype.next = originals.next;
    }

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertExists(received);
    assertEquals(received.headers.get("x-token"), "project-runtime-token");
    assertEquals(seen.some((value) => value.includes(INFERENCE_TOKEN)), false);
  });

  it("passes execution a request without the credential but with its other headers", async () => {
    let received: Request | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      executeKnowledgeIngest: async ({ req }) => {
        received = req;
        return { success: true, result: null, logs: null, duration_ms: 0 };
      },
    }));
    const body = {
      runId: "run_ingest_inference",
      kind: "task",
      target: "task:knowledge-ingest",
      projectId: "proj-1",
    };
    const { request, publicKeyPem } = await signedRequest(
      "/api/control-plane/runs/run_ingest_inference/execute",
      body,
      { "x-token": "project-runtime-token", "X-Veryfront-Inference-Token": INFERENCE_TOKEN },
    );

    const result = await handler.handle(request, createCtx(publicKeyPem));

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertExists(received);
    assertEquals(received.headers.get("X-Veryfront-Inference-Token"), null);
    assertEquals(received.headers.get("x-token"), "project-runtime-token");
    assertEquals(received.url, request.url);
    assertEquals(received.method, "POST");
  });

  it("still cancels a task run that carries the header", async () => {
    let taskSignal: AbortSignal | undefined;
    let releaseTask!: () => void;
    const taskStarted = Promise.withResolvers<void>();
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async (options) => {
        taskSignal = options.signal;
        taskStarted.resolve();
        await new Promise<void>((resolve) => {
          releaseTask = resolve;
        });
        return { success: true, result: { synced: 1 }, durationMs: 1 };
      },
    }));
    const signed = await signedRequest(taskPath, taskBody, {
      "X-Veryfront-Inference-Token": INFERENCE_TOKEN,
    });
    const controller = new AbortController();
    const request = new Request(signed.request, { signal: controller.signal });

    const pending = handler.handle(request, createCtx(signed.publicKeyPem));
    await taskStarted.promise;
    controller.abort(new Error("run cancelled"));

    try {
      assertExists(taskSignal, "runTask must receive a signal");
      assertEquals(taskSignal.aborted, true);
    } finally {
      releaseTask();
      await pending;
    }
  });

  it("still cancels a workflow run that carries the header", async () => {
    const cancelled: string[] = [];
    let status = "running";
    const controller = new AbortController();
    let polls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        register: () => {},
        start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
          runId: options?.runId ?? "workflow-run",
        }),
        getRun: async () => {
          if (!controller.signal.aborted) controller.abort(new Error("run cancelled"));
          return { status, output: null };
        },
        cancel: async (runId: string) => {
          cancelled.push(runId);
          status = "cancelled";
        },
        destroy: async () => {},
      }),
      sleep: async () => {
        polls += 1;
        if (polls > 5) status = "completed";
      },
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_workflow_inference_cancel/execute",
      {
        runId: "run_workflow_inference_cancel",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
        input: {},
      },
      { "X-Veryfront-Inference-Token": INFERENCE_TOKEN },
    );
    const request = new Request(signed.request, { signal: controller.signal });

    const result = await handler.handle(request, createCtx(signed.publicKeyPem));

    assertEquals(cancelled, ["run_workflow_inference_cancel"]);
    assertExists(result.response);
    assertEquals((await result.response.json()).success, false);
  });

  it("reads the header without a patched Headers.prototype.get seeing it", async () => {
    const seen: unknown[] = [];
    const originalGet = Headers.prototype.get;
    Headers.prototype.get = function (this: Headers, name: string) {
      const value = originalGet.call(this, name);
      seen.push(value);
      return value;
    };
    try {
      const handler = new ProjectRunExecuteHandler(createDeps());
      const { request, publicKeyPem } = await signedRequest(taskPath, taskBody, {
        "X-Veryfront-Inference-Token": INFERENCE_TOKEN,
      });
      const result = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(result.response);
      assertEquals(result.response.status, 200);
    } finally {
      Headers.prototype.get = originalGet;
    }
    assertEquals(seen.includes(INFERENCE_TOKEN), false);
  });
});

// veryfront-issue-inbox#2086: a cancelled project run must reach the running
// task or workflow, not only the control-plane row.
describe("server/handlers/request/project-run-execute.handler cancellation", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  function abortable(request: Request): { request: Request; controller: AbortController } {
    const controller = new AbortController();
    return { request: new Request(request, { signal: controller.signal }), controller };
  }

  async function waitForBarrier<T>(promise: Promise<T>, message: string): Promise<T> {
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          watchdog = setTimeout(() => reject(new Error(message)), 1_000);
        }),
      ]);
    } finally {
      clearTimeout(watchdog);
    }
  }

  it("acknowledges cancellation when workflow input validation rejects before admission", async () => {
    const controller = new AbortController();
    let callbacks = 0;
    const client = createWorkflowClient();
    const definition = workflow({
      id: "publish",
      inputSchema: defineSchema((v) =>
        v.object({
          release: v.string().refine(() => {
            controller.abort(new Error("Run cancelled during input validation"));
            return false;
          }, "Release is unavailable"),
        })
      )(),
      steps: [
        step("noop", {
          tool: tool({
            id: "noop",
            description: "Must not run",
            inputSchema: defineSchema((v) => v.object({}).passthrough())(),
            execute: () => Promise.resolve({}),
          }),
        }),
      ],
    }).definition as unknown as WorkflowDefinition;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: "publish",
        filePath: "workflows/publish.ts",
        exportName: "default",
        definition,
      }),
      createWorkflowClient: () => client,
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_invalid_before_admission/execute",
      {
        runId: "run_invalid_before_admission",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
        input: { release: "candidate" },
      },
      { "x-veryfront-run-stop-token": "opaque-stop-capability" },
    );

    await withMockFetch(async () => {
      callbacks++;
      return Response.json({ acknowledged: true });
    }, async () => {
      const result = await handler.handle(
        new Request(signed.request, { signal: controller.signal }),
        createCtx(signed.publicKeyPem),
      );
      assertExists(result.response);
      const response = await result.response.json();
      assertEquals(response.error_code, "INPUT_VALIDATION_FAILED", JSON.stringify(response));
    });

    assertEquals(callbacks, 1);
    assertEquals(await client.getRun("run_invalid_before_admission"), null);
  });

  for (const storeBeforeReject of [false, true]) {
    it(`keeps a persistence rejection unconfirmed after storage: ${storeBeforeReject}`, async () => {
      const controller = new AbortController();
      let callbacks = 0;
      class RejectingBackend extends MemoryBackend {
        override async createRun(run: WorkflowRun): Promise<void> {
          if (storeBeforeReject) await super.createRun(run);
          controller.abort(new Error("Run cancelled during initial persistence"));
          throw new Error("initial persistence failed");
        }

        override destroy(): Promise<void> {
          return Promise.resolve();
        }
      }
      const backend = new RejectingBackend();
      const client = createWorkflowClient({ backend });
      const definition = workflow({
        id: "publish",
        steps: [
          step("noop", {
            tool: tool({
              id: "noop",
              description: "Must not run",
              inputSchema: defineSchema((v) => v.object({}).passthrough())(),
              execute: () => Promise.resolve({}),
            }),
          }),
        ],
      }).definition as unknown as WorkflowDefinition;
      const handler = new ProjectRunExecuteHandler(createDeps({
        findWorkflowById: async () => ({
          id: "publish",
          filePath: "workflows/publish.ts",
          exportName: "default",
          definition,
        }),
        createWorkflowClient: () => client,
      }));
      const runId = `run_persistence_${storeBeforeReject}`;
      const signed = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        {
          runId,
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
        },
        { "x-veryfront-run-stop-token": "opaque-stop-capability" },
      );

      await withMockFetch(async () => {
        callbacks++;
        return Response.json({ acknowledged: true });
      }, async () => {
        const result = await handler.handle(
          new Request(signed.request, { signal: controller.signal }),
          createCtx(signed.publicKeyPem),
        );
        assertExists(result.response);
        assertStringIncludes((await result.response.json()).error, "initial persistence failed");
      });

      assertEquals(callbacks, 0);
      assertEquals(await backend.getRun(runId) !== null, storeBeforeReject);
    });
  }

  it("observes cancellation until native response transport completion", async () => {
    type NativeHandler = Parameters<DenoServeRuntime["serve"]>[0]["handler"];
    let nativeHandler: NativeHandler | undefined;
    const runtime: DenoServeRuntime = {
      serve(options) {
        nativeHandler = options.handler;
        return {
          addr: { transport: "tcp", hostname: "127.0.0.1", port: 43_211 },
          finished: Promise.resolve(),
          shutdown: () => Promise.resolve(),
        };
      },
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => ({ success: true, result: { synced: 1 }, durationMs: 1 }),
    }));
    const contexts = new Map<string, HandlerContext>();
    const server = await createDenoServerWithRuntime(runtime, async (request) => {
      const runId = new URL(request.url).pathname.split("/")[4];
      assertExists(runId);
      const ctx = contexts.get(runId);
      assertExists(ctx);
      const result = await handler.handle(request, ctx);
      assertExists(result.response);
      return result.response;
    });
    assertExists(nativeHandler);
    const serveRequest = nativeHandler;

    const acknowledgements: Array<{
      runId: string;
      authorization: string | null;
      signalAborted: boolean | undefined;
    }> = [];
    const firstAcknowledged = Promise.withResolvers<void>();

    try {
      await withMockFetch(async (input, init) => {
        const requestInit = observeFetchRequestInit(init);
        const match = new URL(String(input)).pathname.match(/^\/runs\/([^/]+)\/cancellation-ack$/);
        assertExists(match);
        const acknowledgedRunId = match[1];
        assertExists(acknowledgedRunId);
        acknowledgements.push({
          runId: acknowledgedRunId,
          authorization: new Headers(requestInit.headers).get("authorization"),
          signalAborted: requestInit.signal?.aborted,
        });
        if (acknowledgedRunId === "run_native_late_abort") firstAcknowledged.resolve();
        return Response.json({ acknowledged: true });
      }, async () => {
        const firstController = new AbortController();
        const firstCompleted = Promise.withResolvers<void>();
        const firstCompletionThen: typeof firstCompleted.promise.then = (
          onFulfilled,
          onRejected,
        ) => {
          onFulfilled?.();
          return Reflect.apply(Promise.prototype.then, firstCompleted.promise, [
            onFulfilled,
            onRejected,
          ]);
        };
        Object.defineProperty(firstCompleted.promise, "then", { value: firstCompletionThen });
        const firstSigned = await signedRequest(
          "/api/control-plane/runs/run_native_late_abort/execute",
          {
            runId: "run_native_late_abort",
            kind: "task",
            target: "task:sync-calendar-events",
            projectId: "proj-1",
          },
          { "x-veryfront-run-stop-token": "opaque-stop-capability" },
        );
        contexts.set("run_native_late_abort", createCtx(firstSigned.publicKeyPem));
        const firstInfo = {
          remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 52_001 },
          completed: firstCompleted.promise,
        };
        const firstResponse = await serveRequest(
          new Request(firstSigned.request, { signal: firstController.signal }),
          firstInfo,
        );
        assertEquals(firstResponse.status, 200);
        assertEquals(acknowledgements, []);

        firstController.abort(new Error("Run cancelled after response construction"));
        await waitForBarrier(
          firstAcknowledged.promise,
          "late cancellation was not acknowledged before native transport completion",
        );
        assertEquals(acknowledgements, [{
          runId: "run_native_late_abort",
          authorization: "Bearer opaque-stop-capability",
          signalAborted: false,
        }]);
        firstCompleted.resolve();
        await firstCompleted.promise;
        await Promise.resolve();

        const secondController = new AbortController();
        const secondCompleted = Promise.withResolvers<void>();
        const secondSigned = await signedRequest(
          "/api/control-plane/runs/run_native_completed/execute",
          {
            runId: "run_native_completed",
            kind: "task",
            target: "task:sync-calendar-events",
            projectId: "proj-1",
          },
          { "x-veryfront-run-stop-token": "second-stop-capability" },
        );
        contexts.set("run_native_completed", createCtx(secondSigned.publicKeyPem));
        const secondInfo = {
          remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 52_002 },
          completed: secondCompleted.promise,
        };
        const secondResponse = await serveRequest(
          new Request(secondSigned.request, { signal: secondController.signal }),
          secondInfo,
        );
        assertEquals(secondResponse.status, 200);
        secondCompleted.resolve();
        await secondCompleted.promise;
        await Promise.resolve();
        secondController.abort(new Error("Run cancelled after transport completion"));
        await Promise.resolve();
        await Promise.resolve();
        assertEquals(
          acknowledgements.map(({ runId }) => runId),
          ["run_native_late_abort"],
          "a completed request must not retain cancellation ownership",
        );
      });
    } finally {
      await server.stop();
    }
  });

  it("keeps native ingress cancellation alive while Deno delivers the response", async () => {
    const nativeFetch = globalThis.fetch;
    const clientController = new AbortController();
    const responseBodyHeld = Promise.withResolvers<void>();
    const releaseResponseBody = Promise.withResolvers<void>();
    const ingressAborted = Promise.withResolvers<void>();
    const acknowledged = Promise.withResolvers<void>();
    let ingressSignal: AbortSignal | undefined;
    let taskSettled = false;
    let serialized = false;
    const acknowledgements: Array<{
      authorization: string | null;
      signalAborted: boolean | undefined;
    }> = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        taskSettled = true;
        return {
          success: true,
          result: {
            toJSON: () => {
              assertEquals(taskSettled, true);
              serialized = true;
              return { synced: 1 };
            },
          },
          durationMs: 1,
        };
      },
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_native_loopback_stop/execute",
      {
        runId: "run_native_loopback_stop",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-1",
      },
      { "x-veryfront-run-stop-token": "native-stop-capability" },
    );
    const requestPath = new URL(signed.request.url).pathname;
    const requestHeaders = new Headers(signed.request.headers);
    const requestBody = await signed.request.arrayBuffer();
    const ctx = createCtx(signed.publicKeyPem);
    const server = await createDenoServer(async (request) => {
      ingressSignal = request.signal;
      request.signal.addEventListener("abort", () => ingressAborted.resolve(), { once: true });
      if (request.signal.aborted) ingressAborted.resolve();

      const result = await handler.handle(request, ctx);
      assertExists(result.response);
      const responseBytes = new Uint8Array(await result.response.arrayBuffer());
      let bodyCancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          responseBodyHeld.resolve();
          void releaseResponseBody.promise.then(() => {
            if (bodyCancelled) return;
            controller.enqueue(responseBytes);
            controller.close();
          }).catch((error) => {
            if (!bodyCancelled) controller.error(error);
          });
        },
        cancel() {
          bodyCancelled = true;
          releaseResponseBody.resolve();
        },
      });
      return new Response(body, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers: result.response.headers,
      });
    }, { hostname: "127.0.0.1", port: 0 });
    let clientResponse: Response | undefined;

    try {
      await withMockFetch(async (_input, init) => {
        const requestInit = observeFetchRequestInit(init);
        acknowledgements.push({
          authorization: new Headers(requestInit.headers).get("authorization"),
          signalAborted: requestInit.signal?.aborted,
        });
        acknowledged.resolve();
        return Response.json({ acknowledged: true });
      }, async () => {
        const responsePending = nativeFetch(
          `http://127.0.0.1:${server.addr.port}${requestPath}`,
          {
            method: "POST",
            headers: requestHeaders,
            body: requestBody,
            signal: clientController.signal,
          },
        );
        await waitForBarrier(
          responseBodyHeld.promise,
          "native response stream did not reach its delivery barrier",
        );
        clientResponse = await waitForBarrier(
          responsePending,
          "native client did not receive response headers while the body was held",
        );
        assertEquals(clientResponse.status, 200);
        assertEquals(taskSettled, true);
        assertEquals(serialized, true);
        assertExists(ingressSignal);
        assertEquals(ingressSignal.aborted, false);
        assertEquals(acknowledgements, []);

        clientController.abort(new Error("Client disconnected during response delivery"));
        await waitForBarrier(
          ingressAborted.promise,
          "Deno did not abort the native ingress signal after the client disconnected",
        );
        await waitForBarrier(
          acknowledged.promise,
          "native late cancellation did not send a stop acknowledgement",
        );
        assertEquals(ingressSignal.aborted, true);
        assertEquals(acknowledgements, [{
          authorization: "Bearer native-stop-capability",
          signalAborted: false,
        }]);
      });
    } finally {
      releaseResponseBody.resolve();
      if (clientResponse?.body) await clientResponse.body.cancel().catch(() => undefined);
      await server.stop();
    }
  });

  it("retains settled waiting-workflow evidence before cleanup for a transport-late abort", async () => {
    const controller = new AbortController();
    const completed = Promise.withResolvers<void>();
    const acknowledged = Promise.withResolvers<void>();
    const order: string[] = [];
    let callbacks = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        start: async () => ({
          runId: "run_waiting_late_stop",
          settled: async () => {
            order.push("settled");
          },
        }),
        getRun: async () => ({
          status: "waiting",
          pendingApprovals: [{ id: "approval", nodeId: "review" }],
        }),
        getPendingEventWaits: async () => [],
        cancel: async () => {},
        waitForExecutionStopped: async () => {
          order.push("stop-evidence");
          return true;
        },
        destroy: async () => {
          order.push("destroy");
        },
      }),
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_waiting_late_stop/execute",
      {
        runId: "run_waiting_late_stop",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
      },
      { "x-veryfront-run-stop-token": "opaque-stop-capability" },
    );
    const request = new Request(signed.request, { signal: controller.signal });
    recordRequestTransportLifetime(request, completed.promise);

    try {
      await withMockFetch(async () => {
        callbacks++;
        acknowledged.resolve();
        return Response.json({ acknowledged: true });
      }, async () => {
        const result = await handler.handle(request, createCtx(signed.publicKeyPem));
        assertExists(result.response);
        assertEquals((await result.response.json()).status, "waiting");
        assert(
          order.indexOf("stop-evidence") >= 0 &&
            order.indexOf("stop-evidence") < order.indexOf("destroy"),
          `expected stop evidence before destroy, got ${order.join(",")}`,
        );
        assertEquals(callbacks, 0);
        controller.abort(new Error("Run cancelled during waiting response delivery"));
        await waitForBarrier(
          acknowledged.promise,
          "settled waiting workflow did not acknowledge a transport-late abort",
        );
      });
      assertEquals(callbacks, 1);
    } finally {
      completed.resolve();
    }
  });

  it("acknowledges a transport-late abort for a settled run on the real per-request client (#2365)", async () => {
    const controller = new AbortController();
    const completed = Promise.withResolvers<void>();
    const acknowledged = Promise.withResolvers<void>();
    let callbacks = 0;
    const definition = workflow({
      id: "publish",
      steps: [step("finish", {
        tool: tool({
          id: "finish",
          description: "Finish immediately",
          inputSchema: defineSchema((v) => v.object({}).passthrough())(),
          execute: () => Promise.resolve({ ok: true }),
        }),
      })],
    }).definition as unknown as WorkflowDefinition;
    const handler = new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => ({
        id: "publish",
        filePath: "workflows/publish.ts",
        exportName: "default",
        definition,
      }),
      createWorkflowClient: (config) => createWorkflowClient(config),
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_settled_real_client_late_stop/execute",
      {
        runId: "run_settled_real_client_late_stop",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
      },
      { "x-veryfront-run-stop-token": "opaque-stop-capability" },
    );
    const request = new Request(signed.request, { signal: controller.signal });
    recordRequestTransportLifetime(request, completed.promise);

    try {
      await withMockFetch(async () => {
        callbacks++;
        acknowledged.resolve();
        return Response.json({ acknowledged: true });
      }, async () => {
        const result = await handler.handle(request, createCtx(signed.publicKeyPem));
        assertExists(result.response);
        assertEquals((await result.response.json()).success, true);
        assertEquals(callbacks, 0);
        controller.abort(new Error("Run cancelled during response delivery"));
        await waitForBarrier(
          acknowledged.promise,
          "settled local workflow lost its stop evidence before the late abort",
        );
      });
      assertEquals(callbacks, 1);
    } finally {
      completed.resolve();
    }
  });

  it("does not acknowledge a transport-late abort for an unknown resumed workflow", async () => {
    const controller = new AbortController();
    const completed = Promise.withResolvers<void>();
    let callbacks = 0;
    let starts = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        statePersistence: "durable",
        register: () => {},
        start: async () => {
          starts++;
          return { runId: "run_remote_resume_late_stop" };
        },
        getRun: async () => ({ status: "completed", output: { remote: true } }),
        cancel: async () => {},
        waitForExecutionStopped: async () => false,
        destroy: async () => {},
      }),
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_remote_resume_late_stop/execute",
      {
        runId: "run_remote_resume_late_stop",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
        resume: { type: "deadline", wait_id: "remote-wait" },
      },
      { "x-veryfront-run-stop-token": "opaque-stop-capability" },
    );
    const request = new Request(signed.request, { signal: controller.signal });
    recordRequestTransportLifetime(request, completed.promise);

    try {
      await withMockFetch(async () => {
        callbacks++;
        return Response.json({ acknowledged: true });
      }, async () => {
        const result = await handler.handle(request, createCtx(signed.publicKeyPem));
        assertExists(result.response);
        assertEquals((await result.response.json()).result, { remote: true });
        assertEquals(starts, 0);
        controller.abort(new Error("Remote resume request disconnected"));
        await Promise.resolve();
        await Promise.resolve();
      });
      assertEquals(callbacks, 0);
    } finally {
      completed.resolve();
    }
  });

  for (const owned of [true, false]) {
    it(`uses actual local stop evidence after an admitted workflow fails (owned: ${owned})`, async () => {
      const controller = new AbortController();
      const completed = Promise.withResolvers<void>();
      const acknowledged = Promise.withResolvers<void>();
      const order: string[] = [];
      let callbacks = 0;
      const handler = new ProjectRunExecuteHandler(createDeps({
        createWorkflowClient: () => ({
          register: () => {},
          start: async () => ({ runId: `run_admitted_failure_${owned}` }),
          getRun: async () => {
            throw new Error("pause persistence failed");
          },
          cancel: async () => {},
          waitForExecutionStopped: async () => {
            order.push("stop-evidence");
            return owned;
          },
          destroy: async () => {
            order.push("destroy");
          },
        }),
      }));
      const runId = `run_admitted_failure_${owned}`;
      const signed = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        {
          runId,
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
        },
        { "x-veryfront-run-stop-token": "opaque-stop-capability" },
      );
      const request = new Request(signed.request, { signal: controller.signal });
      recordRequestTransportLifetime(request, completed.promise);

      try {
        await withMockFetch(async () => {
          callbacks++;
          acknowledged.resolve();
          return Response.json({ acknowledged: true });
        }, async () => {
          const result = await handler.handle(request, createCtx(signed.publicKeyPem));
          assertExists(result.response);
          assertStringIncludes((await result.response.json()).error, "pause persistence failed");
          assert(
            order.indexOf("stop-evidence") >= 0 &&
              order.indexOf("stop-evidence") < order.indexOf("destroy"),
            `expected stop evidence before destroy, got ${order.join(",")}`,
          );
          controller.abort(new Error("Run cancelled during failure response delivery"));
          if (owned) {
            await waitForBarrier(
              acknowledged.promise,
              "owned failed workflow did not acknowledge a transport-late abort",
            );
          } else {
            await Promise.resolve();
            await Promise.resolve();
          }
        });
        assertEquals(callbacks, owned ? 1 : 0);
      } finally {
        completed.resolve();
      }
    });
  }

  for (const owned of [true, false]) {
    it(`captures resumed execution evidence before deferred cleanup (owned: ${owned})`, async () => {
      const controller = new AbortController();
      const completed = Promise.withResolvers<void>();
      const resumeEntered = Promise.withResolvers<void>();
      const releaseResume = Promise.withResolvers<void>();
      const destroyed = Promise.withResolvers<void>();
      const acknowledged = Promise.withResolvers<void>();
      const order: string[] = [];
      let resumeApplied = false;
      let callbacks = 0;
      let starts = 0;
      const handler = new ProjectRunExecuteHandler(createDeps({
        workflowResumeTimeoutMs: 5,
        createWorkflowClient: () => ({
          statePersistence: "durable",
          register: () => {},
          start: async () => {
            starts++;
            return { runId: `run_active_resume_${owned}` };
          },
          getRun: async () =>
            resumeApplied ? { status: "completed", output: { resumed: true } } : {
              status: "waiting",
              pendingApprovals: [{ id: "approval", nodeId: "review" }],
            },
          getPendingEventWaits: async () => [],
          approve: async () => {
            resumeEntered.resolve();
            await releaseResume.promise;
            resumeApplied = true;
          },
          cancel: async () => {},
          waitForExecutionStopped: async () => {
            order.push("stop-evidence");
            return owned;
          },
          destroy: async () => {
            order.push("destroy");
            destroyed.resolve();
          },
        }),
      }));
      const runId = `run_active_resume_${owned}`;
      const signed = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        {
          runId,
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
          resume: {
            type: "approval",
            node_id: "review",
            approved: true,
            approver: "user:u1",
          },
        },
        { "x-veryfront-run-stop-token": "opaque-stop-capability" },
      );
      const request = new Request(signed.request, { signal: controller.signal });
      recordRequestTransportLifetime(request, completed.promise);

      try {
        await withMockFetch(async () => {
          callbacks++;
          acknowledged.resolve();
          return Response.json({ acknowledged: true });
        }, async () => {
          const responsePending = handler.handle(request, createCtx(signed.publicKeyPem));
          await waitForBarrier(
            resumeEntered.promise,
            "resume operation did not reach its held approval",
          );
          const result = await waitForBarrier(
            responsePending,
            "resume timeout response remained blocked by active execution",
          );
          assertExists(result.response);
          assertEquals((await result.response.json()).status, "waiting");
          assertEquals(starts, 0);
          assertEquals(order, []);

          controller.abort(new Error("Resume request disconnected during response delivery"));
          await Promise.resolve();
          await Promise.resolve();
          assertEquals(callbacks, 0, "active resume has not settled yet");

          releaseResume.resolve();
          await waitForBarrier(
            destroyed.promise,
            "settled resume did not release its workflow client",
          );
          assert(
            order.indexOf("stop-evidence") >= 0 &&
              order.indexOf("stop-evidence") < order.indexOf("destroy"),
            `expected resumed stop evidence before destroy, got ${order.join(",")}`,
          );
          if (owned) {
            await waitForBarrier(
              acknowledged.promise,
              "owned resumed execution did not acknowledge observed cancellation",
            );
          } else {
            await Promise.resolve();
            await Promise.resolve();
          }
        });
        assertEquals(callbacks, owned ? 1 : 0);
      } finally {
        releaseResume.resolve();
        completed.resolve();
      }
    });
  }

  it("distinguishes initial and resumed cancellations across pre-admission failures", async () => {
    for (
      const phase of ["discovery", "workflow-lookup", "client-creation", "register"] as const
    ) {
      for (const resume of [false, true]) {
        const controller = new AbortController();
        let callbacks = 0;
        let starts = 0;
        const rejectBeforeAdmission = (): never => {
          controller.abort(new Error(`Run cancelled during ${phase}`));
          throw new Error(`${phase} failed`);
        };
        const client = {
          register: () => {
            if (phase === "register") rejectBeforeAdmission();
          },
          start: async () => {
            starts++;
            return { runId: `run_preadmission_${phase}_${resume}` };
          },
          getRun: async () => ({ status: "completed", output: { unexpected: true } }),
          cancel: async () => {},
          destroy: async () => {},
        };
        const handler = new ProjectRunExecuteHandler(createDeps({
          ensureProjectDiscovery: async () => {
            if (phase === "discovery") rejectBeforeAdmission();
            return createEmptyDiscoveryResult();
          },
          findWorkflowById: async () => {
            if (phase === "workflow-lookup") rejectBeforeAdmission();
            return {
              id: "publish",
              filePath: "workflows/publish.ts",
              exportName: "default",
              definition: { id: "publish", steps: [] },
            };
          },
          createWorkflowClient: () => {
            if (phase === "client-creation") rejectBeforeAdmission();
            return client;
          },
        }));
        const runId = `run_preadmission_${phase}_${resume}`;
        const signed = await signedRequest(
          `/api/control-plane/runs/${runId}/execute`,
          {
            runId,
            kind: "workflow",
            target: "workflow:publish",
            projectId: "proj-1",
            ...(resume ? { resume: { type: "deadline", wait_id: "remote-wait" } } : {}),
          },
          { "x-veryfront-run-stop-token": "opaque-stop-capability" },
        );

        await withMockFetch(async () => {
          callbacks++;
          return Response.json({ acknowledged: true });
        }, async () => {
          const result = await handler.handle(
            new Request(signed.request, { signal: controller.signal }),
            createCtx(signed.publicKeyPem),
          );
          assertExists(result.response);
          assertStringIncludes((await result.response.json()).error, `${phase} failed`);
        });
        assertEquals(starts, 0, `${phase} must reject before workflow start`);
        assertEquals(
          callbacks,
          resume ? 0 : 1,
          `${phase} ${resume ? "resume" : "initial"} acknowledgement count`,
        );
      }
    }
  });

  it("uses captured native abort signal operations for stop observation", async () => {
    for (const actualAbort of [false, true]) {
      const controller = new AbortController();
      const completed = Promise.withResolvers<void>();
      const acknowledged = Promise.withResolvers<void>();
      let callbacks = 0;
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: async () => ({ success: true, result: { synced: 1 }, durationMs: 1 }),
      }));
      const runId = `run_hostile_signal_${actualAbort}`;
      const signed = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        {
          runId,
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
        },
        { "x-veryfront-run-stop-token": "opaque-stop-capability" },
      );
      const transportRequest = new Request(signed.request, { signal: controller.signal });
      recordRequestTransportLifetime(transportRequest, completed.promise);
      const handlerRequest = inheritRequestPeerProvenance(
        transportRequest,
        new Request(transportRequest),
      );
      Object.defineProperties(transportRequest.signal, {
        aborted: { value: !actualAbort },
        addEventListener: {
          value: () => {
            throw new Error("own addEventListener must not be used");
          },
        },
        removeEventListener: {
          value: () => {
            throw new Error("own removeEventListener must not be used");
          },
        },
      });

      try {
        await withMockFetch(async () => {
          callbacks++;
          acknowledged.resolve();
          return Response.json({ acknowledged: true });
        }, async () => {
          const result = await handler.handle(handlerRequest, createCtx(signed.publicKeyPem));
          assertExists(result.response);
          assertEquals((await result.response.json()).result, { synced: 1 });
          transportRequest.signal.dispatchEvent(new Event("abort"));
          await Promise.resolve();
          await Promise.resolve();
          assertEquals(callbacks, 0, "a synthetic abort event is not native cancellation");
          if (actualAbort) {
            controller.abort(new Error("Actual native cancellation"));
            await waitForBarrier(
              acknowledged.promise,
              "actual abort was hidden by hostile own signal properties",
            );
          } else {
            await Promise.resolve();
            await Promise.resolve();
          }
        });
        assertEquals(callbacks, actualAbort ? 1 : 0);
      } finally {
        completed.resolve();
      }
    }
  });

  it("acknowledges cancellation during output serialization after task settlement", async () => {
    const controller = new AbortController();
    let taskReturned = false;
    const callbacks: Array<{ url: string; init: ReturnType<typeof observeFetchRequestInit> }> = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        taskReturned = true;
        return {
          success: true,
          result: {
            toJSON: () => {
              assertEquals(taskReturned, true);
              controller.abort(new Error("Run cancelled during response serialization"));
              return { synced: 1 };
            },
          },
          durationMs: 1,
        };
      },
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_serialization_stop/execute",
      {
        runId: "run_serialization_stop",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-1",
      },
      { "x-veryfront-run-stop-token": "opaque-stop-capability" },
    );

    await withMockFetch(async (input, init) => {
      callbacks.push({ url: String(input), init: observeFetchRequestInit(init) });
      return Response.json({ acknowledged: true });
    }, async () => {
      const result = await handler.handle(
        new Request(signed.request, { signal: controller.signal }),
        createCtx(signed.publicKeyPem),
      );
      assertExists(result.response);
      assertEquals(await result.response.json(), {
        success: true,
        result: { synced: 1 },
        duration_ms: 1,
        logs: null,
      });
    });

    assertEquals(callbacks.length, 1);
    const callback = callbacks[0];
    assertExists(callback);
    assertEquals(new URL(callback.url).pathname, "/runs/run_serialization_stop/cancellation-ack");
    assertEquals(
      new Headers(callback.init.headers).get("authorization"),
      "Bearer opaque-stop-capability",
    );
    assertEquals(callback.init.signal?.aborted, false);
  });

  it("acknowledges cancellation during workflow output serialization after cleanup", async () => {
    const controller = new AbortController();
    let destroyed = false;
    const callbacks: Array<{ url: string; init: ReturnType<typeof observeFetchRequestInit> }> = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        register: () => {},
        start: async () => ({ runId: "run_workflow_serialization_stop", settled: async () => {} }),
        getRun: async () => ({
          status: "completed",
          output: {
            toJSON: () => {
              assertEquals(destroyed, true, "workflow cleanup must precede outer serialization");
              controller.abort(new Error("Run cancelled during workflow response serialization"));
              return { deployed: true };
            },
          },
        }),
        cancel: async () => {},
        waitForExecutionStopped: async () => true,
        destroy: async () => {
          destroyed = true;
        },
      }),
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_workflow_serialization_stop/execute",
      {
        runId: "run_workflow_serialization_stop",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
      },
      { "x-veryfront-run-stop-token": "opaque-stop-capability" },
    );

    await withMockFetch(async (input, init) => {
      callbacks.push({ url: String(input), init: observeFetchRequestInit(init) });
      return Response.json({ acknowledged: true });
    }, async () => {
      const result = await handler.handle(
        new Request(signed.request, { signal: controller.signal }),
        createCtx(signed.publicKeyPem),
      );
      assertExists(result.response);
      assertEquals(await result.response.json(), {
        success: true,
        result: { deployed: true },
        duration_ms: 0,
        logs: null,
      });
    });

    assertEquals(callbacks.length, 1);
    const callback = callbacks[0];
    assertExists(callback);
    assertEquals(
      new URL(callback.url).pathname,
      "/runs/run_workflow_serialization_stop/cancellation-ack",
    );
    assertEquals(
      new Headers(callback.init.headers).get("authorization"),
      "Bearer opaque-stop-capability",
    );
    assertEquals(callback.init.signal?.aborted, false);
  });

  it("does not acknowledge a timed-out task until its callback actually settles", async () => {
    const realSetTimeout = globalThis.setTimeout;
    using time = new FakeTime(Date.now());
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const settle = Promise.withResolvers<void>();
    const acknowledged = Promise.withResolvers<void>();
    const callbacks: Array<{ url: string; init: ReturnType<typeof observeFetchRequestInit> }> = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      taskDeadlineClock: {
        now: Date.now,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      },
      runTask: async () => {
        started.resolve();
        await settle.promise;
        return { success: true, result: "late", durationMs: 1 };
      },
    }));
    const signed = await signedRequest(
      "/api/control-plane/runs/run_deadline_late_stop/execute",
      {
        runId: "run_deadline_late_stop",
        kind: "task",
        target: "task:sync-calendar-events",
        projectId: "proj-1",
        deadlineAt: new Date(Date.now() + 25).toISOString(),
      },
      { "x-veryfront-run-stop-token": "opaque-stop-capability" },
    );

    // Signing and dispatch can outlast the deadline on a busy host.
    // The deadline clock starts advancing only after task admission.
    await new Promise((resolve) => realSetTimeout(resolve, 50));

    await withMockFetch(async (input, init) => {
      callbacks.push({ url: String(input), init: observeFetchRequestInit(init) });
      acknowledged.resolve();
      return Response.json({ acknowledged: true });
    }, async () => {
      const pending = handler.handle(
        new Request(signed.request, { signal: controller.signal }),
        createCtx(signed.publicKeyPem),
      );
      await started.promise;
      await time.tickAsync(25);
      const result = await waitForBarrier(
        pending,
        "deadline response remained blocked by the task callback",
      );
      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.error_code, "RUN_TIMEOUT");
      assertEquals(callbacks, []);

      controller.abort(new Error("Run cancelled after deadline response"));
      assertEquals(callbacks, [], "deadline response is not callback settlement evidence");
      settle.resolve();
      await waitForBarrier(
        acknowledged.promise,
        "settled timed-out task did not acknowledge observed cancellation",
      );
    });

    assertEquals(callbacks.length, 1);
    const callback = callbacks[0];
    assertExists(callback);
    assertEquals(
      new URL(callback.url).pathname,
      "/runs/run_deadline_late_stop/cancellation-ack",
    );
    assertEquals(callback.init.signal?.aborted, false);
  });

  it("acknowledges a stopped task independently only after its execution settles", async () => {
    const started = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    const controller = new AbortController();
    const callbacks: Array<{ url: string; init: ReturnType<typeof observeFetchRequestInit> }> = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        started.resolve();
        await settled.promise;
        return { success: false, error: "Run cancelled", durationMs: 1 };
      },
    }));
    const signed = await signedRequest("/api/control-plane/runs/run_stop_ack/execute", {
      runId: "run_stop_ack",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
    await withMockFetch(async (url, init) => {
      callbacks.push({ url: String(url), init: observeFetchRequestInit(init) });
      return Response.json({ acknowledged: true });
    }, async () => {
      const pending = handler.handle(
        new Request(signed.request, { signal: controller.signal }),
        createCtx(signed.publicKeyPem),
      );
      await started.promise;
      controller.abort(new Error("Run cancelled"));
      assertEquals(callbacks.length, 0, "abort is not evidence of a stopped task");
      settled.resolve();
      await pending;
    });
    assertEquals(callbacks.length, 1);
    const callback = callbacks[0];
    assertExists(callback);
    assertEquals(new URL(callback.url).pathname, "/runs/run_stop_ack/cancellation-ack");
    assertEquals(callback.init.method, "POST");
    assertEquals(
      new Headers(callback.init.headers).get("authorization"),
      "Bearer opaque-stop-capability",
    );
    assertEquals(callback.init.signal?.aborted, false);
    assertEquals(callback.init.body, "{}");
  });

  for (const cancelled of [false, true]) {
    it(`waits for every knowledge download after a sibling rejects (cancelled: ${cancelled})`, async () => {
      const controller = new AbortController();
      const first = Promise.withResolvers<Response>();
      const sibling = Promise.withResolvers<Response>();
      const started = Promise.withResolvers<void>();
      let downloads = 0;
      let siblingSettled = false;
      const acknowledgements: boolean[] = [];
      const runId = `run_knowledge_fanout_${cancelled}`;
      const signed = await signedRequest(`/api/control-plane/runs/${runId}/execute`, {
        runId,
        kind: "task",
        target: "task:knowledge-ingest",
        projectId: "proj-1",
        config: { paths: ["uploads/first.md", "uploads/sibling.md"] },
      }, {
        "x-token": "test-token",
        "x-veryfront-run-stop-token": "opaque-stop-capability",
      });
      await withMockFetch(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith("/cancellation-ack")) {
          acknowledgements.push(siblingSettled);
          return Response.json({ acknowledged: true });
        }
        for (const name of ["first", "sibling"]) {
          if (url.endsWith(`/uploads/uploads%2F${name}.md/url`)) {
            return Response.json({ signed_url: `https://signed.example.test/${name}.md` });
          }
        }
        assertStringIncludes(url, "https://signed.example.test/");
        downloads++;
        if (downloads === 2) started.resolve();
        if (url.endsWith("/first.md")) return await first.promise;
        try {
          return await sibling.promise;
        } finally {
          siblingSettled = true;
        }
      }, async () => {
        const pending = new ProjectRunExecuteHandler().handle(
          new Request(signed.request, { signal: controller.signal }),
          createCtx(signed.publicKeyPem),
        );
        let beforeSibling: string;
        try {
          await started.promise;
          if (cancelled) controller.abort(new Error("Run cancelled"));
          first.reject(new Error("first download failed"));
          // Give an early return/acknowledgement a bounded observation window
          // while the sibling remains explicitly held by the fixture.
          beforeSibling = await Promise.race([
            pending.then(() => "returned"),
            delay(200).then(() => "waiting"),
          ]);
        } finally {
          sibling.reject(new Error("sibling download failed"));
        }
        const result = await pending;
        assertEquals(acknowledgements, cancelled ? [true] : []);
        assertEquals(beforeSibling, "waiting", "a sibling download is still running");
        assertExists(result.response);
        const payload = await result.response.json();
        assertEquals(payload.success, false);
        assertStringIncludes(payload.error, cancelled ? "Run cancelled" : "first download failed");
      });
    });
  }

  it("acknowledges an already-cancelled task whose deadline elapsed before execution", async () => {
    const controller = new AbortController();
    let starts = 0;
    const callbacks: Array<{ url: string; init: ReturnType<typeof observeFetchRequestInit> }> = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        starts++;
        return { success: true, durationMs: 0 };
      },
    }));
    const signed = await signedRequest("/api/control-plane/runs/run_expired_stop/execute", {
      runId: "run_expired_stop",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
      deadlineAt: "2000-01-01T00:00:00.000Z",
    }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
    const ctx = createCtx(signed.publicKeyPem);
    const readEnv = ctx.adapter.env.get;
    ctx.adapter.env.get = (key) => {
      // Cancellation arrives after the body is read, while authentication loads its key.
      if (key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") {
        controller.abort(new Error("Run cancelled before execution"));
      }
      return readEnv(key);
    };
    await withMockFetch(async (url, init) => {
      callbacks.push({ url: String(url), init: observeFetchRequestInit(init) });
      return Response.json({ acknowledged: true });
    }, async () => {
      const response = await handler.handle(
        new Request(signed.request, { signal: controller.signal }),
        ctx,
      );
      assertExists(response.response);
      const body = await response.response.json();
      assertEquals(body.error_code, "RUN_TIMEOUT", JSON.stringify(body));
    });
    assertEquals(starts, 0);
    assertEquals(callbacks.length, 1);
    const callback = callbacks[0];
    assertExists(callback);
    assertEquals(new URL(callback.url).pathname, "/runs/run_expired_stop/cancellation-ack");
    assertEquals(callback.init.method, "POST");
    assertEquals(
      new Headers(callback.init.headers).get("authorization"),
      "Bearer opaque-stop-capability",
    );
    assertEquals(callback.init.signal?.aborted, false);
  });

  it("acknowledges a cancelled task from an already-sealed ingress request", async () => {
    const controller = new AbortController();
    let exposed: string | null | undefined;
    const callbacks: Array<{ url: string; init: ReturnType<typeof observeFetchRequestInit> }> = [];
    const handler = new ProjectRunExecuteHandler(createDeps({
      executeKnowledgeIngest: async ({ req, signal }) => {
        exposed = req.headers.get("x-veryfront-run-stop-token");
        controller.abort(new Error("Run cancelled"));
        assertEquals(signal.aborted, true);
        return { success: false, error: "Run cancelled" };
      },
    }));
    const signed = await signedRequest("/api/control-plane/runs/run_sealed_stop/execute", {
      runId: "run_sealed_stop",
      kind: "task",
      target: "task:knowledge-ingest",
      projectId: "proj-1",
    }, { "x-veryfront-run-stop-token": "sealed-stop-capability" });
    const request = sealIngressCredentials(
      new Request(signed.request, { signal: controller.signal }),
    );
    assertEquals(request.headers.get("x-veryfront-run-stop-token"), null);
    await withMockFetch(async (url, init) => {
      callbacks.push({ url: String(url), init: observeFetchRequestInit(init) });
      return Response.json({ acknowledged: true });
    }, async () => {
      await handler.handle(request, createCtx(signed.publicKeyPem));
    });
    assertEquals(exposed, null);
    assertEquals(callbacks.length, 1);
    const callback = callbacks[0];
    assertExists(callback);
    assertEquals(new URL(callback.url).pathname, "/runs/run_sealed_stop/cancellation-ack");
    assertEquals(
      new Headers(callback.init.headers).get("authorization"),
      "Bearer sealed-stop-capability",
    );
    assertEquals(callback.init.method, "POST");
    assertEquals(callback.init.signal?.aborted, false);
  });

  it("keeps the stop credential out of reserved task requests and preserves cancellation", async () => {
    let leaked: string | null | undefined;
    const controller = new AbortController();
    const handler = new ProjectRunExecuteHandler(createDeps({
      executeKnowledgeIngest: async ({ req, signal }) => {
        leaked = req.headers.get("x-veryfront-run-stop-token");
        controller.abort(new Error("Run cancelled"));
        assertEquals(signal.aborted, true);
        return { success: false, error: "Run cancelled" };
      },
    }));
    const signed = await signedRequest("/api/control-plane/runs/run_stop_private/execute", {
      runId: "run_stop_private",
      kind: "task",
      target: "task:knowledge-ingest",
      projectId: "proj-1",
    }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
    await withMockFetch(async () => Response.json({ acknowledged: true }), async () => {
      await handler.handle(
        new Request(signed.request, { signal: controller.signal }),
        createCtx(signed.publicKeyPem),
      );
    });
    assertEquals(leaked, null);
  });

  it("acknowledges a cancelled workflow only after its execution handle settles", async () => {
    const cancelled = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    const controller = new AbortController();
    let callbacks = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => ({
        register: () => {},
        start: async () => ({ runId: "run_workflow_ack", settled: () => settled.promise }),
        waitForExecutionStopped: async () => {
          await settled.promise;
          return true;
        },
        getRun: async () => {
          controller.abort(new Error("Run cancelled"));
          return { status: "running" };
        },
        cancel: async () => {
          cancelled.resolve();
        },
        destroy: async () => {},
      }),
    }));
    const signed = await signedRequest("/api/control-plane/runs/run_workflow_ack/execute", {
      runId: "run_workflow_ack",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
    }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
    await withMockFetch(async () => {
      callbacks += 1;
      return Response.json({ acknowledged: true });
    }, async () => {
      const pending = handler.handle(
        new Request(signed.request, { signal: controller.signal }),
        createCtx(signed.publicKeyPem),
      );
      await cancelled.promise;
      assertEquals(callbacks, 0);
      settled.resolve();
      await pending;
    });
    assertEquals(callbacks, 1);
  });

  for (const phase of ["discovery", "client-creation"] as const) {
    for (const resume of [false, true]) {
      it(`acknowledges a received cancellation before ${phase} only for an initial dispatch (resume: ${resume})`, async () => {
        const controller = new AbortController();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let callbacks = 0;
        let starts = 0;
        const beforeStart = async () => {
          entered.resolve();
          await release.promise;
        };
        const handler = new ProjectRunExecuteHandler(createDeps({
          ensureProjectDiscovery: async () => {
            if (phase === "discovery") await beforeStart();
            return createEmptyDiscoveryResult();
          },
          createWorkflowClient: async () => {
            if (phase === "client-creation") await beforeStart();
            return {
              register: () => {},
              start: async () => {
                starts++;
                return { runId: "run_prestart_ack" };
              },
              getRun: async () => ({ status: "running" }),
              cancel: async () => {},
              waitForExecutionStopped: async () => false,
              destroy: async () => {},
            };
          },
        }));
        const signed = await signedRequest("/api/control-plane/runs/run_prestart_ack/execute", {
          runId: "run_prestart_ack",
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
          ...(resume ? { resume: { type: "deadline", wait_id: "w" } } : {}),
        }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
        await withMockFetch(async () => {
          callbacks++;
          return Response.json({ acknowledged: true });
        }, async () => {
          const pending = handler.handle(
            new Request(signed.request, { signal: controller.signal }),
            createCtx(signed.publicKeyPem),
          );
          await entered.promise;
          controller.abort(new Error("Run cancelled before startup"));
          release.resolve();
          await pending;
        });
        assertEquals(starts, 0);
        assertEquals(callbacks, resume ? 0 : 1);
      });
    }
  }

  for (const resume of [false, true]) {
    it(`acknowledges cancellation during an unknown workflow lookup only for initial dispatch (resume: ${resume})`, async () => {
      const controller = new AbortController();
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let callbacks = 0;
      const handler = new ProjectRunExecuteHandler(createDeps({
        findWorkflowById: async () => {
          entered.resolve();
          await release.promise;
          return null;
        },
      }));
      const signed = await signedRequest("/api/control-plane/runs/run_unknown_stop/execute", {
        runId: "run_unknown_stop",
        kind: "workflow",
        target: "workflow:unknown",
        projectId: "proj-1",
        ...(resume ? { resume: { type: "deadline", wait_id: "w" } } : {}),
      }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
      await withMockFetch(async () => {
        callbacks++;
        return Response.json({ acknowledged: true });
      }, async () => {
        const pending = handler.handle(
          new Request(signed.request, { signal: controller.signal }),
          createCtx(signed.publicKeyPem),
        );
        await entered.promise;
        controller.abort(new Error("Run cancelled during lookup"));
        release.resolve();
        const response = await pending;
        assertExists(response.response);
        assertEquals((await response.response.json()).error, "Workflow not found: unknown");
      });
      assertEquals(callbacks, resume ? 0 : 1);
    });
  }

  for (const status of ["completed", "waiting"] as const) {
    it(`destroys a ${status} workflow client before waiting for raw stop evidence`, async () => {
      const controller = new AbortController();
      const evidenceRequested = Promise.withResolvers<void>();
      const stopped = Promise.withResolvers<boolean>();
      let destroyed = false;
      let callbacks = 0;
      const handler = new ProjectRunExecuteHandler(createDeps({
        createWorkflowClient: () => ({
          register: () => {},
          start: async () => ({
            runId: "run_cleanup_before_stop",
            settled: async () => {
              controller.abort(new Error("Run cancelled after its boundary settled"));
            },
          }),
          getRun: async () => ({ status }),
          cancel: async () => {},
          waitForExecutionStopped: () => {
            evidenceRequested.resolve();
            return stopped.promise;
          },
          destroy: async () => {
            destroyed = true;
          },
        }),
      }));
      const signed = await signedRequest(
        "/api/control-plane/runs/run_cleanup_before_stop/execute",
        {
          runId: "run_cleanup_before_stop",
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
        },
        { "x-veryfront-run-stop-token": "opaque-stop-capability" },
      );
      await withMockFetch(async () => {
        callbacks++;
        return Response.json({ acknowledged: true });
      }, async () => {
        const pending = handler.handle(
          new Request(signed.request, { signal: controller.signal }),
          createCtx(signed.publicKeyPem),
        );
        try {
          await evidenceRequested.promise;
          await delay(0);
          assertEquals(callbacks, 0);
          assertEquals(destroyed, true, "raw work must not block client cleanup");
        } finally {
          stopped.resolve(true);
          await pending;
        }
      });
      assertEquals(callbacks, 1);
    });
  }

  for (const status of ["completed", "failed"] as const) {
    for (const owned of [true, false]) {
      it(`acknowledges cancellation during ${status} workflow cleanup only with local settlement (owned: ${owned})`, async () => {
        const controller = new AbortController();
        const cleanup = Promise.withResolvers<void>();
        const releaseCleanup = Promise.withResolvers<void>();
        let callbacks = 0;
        const handler = new ProjectRunExecuteHandler(createDeps({
          createWorkflowClient: () => ({
            register: () => {},
            start: async () => ({ runId: "run_cleanup_ack", settled: async () => {} }),
            getRun: async () => ({ status }),
            cancel: async () => {},
            waitForExecutionStopped: async () => owned,
            destroy: async () => {
              cleanup.resolve();
              await releaseCleanup.promise;
            },
          }),
        }));
        const signed = await signedRequest("/api/control-plane/runs/run_cleanup_ack/execute", {
          runId: "run_cleanup_ack",
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
        }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
        await withMockFetch(async () => {
          callbacks += 1;
          return Response.json({ acknowledged: true });
        }, async () => {
          const pending = handler.handle(
            new Request(signed.request, { signal: controller.signal }),
            createCtx(signed.publicKeyPem),
          );
          await cleanup.promise;
          assertEquals(callbacks, 0);
          controller.abort(new Error("Run cancelled during cleanup"));
          releaseCleanup.resolve();
          await pending;
        });
        assertEquals(callbacks, owned ? 1 : 0);
      });
    }
  }

  for (const outcome of ["normal", "no-credential", "callback-failure"] as const) {
    it(`stop acknowledgement handles ${outcome} without changing the execution result`, async () => {
      const controller = new AbortController();
      let callbacks = 0;
      const handler = new ProjectRunExecuteHandler(createDeps({
        runTask: async () => {
          if (outcome !== "normal") controller.abort(new Error("Run cancelled"));
          return { success: true, result: 42, durationMs: 1 };
        },
      }));
      const signed = await signedRequest(
        "/api/control-plane/runs/run_stop_outcome/execute",
        {
          runId: "run_stop_outcome",
          kind: "task",
          target: "task:sync-calendar-events",
          projectId: "proj-1",
        },
        outcome === "no-credential"
          ? {}
          : { "x-veryfront-run-stop-token": "opaque-stop-capability" },
      );
      await withMockFetch(async () => {
        callbacks += 1;
        throw new Error("Callback unavailable");
      }, async () => {
        const result = await handler.handle(
          new Request(signed.request, { signal: controller.signal }),
          createCtx(signed.publicKeyPem),
        );
        assertExists(result.response);
        assertEquals((await result.response.json()).result, 42);
      });
      assertEquals(callbacks, outcome === "callback-failure" ? 1 : 0);
    });
  }

  it("keeps the stop capability on the host API when project environment selects another origin", async () => {
    const controller = new AbortController();
    const trustedOrigin = new URL(resolveHostOwnedSourceApiBaseUrl()).origin;
    let callbackUrl: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async () => {
        controller.abort(new Error("Run cancelled"));
        return { success: false, error: "Run cancelled", durationMs: 1 };
      },
    }));
    const signed = await signedRequest("/api/control-plane/runs/run_stop_host/execute", {
      runId: "run_stop_host",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
    await withMockFetch(
      async (url) => {
        callbackUrl = String(url);
        return Response.json({ acknowledged: true });
      },
      () =>
        runWithProjectEnv({
          VERYFRONT_API_BASE_URL: "https://tenant.example.test",
          VERYFRONT_API_URL: "https://tenant.example.test",
        }, async () => {
          await handler.handle(
            new Request(signed.request, { signal: controller.signal }),
            createCtx(signed.publicKeyPem),
          );
        }),
    );
    assertExists(callbackUrl);
    assertEquals(new URL(callbackUrl).origin, trustedOrigin);
  });

  for (const ownsExecution of [true, false]) {
    it(`resumed workflow cancellation requires actual local settlement (owned: ${ownsExecution})`, async () => {
      const cancelled = Promise.withResolvers<void>();
      const settled = Promise.withResolvers<void>();
      const controller = new AbortController();
      let callbacks = 0;
      const handler = new ProjectRunExecuteHandler(createDeps({
        createWorkflowClient: () => ({
          statePersistence: "durable",
          register: () => {},
          start: async () => {
            throw new Error("Resume must not start a new workflow");
          },
          getRun: async () => {
            controller.abort(new Error("Run cancelled"));
            return { status: "running" };
          },
          cancel: async () => {
            cancelled.resolve();
          },
          waitForExecutionStopped: async () => {
            await settled.promise;
            return ownsExecution;
          },
          destroy: async () => {},
        }),
      }));
      const signed = await signedRequest("/api/control-plane/runs/run_resume_stop/execute", {
        runId: "run_resume_stop",
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
        resume: { type: "deadline", wait_id: "w" },
      }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
      await withMockFetch(async () => {
        callbacks += 1;
        return Response.json({ acknowledged: true });
      }, async () => {
        const pending = handler.handle(
          new Request(signed.request, { signal: controller.signal }),
          createCtx(signed.publicKeyPem),
        );
        await cancelled.promise;
        assertEquals(callbacks, 0, "durable cancel alone is not stop evidence");
        settled.resolve();
        await pending;
      });
      assertEquals(callbacks, ownsExecution ? 1 : 0);
    });
  }

  it("runs without acknowledgement when the host callback endpoint cannot be configured safely", async () => {
    const controller = new AbortController();
    let ran = false;
    let exposed: string | null | undefined;
    let callbacks = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      executeKnowledgeIngest: async ({ req }) => {
        ran = true;
        exposed = req.headers.get("x-veryfront-run-stop-token");
        controller.abort(new Error("Run cancelled"));
        return { success: true, result: 42 };
      },
    }));
    const signed = await signedRequest("/api/control-plane/runs/run_stop_setup/execute", {
      runId: "run_stop_setup",
      kind: "task",
      target: "task:knowledge-ingest",
      projectId: "proj-1",
    }, { "x-veryfront-run-stop-token": "opaque-stop-capability" });
    await withEnv({
      VERYFRONT_API_BASE_URL: "http://localhost:4000",
      VERYFRONT_API_URL: "http://localhost:4000",
    }, () =>
      withMockFetch(async () => {
        callbacks += 1;
        return Response.json({ acknowledged: true });
      }, async () => {
        const result = await handler.handle(
          new Request(signed.request, { signal: controller.signal }),
          createCtx(signed.publicKeyPem),
        );
        assertExists(result.response);
        assertEquals(result.response.status, 200);
        assertEquals((await result.response.json()).result, 42);
      }));
    assertEquals(ran, true);
    assertEquals(exposed, null, "unavailable callback must still keep its credential private");
    assertEquals(callbacks, 0);
  });

  it("hands the task its supported cooperative cancellation signal", async () => {
    let taskSignal: AbortSignal | undefined;
    let releaseTask!: () => void;
    const taskStarted = Promise.withResolvers<void>();
    const handler = new ProjectRunExecuteHandler(createDeps({
      runTask: async (options) => {
        taskSignal = options.signal;
        taskStarted.resolve();
        await new Promise<void>((resolve) => {
          releaseTask = resolve;
        });
        return { success: true, result: { synced: 1 }, durationMs: 1 };
      },
    }));
    const body = {
      runId: "run_task_cancel",
      kind: "task",
      target: "task:sync-calendar-events",
      projectId: "proj-1",
    };
    const signed = await signedRequest("/api/control-plane/runs/run_task_cancel/execute", body);
    const { request, controller } = abortable(signed.request);

    const pending = handler.handle(request, createCtx(signed.publicKeyPem));
    await taskStarted.promise;
    controller.abort(new Error("run cancelled"));

    try {
      assertExists(taskSignal, "runTask must receive a signal");
      assertEquals(taskSignal.aborted, true);
    } finally {
      releaseTask();
      await pending;
    }
  });

  it("cancels the workflow run instead of polling it to completion", async () => {
    const cancelled: string[] = [];
    let status = "running";
    const controller = new AbortController();
    const client = {
      register: () => {},
      start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
        runId: options?.runId ?? "workflow-run",
      }),
      getRun: async () => {
        // Cancellation arrives while the workflow is still running.
        if (!controller.signal.aborted) controller.abort(new Error("run cancelled"));
        return { status, output: null };
      },
      cancel: async (runId: string) => {
        cancelled.push(runId);
        status = "cancelled";
      },
      destroy: async () => {},
    };
    let polls = 0;
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => client,
      sleep: async () => {
        polls += 1;
        // Stand in for the real poll timeout so a missing cancel fails fast.
        if (polls > 5) status = "completed";
      },
    }));
    const body = {
      runId: "run_workflow_cancel",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: {},
    };
    const signed = await signedRequest("/api/control-plane/runs/run_workflow_cancel/execute", body);
    const request = new Request(signed.request, { signal: controller.signal });

    const result = await handler.handle(request, createCtx(signed.publicKeyPem));

    assertEquals(cancelled, ["run_workflow_cancel"]);
    assertExists(result.response);
    const json = await result.response.json();
    assertEquals(json.success, false);
  });

  it("cancels a workflow run that reached waiting when the request was aborted", async () => {
    const cancelled: string[] = [];
    let status = "waiting";
    const controller = new AbortController();
    const client = {
      register: () => {},
      statePersistence: "durable" as const,
      start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
        runId: options?.runId ?? "workflow-run",
      }),
      getRun: async () => {
        // The cancel lands in the same poll in which the workflow parks.
        if (!controller.signal.aborted) controller.abort(new Error("run cancelled"));
        return { status, output: null };
      },
      cancel: async (runId: string) => {
        cancelled.push(runId);
        status = "cancelled";
      },
      destroy: async () => {},
    };
    const handler = new ProjectRunExecuteHandler(
      createDeps({ createWorkflowClient: () => client }),
    );
    const body = {
      runId: "run_workflow_waiting_cancel",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: {},
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_workflow_waiting_cancel/execute",
      body,
    );
    const request = new Request(signed.request, { signal: controller.signal });

    const result = await handler.handle(request, createCtx(signed.publicKeyPem));

    assertEquals(cancelled, ["run_workflow_waiting_cancel"]);
    assertExists(result.response);
    const json = await result.response.json();
    assertEquals(json.success, false);
  });

  it("cancels a waiting workflow when the abort arrives while its pause is persisted", async () => {
    const cancelled: string[] = [];
    let status = "waiting";
    const controller = new AbortController();
    const client = {
      register: () => {},
      statePersistence: "durable" as const,
      start: async (_workflowId: string, _input: unknown, options?: { runId?: string }) => ({
        runId: options?.runId ?? "workflow-run",
        // Cancellation lands after the last poll, while the pause is persisted.
        settled: async () => {
          controller.abort(new Error("run cancelled"));
        },
      }),
      getRun: async () => ({
        status,
        output: null,
        pendingApprovals: [{ id: "approval-1", nodeId: "review" }],
      }),
      cancel: async (runId: string) => {
        cancelled.push(runId);
        status = "cancelled";
      },
      destroy: async () => {},
    };
    const handler = new ProjectRunExecuteHandler(
      createDeps({ createWorkflowClient: () => client }),
    );
    const body = {
      runId: "run_workflow_settle_cancel",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: {},
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_workflow_settle_cancel/execute",
      body,
    );
    const request = new Request(signed.request, { signal: controller.signal });

    const result = await handler.handle(request, createCtx(signed.publicKeyPem));

    assertEquals(cancelled, ["run_workflow_settle_cancel"]);
    assertExists(result.response);
    const json = await result.response.json();
    assertEquals(json.success, false);
  });

  it("does not start a workflow whose run was cancelled before it started", async () => {
    const started: string[] = [];
    const controller = new AbortController();
    const client = {
      register: () => {},
      start: async (workflowId: string, _input: unknown, options?: { runId?: string }) => {
        started.push(workflowId);
        return { runId: options?.runId ?? "workflow-run" };
      },
      getRun: async () => ({ status: "completed", output: { done: true } }),
      cancel: async () => {},
      destroy: async () => {},
    };
    const handler = new ProjectRunExecuteHandler(createDeps({
      createWorkflowClient: () => {
        // The cancel lands while the workflow is still being loaded.
        controller.abort(new Error("run cancelled"));
        return client;
      },
    }));
    const body = {
      runId: "run_workflow_cancel_before_start",
      kind: "workflow",
      target: "workflow:publish",
      projectId: "proj-1",
      input: {},
    };
    const signed = await signedRequest(
      "/api/control-plane/runs/run_workflow_cancel_before_start/execute",
      body,
    );
    const request = new Request(signed.request, { signal: controller.signal });

    const result = await handler.handle(request, createCtx(signed.publicKeyPem));

    assertEquals(started, []);
    assertExists(result.response);
    const json = await result.response.json();
    assertEquals(json.success, false);
  });
});

describe("server/handlers/request/project-run-execute.handler manual pause (#2588)", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  const runId = "run_7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  /** Keeps durable state across dispatches; each dispatch destroys its own client. */
  class SharedMemoryBackend extends MemoryBackend {
    override destroy(): Promise<void> {
      return Promise.resolve();
    }
  }

  function countingStep(id: string, calls: string[]): WorkflowNode {
    return step(id, {
      tool: tool({
        id: `${id}-tool`,
        description: `Record ${id}`,
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: () => {
          calls.push(id);
          return Promise.resolve({ [id]: true });
        },
      }),
    });
  }

  function threeSteps(calls: string[]): WorkflowDefinition {
    return workflow({
      id: "publish",
      steps: [
        countingStep("first", calls),
        dependsOn(countingStep("second", calls), "first"),
        dependsOn(countingStep("third", calls), "second"),
      ],
    }).definition as unknown as WorkflowDefinition;
  }

  function createHandler(
    backend: MemoryBackend,
    definition: WorkflowDefinition,
    options: {
      statePersistence?: "durable" | "ephemeral";
      now?: () => number;
      onDiscover?: () => void;
      onResume?: () => void;
      sleep?: (ms: number) => Promise<void>;
      workflowResumeTimeoutMs?: number;
    } = {},
  ): ProjectRunExecuteHandler {
    return new ProjectRunExecuteHandler(createDeps({
      findWorkflowById: async () => {
        options.onDiscover?.();
        return {
          id: "publish",
          filePath: "workflows/publish.ts",
          exportName: "default",
          definition,
        };
      },
      createWorkflowClient: (config) => {
        const client = createWorkflowClient({ ...config, backend });
        const resume = client.resume.bind(client);
        return Object.assign(client, {
          statePersistence: options.statePersistence ?? "durable" as const,
          resume: (...args: Parameters<typeof resume>) => {
            options.onResume?.();
            return resume(...args);
          },
        });
      },
      now: options.now ?? (() => 0),
      sleep: options.sleep ?? ((ms: number) => delay(Math.min(ms, 10))),
      ...(options.workflowResumeTimeoutMs === undefined
        ? {}
        : { workflowResumeTimeoutMs: options.workflowResumeTimeoutMs }),
    }));
  }

  async function dispatch(
    handler: ProjectRunExecuteHandler,
    resume?: Record<string, unknown>,
    signal?: AbortSignal,
    stopToken = "opaque-stop-capability",
  ): Promise<Record<string, unknown>> {
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      {
        runId,
        kind: "workflow",
        target: "workflow:publish",
        projectId: "proj-1",
        ...(resume ? { resume } : {}),
      },
      { "x-veryfront-run-stop-token": stopToken },
    );
    const result = await handler.handle(
      signal ? new Request(request, { signal }) : request,
      createCtx(publicKeyPem),
    );
    assertExists(result.response);
    return await result.response.json();
  }

  function pauseAckCalls(urls: string[]): string[] {
    return urls.filter((url) => new URL(url).pathname === `/runs/${runId}/pause-ack`);
  }

  it("pauses at a batch boundary and resumes manually under the same run id", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);
    const urls: string[] = [];
    const authorizations: Array<string | null> = [];
    let pauseRequested = true;

    await withMockFetch(async (input, init) => {
      urls.push(String(input));
      authorizations.push(new Headers(observeFetchRequestInit(init).headers).get("authorization"));
      const paused = pauseRequested;
      pauseRequested = false;
      return Response.json({ stop: paused });
    }, async () => {
      const first = await dispatch(createHandler(backend, definition));
      assertEquals(first, {
        success: true,
        status: "waiting",
        waiting_reason: "manual_pause",
        waiting: {},
        logs: null,
        duration_ms: 0,
      });
      assertEquals(calls, ["first"]);
      const paused = await backend.getRun(runId);
      assertEquals(paused?.status, "waiting");
      assertEquals(paused?.currentNodes, []);

      const resumed = await dispatch(createHandler(backend, definition), { type: "manual" });
      assertEquals(resumed.success, true);
      assertEquals(resumed.status, undefined);
      assertEquals(resumed.error, undefined);
    });

    assertEquals(calls, ["first", "second", "third"]);
    assertEquals((await backend.getRun(runId))?.status, "completed");
    assertEquals(pauseAckCalls(urls).length, urls.length);
    // The boundary that paused, the check before resuming, and the next boundary.
    assertEquals(urls.length, 3);
    assertEquals(authorizations.every((value) => value === "Bearer opaque-stop-capability"), true);
  });

  it("reports the pause instead of releasing it when the resuming attempt is told to stop", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);

    await withMockFetch(async () => Response.json({ stop: true }), async () => {
      await dispatch(createHandler(backend, definition));
      // A duplicate of an earlier resume dispatch, or an attempt whose run was paused again.
      const duplicate = await dispatch(createHandler(backend, definition), { type: "manual" });
      assertEquals(duplicate.status, "waiting");
      assertEquals(duplicate.waiting_reason, "manual_pause");
    });

    assertEquals(calls, ["first"]);
    assertEquals((await backend.getRun(runId))?.status, "waiting");
  });

  it("holds the boundary under request primitive tampering until cancellation", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const controller = new AbortController();
    const original = Object.getOwnPropertyDescriptor(Request.prototype, "signal")!;
    const definition = workflow({
      id: "publish",
      steps: [
        step("replace-signal", {
          tool: tool({
            id: "replace-signal-tool",
            description: "Replace the request signal getter",
            inputSchema: defineSchema((v) => v.object({}).passthrough())(),
            execute: () => {
              Object.defineProperty(Request.prototype, "signal", {
                ...original,
                // A forged, already aborted signal would read as a cancellation and pause the run.
                get() {
                  return AbortSignal.abort();
                },
              });
              return Promise.resolve({ replaced: true });
            },
          }),
        }),
        dependsOn(countingStep("after", calls), "replace-signal"),
      ],
    }).definition as unknown as WorkflowDefinition;

    try {
      await withMockFetch(async () => Response.json({ stop: true }), async () => {
        const payload = await dispatch(
          createHandler(backend, definition, {
            sleep: async () => {
              controller.abort(new Error("Run cancelled"));
            },
          }),
          undefined,
          controller.signal,
        );
        // Tampered transport primitives cannot authorize execution beyond the boundary.
        assertEquals(payload.success, false);
        assertEquals(payload.error, "Workflow run cancelled");
      });
    } finally {
      Object.defineProperty(Request.prototype, "signal", original);
    }
    assertEquals(calls, []);
  });

  it("continues when the pause acknowledgement reports no pause", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const urls: string[] = [];
    let now = 0;

    await withMockFetch(async (input) => {
      urls.push(String(input));
      return Response.json({ stop: false });
    }, async () => {
      const payload = await dispatch(
        createHandler(backend, threeSteps(calls), { now: () => (now += 1_000) }),
      );
      assertEquals(payload.success, true);
      assertEquals(payload.status, undefined);
    });

    assertEquals(calls, ["first", "second", "third"]);
    assertEquals(pauseAckCalls(urls).length, 2);
  });

  it("retries a failed pause acknowledgement and then pauses", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const urls: string[] = [];

    await withMockFetch(async (input) => {
      urls.push(String(input));
      if (urls.length === 1) throw new TypeError("connection reset");
      if (urls.length === 2) return new Response("unavailable", { status: 503 });
      return Response.json({ stop: true });
    }, async () => {
      const payload = await dispatch(createHandler(backend, threeSteps(calls)));
      assertEquals(payload.waiting_reason, "manual_pause");
    });

    assertEquals(calls, ["first"]);
    assertEquals(pauseAckCalls(urls).length, 3);
  });

  it("keeps a committed pause boundary while replies are lost, rejected, or malformed", async () => {
    for (const reply of ["transport", "unauthorized", "malformed"] as const) {
      const backend = new SharedMemoryBackend();
      const calls: string[] = [];
      let requests = 0;
      await withMockFetch(async () => {
        if (++requests > 5) return Response.json({ stop: true });
        if (reply === "transport") throw new TypeError("Committed acknowledgement reply lost");
        if (reply === "unauthorized") return Response.json({ stop: true }, { status: 401 });
        return Response.json({ stop: "false" });
      }, async () => {
        const payload = await dispatch(
          createHandler(backend, threeSteps(calls), { now: () => requests * 1_000 }),
        );
        assertEquals(payload.waiting_reason, "manual_pause", reply);
      });
      assertEquals(calls, ["first"], reply);
      assertEquals(requests, 6, reply);
    }
  });

  it("does not release a stale manual pause while acknowledgement replies are lost", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);
    let requests = 0;
    await withMockFetch(async () => {
      if (++requests === 1 || requests > 6) return Response.json({ stop: true });
      throw new TypeError("Stale generation stop reply lost");
    }, async () => {
      await dispatch(createHandler(backend, definition));
      const resumed = await dispatch(createHandler(backend, definition), { type: "manual" });
      assertEquals(resumed.waiting_reason, "manual_pause");
    });
    assertEquals(calls, ["first"]);
    assertEquals(requests, 7);
  });

  it("stops asking for the pause decision once a timed-out manual resume has answered", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);
    let authorized = true;
    let requests = 0;
    await withMockFetch(async () => {
      requests++;
      return authorized
        ? Response.json({ stop: true })
        : Response.json({ stop: false }, { status: 401 });
    }, async () => {
      await dispatch(createHandler(backend, definition));
      authorized = false;
      const resumed = await dispatch(
        createHandler(backend, definition, { workflowResumeTimeoutMs: 20 }),
        { type: "manual" },
      );
      assertEquals(resumed.status, "waiting");
      // Let a round already in flight finish, then no further round may start.
      await delay(60);
      const settled = requests;
      await delay(120);
      assertEquals(requests, settled);
    });
    assertEquals(calls, ["first"]);
    assertEquals((await backend.getRun(runId))?.status, "waiting");
  });

  it("holds the boundary when a continue reply arrives after manual resume has timed out", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);
    const acknowledgementStarted = Promise.withResolvers<void>();
    const lateReply = Promise.withResolvers<Response>();
    let requests = 0;
    let resumes = 0;
    await withMockFetch(async () => {
      if (++requests === 1) return Response.json({ stop: true });
      acknowledgementStarted.resolve();
      return await lateReply.promise;
    }, async () => {
      await dispatch(createHandler(backend, definition));
      const resumed = dispatch(
        createHandler(backend, definition, {
          workflowResumeTimeoutMs: 20,
          onResume: () => resumes++,
        }),
        { type: "manual" },
      );
      await acknowledgementStarted.promise;
      assertEquals((await resumed).status, "waiting");
      lateReply.resolve(Response.json({ stop: false }));
      await delay(60);
      assertEquals(resumes, 0);
      assertEquals(calls, ["first"]);
      assertEquals((await backend.getRun(runId))?.status, "waiting");
    });
  });

  it("refuses manual resume without a capability instead of releasing the boundary", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);
    await withMockFetch(async () => Response.json({ stop: true }), async () => {
      await dispatch(createHandler(backend, definition));
      const { request, publicKeyPem } = await signedRequest(
        `/api/control-plane/runs/${runId}/execute`,
        {
          runId,
          kind: "workflow",
          target: "workflow:publish",
          projectId: "proj-1",
          resume: { type: "manual" },
        },
      );
      const result = await createHandler(backend, definition).handle(
        request,
        createCtx(publicKeyPem),
      );
      assertExists(result.response);
      const payload = await result.response.json();
      assertEquals(payload.success, false);
      assertEquals(payload.error, "Manual resume requires a run stop capability");
    });
    assertEquals(calls, ["first"]);
    assertEquals((await backend.getRun(runId))?.status, "waiting");
  });

  it("recovers a post-ack crash record before settling and executes completed nodes once", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);
    let stop = true;
    let attemptedResume = false;
    await withMockFetch(async () => Response.json({ stop }), async () => {
      await dispatch(createHandler(backend, definition));
      // The real crash window retains the durable batch, but loses the local waiting commit.
      await backend.updateRun(runId, { status: "running" });
      stop = false;
      const resumed = await dispatch(
        createHandler(backend, definition, {
          onResume: () => {
            attemptedResume = true;
          },
          sleep: async (ms) => {
            if (!attemptedResume) throw new Error("Recovery settled before attempting resume");
            await delay(Math.min(ms, 10));
          },
        }),
        { type: "manual" },
      );
      assertEquals(resumed.success, true);
      assertEquals((await backend.getRun(runId))?.status, "completed");
    });
    assertEquals(attemptedResume, true);
    assertEquals(calls, ["first", "second", "third"]);
  });

  it("continues a pause the control plane did not keep when another resume arrives", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);
    let stop = true;

    await withMockFetch(async () => Response.json({ stop }), async () => {
      // A stale attempt was told to stop: the engine parks with no wait.
      await dispatch(createHandler(backend, definition));
      stop = false;
      const rechecked = await dispatch(createHandler(backend, definition), {
        type: "deadline",
        wait_id: "w",
      });
      assertEquals(rechecked.success, true);
      assertEquals(rechecked.status, undefined);
    });

    assertEquals(calls, ["first", "second", "third"]);
    assertEquals((await backend.getRun(runId))?.status, "completed");
  });

  it("continues a pause an older attempt makes while a repeated decision waits for the run", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const definition = workflow({
      id: "publish",
      steps: [
        step("first", {
          tool: tool({
            id: "first-tool",
            description: "Record first once released",
            inputSchema: defineSchema((v) => v.object({}).passthrough())(),
            execute: async () => {
              await gate;
              calls.push("first");
              return { first: true };
            },
          }),
        }),
        dependsOn(countingStep("second", calls), "first"),
      ],
    }).definition as unknown as WorkflowDefinition;
    let acknowledgements = 0;
    let older: ReturnType<typeof dispatch> | undefined;

    await withMockFetch(async (_input, init) => {
      const authorization = new Headers(observeFetchRequestInit(init).headers).get("authorization");
      if (authorization === "Bearer opaque-stop-capability") {
        if (++acknowledgements === 1) {
          throw new TypeError("Committed pause acknowledgement reply lost");
        }
        return Response.json({ stop: true });
      }
      // Only the repeated attempt waits for the older dispatch's pause. An older
      // acknowledgement retry must replay its stop rather than await itself.
      await older;
      return Response.json({ stop: false });
    }, async () => {
      // The older attempt is still running when the control plane re-sends a decision; the
      // control plane then tells the older attempt to stop at its boundary.
      older = dispatch(createHandler(backend, definition));
      while (!(await backend.getRun(runId))) await delay(1);
      const repeated = dispatch(
        createHandler(backend, definition),
        {
          type: "deadline",
          wait_id: "w",
        },
        undefined,
        "repeated-stop-capability",
      );
      await delay(20);
      release();
      assertEquals((await older).waiting_reason, "manual_pause");
      const continued = await repeated;
      assertEquals(continued.success, true);
      assertEquals(continued.status, undefined);
    });

    assertEquals(calls, ["first", "second"]);
    assertEquals(acknowledgements, 2);
    assertEquals((await backend.getRun(runId))?.status, "completed");
  });

  it("checks for a pause at most once per second", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const urls: string[] = [];

    await withMockFetch(async (input) => {
      urls.push(String(input));
      return Response.json({ stop: false });
    }, async () => {
      const payload = await dispatch(createHandler(backend, threeSteps(calls)));
      assertEquals(payload.success, true);
    });

    assertEquals(calls, ["first", "second", "third"]);
    assertEquals(pauseAckCalls(urls).length, 1);
  });

  it("never asks to pause an ephemeral run", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const urls: string[] = [];
    let now = 0;

    await withMockFetch(async (input) => {
      urls.push(String(input));
      return Response.json({ stop: true });
    }, async () => {
      const payload = await dispatch(
        createHandler(backend, threeSteps(calls), {
          statePersistence: "ephemeral",
          now: () => (now += 1_000),
        }),
      );
      assertEquals(payload.success, true);
    });

    assertEquals(calls, ["first", "second", "third"]);
    assertEquals(pauseAckCalls(urls), []);
  });

  it("cancels a run whose request is aborted during the pause check", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const controller = new AbortController();

    await withMockFetch(async (input) => {
      if (new URL(String(input)).pathname.endsWith("/pause-ack")) {
        controller.abort(new Error("Run cancelled"));
        return Response.json({ stop: true });
      }
      return Response.json({ acknowledged: true });
    }, async () => {
      const payload = await dispatch(
        createHandler(backend, threeSteps(calls)),
        undefined,
        controller.signal,
      );
      assertEquals(payload.success, false);
      assertEquals(payload.error, "Workflow run cancelled");
    });

    assertEquals(calls, ["first"]);
    assertEquals((await backend.getRun(runId))?.status, "cancelled");
  });

  it("cancels a paused run when the manual resume request is aborted", async () => {
    const backend = new SharedMemoryBackend();
    const calls: string[] = [];
    const definition = threeSteps(calls);

    await withMockFetch(async () => Response.json({ stop: true }), async () => {
      const first = await dispatch(createHandler(backend, definition));
      assertEquals(first.waiting_reason, "manual_pause");

      const controller = new AbortController();
      const resumed = await dispatch(
        createHandler(backend, definition, {
          onDiscover: () => controller.abort(new Error("Run cancelled")),
        }),
        { type: "manual" },
        controller.signal,
      );
      assertEquals(resumed.success, false);
    });

    assertEquals(calls, ["first"]);
    assertEquals((await backend.getRun(runId))?.status, "cancelled");
  });
});
