import "#veryfront/schemas/_test-setup.ts";
import { agent as createAgent } from "#veryfront/agent";
import {
  createProjectRunInferenceModelResolver,
  runWithProjectRunInferenceCredential,
} from "#veryfront/agent/runtime/project-run-inference-credential.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders } from "#veryfront/provider";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { seedServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import {
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
} from "#veryfront/server/handlers/request/project-run-execute.handler.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

const INFERENCE_TOKEN = "project-run-inference-token";
const BROADER_TOKEN = "broader-project-runtime-token";
const encoder = new TextEncoder();

/** Answers every model call with one streamed completion and records its bearer. */
function captureModelAuthorizations(): Array<string | null> {
  const authorizations: Array<string | null> = [];
  installMockFetch(
    (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      authorizations.push(request.headers.get("Authorization"));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
            );
            controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch,
  );
  return authorizations;
}

function createManagedModelAgent(id: string) {
  return createAgent({
    id,
    model: "veryfront-cloud/openai/gpt-test",
    system: "Answer concisely.",
    skills: false,
  });
}

describe("project-run inference credential", () => {
  beforeEach(() => {
    seedServedCatalogForTests();
    setEnv("VERYFRONT_API_TOKEN", BROADER_TOKEN);
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
  });
  afterEach(() => {
    __resetVeryfrontCloudCatalogForTests();
    restoreMockFetch();
    clearModelProviders();
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
  });

  it("sends a managed model call inside the scope with the inference credential", async () => {
    const authorizations = captureModelAuthorizations();
    const managed = createManagedModelAgent("project-run-scoped-agent");

    const response = await runWithProjectRunInferenceCredential(
      INFERENCE_TOKEN,
      () => managed.generate({ input: "Hello" }),
    );

    assertEquals(response.text, "Hello");
    assertEquals(authorizations, [`Bearer ${INFERENCE_TOKEN}`]);
  });

  it("keeps the existing credential for calls made outside any scope", async () => {
    const authorizations = captureModelAuthorizations();
    const managed = createManagedModelAgent("project-run-unscoped-agent");

    const response = await managed.generate({ input: "Hello" });

    assertEquals(response.text, "Hello");
    assertEquals(authorizations, [`Bearer ${BROADER_TOKEN}`]);
  });

  it("revokes a model resolved in the scope once the scope settles", async () => {
    captureModelAuthorizations();
    const retained = await runWithProjectRunInferenceCredential(INFERENCE_TOKEN, () => {
      const resolver = createProjectRunInferenceModelResolver();
      assertExists(resolver);
      return Promise.resolve(resolver("veryfront-cloud/openai/gpt-test"));
    });
    assertExists(retained);

    await assertRejects(
      () => retained.doStream({ prompt: [] }),
      TypeError,
      "Project run inference credential is no longer active",
    );
  });

  it("does not resolve non-managed models through the credential", async () => {
    await runWithProjectRunInferenceCredential(INFERENCE_TOKEN, () => {
      const resolver = createProjectRunInferenceModelResolver();
      assertExists(resolver);
      assertEquals(resolver("project-test/model"), undefined);
      return Promise.resolve();
    });
  });

  it("routes a task agent's model call through the execute request's inference header", async () => {
    const authorizations = captureModelAuthorizations();
    const managed = createManagedModelAgent("project-run-task-agent");
    const deps = {
      runTask: async () => {
        const answer = await managed.generate({ input: "Hello" });
        return { success: true, result: { text: answer.text }, durationMs: 1 };
      },
      ensureProjectDiscovery: async () => {
        const discovery = createEmptyDiscoveryResult();
        discovery.tasks.set("smoke", { name: "Smoke", run: async () => ({ ok: true }) });
        return discovery;
      },
      now: () => 0,
      sleep: async () => {},
    } as unknown as ProjectRunExecuteHandlerDeps;
    const body = {
      runId: "run_task_smoke",
      kind: "task",
      target: "task:smoke",
      projectId: "proj-1",
    };
    const path = "/api/control-plane/runs/run_task_smoke/execute";
    const rawBody = JSON.stringify(body);
    const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
      requestId: body.runId,
      projectId: body.projectId,
      requestMethod: "POST",
      requestPath: path,
    });
    const request = new Request(`https://example.com${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-veryfront-control-plane-jws": jws,
        "x-token": BROADER_TOKEN,
        "X-Veryfront-Inference-Token": INFERENCE_TOKEN,
      },
      body: rawBody,
    });

    const result = await new ProjectRunExecuteHandler(deps).handle(
      request,
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(await result.response.json(), {
      success: true,
      result: { text: "Hello" },
      duration_ms: 1,
      logs: null,
    });
    assertEquals(authorizations, [`Bearer ${INFERENCE_TOKEN}`]);
  });
});

describe("project-run inference credential isolation", () => {
  it("keeps the scope out of replaced AsyncLocalStorage methods", async () => {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const prototype = AsyncLocalStorage.prototype as unknown as Record<string, unknown>;
    const originalRun = prototype.run as (...args: unknown[]) => unknown;
    const originalGetStore = prototype.getStore as (...args: unknown[]) => unknown;
    const observed: unknown[] = [];
    prototype.run = function (this: unknown, ...args: unknown[]) {
      observed.push(args[0]);
      return originalRun.apply(this, args);
    };
    prototype.getStore = function (this: unknown) {
      const store = originalGetStore.apply(this, []);
      observed.push(store);
      return store;
    };
    try {
      await runWithProjectRunInferenceCredential(INFERENCE_TOKEN, () => {
        assertExists(createProjectRunInferenceModelResolver());
        return Promise.resolve();
      });
    } finally {
      prototype.run = originalRun;
      prototype.getStore = originalGetStore;
    }

    assertEquals(JSON.stringify(observed).includes(INFERENCE_TOKEN), false);
  });
});
