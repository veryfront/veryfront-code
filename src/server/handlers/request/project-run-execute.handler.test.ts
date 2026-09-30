import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";
import { CONTROL_PLANE_OWNED_START } from "#veryfront/workflow/dsl/validation.ts";
import {
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent } from "#veryfront/agent";
import { tool } from "#veryfront/tool";
import { createWorkflowClient, step, workflow, type WorkflowDefinition } from "#veryfront/workflow";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
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
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";
import {
  createKnowledgeEventLogger,
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
  projectWorkflowRedisConfig,
  projectWorkflowRedisPrefix,
} from "./project-run-execute.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";
import { MemoryBackend } from "#veryfront/workflow/backends/memory.ts";
import { dependsOn } from "#veryfront/workflow/dsl/workflow.ts";
import { waitForApproval, waitForEvent } from "#veryfront/workflow/dsl/wait.ts";
import type { WorkflowNode } from "#veryfront/workflow/types.ts";
import { delay } from "#veryfront/testing/deno-compat.ts";
import { createProjectRunInferenceModelResolver } from "#veryfront/agent/runtime/project-run-inference-credential.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import * as otelApi from "npm:@opentelemetry/api@1.9.1";
import { AsyncLocalStorageContextManager } from "npm:@opentelemetry/context-async-hooks@2.9.0";
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
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      config: { max_steps: "2.9" },
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
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      runtimeAgUiEndpoint: "http://localhost:4311/api/ag-ui",
      config: { allowedTools: ["eval_allowed_lookup", "web_fetch"], max_steps: 2 },
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
  ) {
    const handler = new ProjectRunExecuteHandler(
      createDeps({ createWorkflowClient: () => client, ...deps }),
    );
    const runId = "run_27714e62-7b05-466e-809e-0d8f1cdf1e62";
    const { request, publicKeyPem } = await signedRequest(
      `/api/control-plane/runs/${runId}/execute`,
      { runId, kind: "workflow", target: "workflow:publish", projectId: "proj-1", resume },
    );
    const result = await handler.handle(request, createCtx(publicKeyPem));
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

    async function parkRun(steps: WorkflowNode[]) {
      const backend = new MemoryBackend();
      const definition = workflow({ id: "publish", steps }).definition;
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

    it("fails an approval that timed out on a deadline dispatch", async () => {
      const parked = await parkRun([
        waitForApproval("manager-review", { message: "Ship it?", timeout: 50 }),
        dependsOn(finalize, "manager-review"),
      ]);
      const [approval] = await parked.backend.getPendingApprovals(runId);
      assertExists(approval);
      await delay(80);

      const payload = await dispatchResume(parked, { type: "deadline" });

      assertEquals(payload.success, false);
      assertEquals(payload.error, `Approval "${approval.id}" expired`);
    });

    it("fails an event wait that timed out on a deadline dispatch", async () => {
      const parked = await parkRun([
        waitForEvent("invoice", { eventName: "invoice.received", timeout: 50 }),
        dependsOn(finalize, "invoice"),
      ]);
      await delay(80);

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

  it("keeps the credential out of reach of eval project code that patches Headers.get", async () => {
    const seen: unknown[] = [];
    const originalGet = Headers.prototype.get;
    let receivedAuthToken: string | undefined;
    const handler = new ProjectRunExecuteHandler(createDeps({
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
      kind: "eval",
      target: "eval:deep-research",
      projectId: "proj-1",
      config: { agent_id: "researcher" },
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
