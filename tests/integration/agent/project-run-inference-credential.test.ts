import "#veryfront/schemas/_test-setup.ts";
import { agent as createAgent } from "#veryfront/agent";
import {
  createProjectRunInferenceModelResolver,
  runWithProjectRunInferenceCredential,
} from "#veryfront/agent/runtime/project-run-inference-credential.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  clearEnvFileValueSource,
  markEnvFileValue,
} from "#veryfront/platform/compat/process/env.ts";
import { clearModelProviders } from "#veryfront/provider";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { seedServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { runWithVeryfrontCloudContextAsync } from "#veryfront/provider/veryfront-cloud/context.ts";
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

describe("project-run inference credential revocation", () => {
  beforeEach(() => {
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

  /** Every outbound request, catalog loads included, with the bearer it carried. */
  function captureAllRequests(): Array<{ url: string; authorization: string | null }> {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push({ url: request.url, authorization: request.headers.get("Authorization") });
        if (request.url.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
              );
              controller.enqueue(
                encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );
    return requests;
  }

  function retainModelPastScope() {
    return runWithProjectRunInferenceCredential(INFERENCE_TOKEN, () => {
      const resolver = createProjectRunInferenceModelResolver();
      assertExists(resolver);
      const model = resolver("veryfront-cloud/openai/gpt-test");
      assertExists(model);
      return Promise.resolve(model);
    });
  }

  for (const catalog of ["uncached", "cached"] as const) {
    it(`sends nothing once the scope settles, with ${catalog === "cached" ? "a" : "an"} ${catalog} catalog`, async () => {
      if (catalog === "cached") seedServedCatalogForTests();
      const requests = captureAllRequests();
      const retained = await retainModelPastScope();

      for (
        const call of [
          () => retained.doStream({ prompt: [] }),
          () => retained.doGenerate({ prompt: [] }),
        ]
      ) {
        await assertRejects(
          call,
          TypeError,
          "Project run inference credential is no longer active",
        );
      }
      // Preparation sends nothing for a revoked credential; the call then rejects.
      await retained.prepare?.();
      assertEquals(
        requests.filter((request) => request.authorization?.includes(INFERENCE_TOKEN)),
        [],
      );
      assertEquals(requests, []);
    });
  }

  it("refuses to build a model from a resolver kept past the scope", async () => {
    const requests = captureAllRequests();
    const resolver = await runWithProjectRunInferenceCredential(INFERENCE_TOKEN, () => {
      const inScope = createProjectRunInferenceModelResolver();
      assertExists(inScope);
      return Promise.resolve(inScope);
    });

    let thrown: unknown;
    try {
      resolver("veryfront-cloud/openai/gpt-test");
    } catch (error) {
      thrown = error;
    }
    assertEquals(thrown instanceof TypeError, true);
    assertEquals(requests, []);
  });

  it("lets a stream sent inside the scope finish, but sends no new request after it", async () => {
    seedServedCatalogForTests();
    const requests = captureAllRequests();
    const { model, result } = await runWithProjectRunInferenceCredential(
      INFERENCE_TOKEN,
      async () => {
        const resolver = createProjectRunInferenceModelResolver();
        assertExists(resolver);
        const inScope = resolver("veryfront-cloud/openai/gpt-test");
        assertExists(inScope);
        return { model: inScope, result: await inScope.doStream({ prompt: [] }) };
      },
    );

    // The request already went out authenticated; reading its response later is allowed.
    const reader = (result as { stream: ReadableStream<unknown> }).stream.getReader();
    while (!(await reader.read()).done) {
      // drain
    }
    assertEquals(requests.map((request) => request.authorization), [`Bearer ${INFERENCE_TOKEN}`]);

    await assertRejects(
      () => model.doStream({ prompt: [] }),
      TypeError,
      "Project run inference credential is no longer active",
    );
    assertEquals(requests.length, 1);
  });
});

describe("project-run inference credential boundaries", () => {
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

  /** Answers each model call with the bearer it carried, so a call can name its credential. */
  function echoBearer(requests: Array<{ url: string; authorization: string | null }>): void {
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        const authorization = request.headers.get("Authorization");
        requests.push({ url: request.url, authorization });
        const text = JSON.stringify(authorization ?? "none");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(`data: {"choices":[{"delta":{"content":${text}}}]}\n\n`),
              );
              controller.enqueue(
                encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );
  }

  it("sends a forged Cloud context's credential only to the trusted host origin", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    echoBearer(requests);
    const managed = createManagedModelAgent("project-run-forged-origin-agent");

    await runWithProjectRunInferenceCredential(INFERENCE_TOKEN, () =>
      // Project code controls this context; its origin must not receive the credential.
      runWithVeryfrontCloudContextAsync(
        { apiBaseUrl: "https://evil.example", apiToken: "forged", projectSlug: "forged" },
        () => managed.generate({ input: "Hello" }),
      ));

    assertEquals(requests.length, 1);
    assertEquals(new URL(requests[0]!.url).origin, "https://api.veryfront.com");
    assertEquals(requests[0]!.authorization, `Bearer ${INFERENCE_TOKEN}`);
    assertEquals(requests.some((request) => request.url.includes("evil.example")), false);
  });

  it("does not let a project .env value redirect the credential", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    echoBearer(requests);
    const managed = createManagedModelAgent("project-run-env-file-origin-agent");
    setEnv("VERYFRONT_PUBLIC_API_BASE_URL", "https://evil.example");
    markEnvFileValue("VERYFRONT_PUBLIC_API_BASE_URL");
    try {
      await runWithProjectRunInferenceCredential(
        INFERENCE_TOKEN,
        () => managed.generate({ input: "Hello" }),
      );
    } finally {
      clearEnvFileValueSource("VERYFRONT_PUBLIC_API_BASE_URL");
      deleteEnv("VERYFRONT_PUBLIC_API_BASE_URL");
    }

    assertEquals(requests.length, 1);
    assertEquals(new URL(requests[0]!.url).origin, "https://api.veryfront.com");
    assertEquals(requests.some((request) => request.url.includes("evil.example")), false);
  });

  it("uses a host-configured public API origin", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    echoBearer(requests);
    const managed = createManagedModelAgent("project-run-host-origin-agent");
    setEnv("VERYFRONT_PUBLIC_API_BASE_URL", "https://public-api.example");
    try {
      await runWithProjectRunInferenceCredential(
        INFERENCE_TOKEN,
        () => managed.generate({ input: "Hello" }),
      );
    } finally {
      deleteEnv("VERYFRONT_PUBLIC_API_BASE_URL");
    }

    assertEquals(requests.length, 1);
    assertEquals(new URL(requests[0]!.url).origin, "https://public-api.example");
  });

  it("keeps overlapping executions on their own credentials", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    echoBearer(requests);
    const managed = createManagedModelAgent("project-run-overlap-agent");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = (token: string) =>
      runWithProjectRunInferenceCredential(token, async () => {
        await gate;
        return (await managed.generate({ input: "Hello" })).text;
      });

    const both = Promise.all([run("project-run-token-a"), run("project-run-token-b")]);
    release();
    const [a, b] = await both;

    assertEquals(a, "Bearer project-run-token-a");
    assertEquals(b, "Bearer project-run-token-b");
  });

  it("sends no scoped credential from a timer that fires after the execution settled", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    echoBearer(requests);
    const managed = createManagedModelAgent("project-run-late-timer-agent");
    let late!: Promise<string>;
    let fire!: () => void;
    const fired = new Promise<void>((resolve) => {
      fire = resolve;
    });

    await runWithProjectRunInferenceCredential(INFERENCE_TOKEN, () => {
      late = new Promise((resolve, reject) => {
        setTimeout(() => {
          fired.then(() => managed.generate({ input: "Hello" })).then(
            (response) => resolve(response.text),
            reject,
          );
        }, 0);
      });
      return Promise.resolve();
    });
    fire();

    // A call started after revocation falls back to the ambient credential.
    assertEquals(await late, `Bearer ${BROADER_TOKEN}`);
    assertEquals(
      requests.some((request) => request.authorization?.includes(INFERENCE_TOKEN)),
      false,
    );
  });

  it("finishes a response stream still arriving at revocation, then sends nothing new", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    let finishBody!: () => void;
    const bodyHeld = new Promise<void>((resolve) => {
      finishBody = resolve;
    });
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push({ url: request.url, authorization: request.headers.get("Authorization") });
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(
                encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'),
              );
              await bodyHeld;
              controller.enqueue(
                encoder.encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'),
              );
              controller.enqueue(
                encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );
    const { model, stream } = await runWithProjectRunInferenceCredential(
      INFERENCE_TOKEN,
      async () => {
        const resolver = createProjectRunInferenceModelResolver();
        assertExists(resolver);
        const inScope = resolver("veryfront-cloud/openai/gpt-test");
        assertExists(inScope);
        const result = await inScope.doStream({ prompt: [] });
        return { model: inScope, stream: (result as { stream: ReadableStream<unknown> }).stream };
      },
    );

    // Revoked while the body is still arriving.
    finishBody();
    const reader = stream.getReader();
    let parts = 0;
    while (!(await reader.read()).done) parts++;

    assertEquals(parts > 0, true);
    assertEquals(requests.length, 1);
    await assertRejects(
      () => model.doStream({ prompt: [] }),
      TypeError,
      "Project run inference credential is no longer active",
    );
    assertEquals(requests.length, 1);
  });

  it("keeps the credential out of replaced AsyncLocalStorage methods through a real agent call", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    echoBearer(requests);
    const managed = createManagedModelAgent("project-run-intercepted-agent");
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
    let text: string;
    try {
      text = await runWithProjectRunInferenceCredential(
        INFERENCE_TOKEN,
        async () => (await managed.generate({ input: "Hello" })).text,
      );
    } finally {
      prototype.run = originalRun;
      prototype.getStore = originalGetStore;
    }

    assertEquals(text, `Bearer ${INFERENCE_TOKEN}`);
    const seen = observed.map((value) => {
      try {
        return JSON.stringify(value) ?? "";
      } catch {
        return "";
      }
    });
    assertEquals(seen.some((value) => value.includes(INFERENCE_TOKEN)), false);
  });
});
