import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { ProjectWorker } from "./project-worker.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";
import type { WorkerPermissions } from "./worker-permissions.ts";
import { WORKER_INTERNAL_EGRESS_OVERRIDE_ENV } from "./worker-egress-guard.ts";
import { validateOpenAPISpec } from "#veryfront/routing/api/openapi/spec-validation.ts";

const testSuite = isDeno ? describe : describe.skip;
const TEST_SOURCE_INTEGRATION_POLICY = { schemaVersion: 1, mode: "unrestricted" } as const;

const TEST_PERMISSIONS: WorkerPermissions = {
  read: true,
  write: false,
  net: false,
  env: false,
  run: false,
  ffi: false,
  sys: false,
};

const REAL_WORKER_PERMISSIONS: WorkerPermissions = {
  read: true,
  write: false,
  net: false,
  env: [],
  run: false,
  ffi: false,
  sys: false,
};

const TEST_WORKER_SCRIPT_URL = `data:application/typescript,${
  encodeURIComponent(`
    self.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "ping") {
        self.postMessage({ type: "pong", id: msg.id });
        return;
      }
      if (msg.type === "clear-cache") return;
      if (msg.type === "render-ssr") return;
      self.postMessage({
        type: "error",
        id: msg.id,
        error: { name: "Error", message: "unsupported test request" },
      });
    };
  `)
}`;

function createTestWorker(projectId = "test-project"): ProjectWorker {
  return new ProjectWorker({
    projectId,
    permissions: TEST_PERMISSIONS,
    requestTimeoutMs: 5_000,
    workerScriptUrl: TEST_WORKER_SCRIPT_URL,
  });
}

async function assertWorkerReady(worker: ProjectWorker): Promise<void> {
  assertEquals(await worker.isHealthy(30_000), true);
}

testSuite("ProjectWorker", () => {
  it("starts in idle state after start()", () => {
    const worker = createTestWorker();
    worker.start();
    try {
      assertEquals(worker.status, "idle");
      assertEquals(worker.requestCount, 0);
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });

  it("start() is idempotent", () => {
    const worker = createTestWorker();
    worker.start();
    worker.start();
    try {
      assertEquals(worker.status, "idle");
    } finally {
      worker.terminate();
    }
  });

  it("terminate sets status to terminated", () => {
    const worker = createTestWorker();
    worker.start();
    worker.terminate();
    assertEquals(worker.status, "terminated");
  });

  it("cannot restart an explicitly terminated worker", () => {
    const worker = createTestWorker();
    worker.terminate();

    assertEquals(worker.status, "terminated");
    assertThrows(() => worker.start(), Error, "cannot be restarted");
  });

  it("responds to health check", async () => {
    const worker = createTestWorker();
    worker.start();
    try {
      const healthy = await worker.isHealthy(30_000);
      assertEquals(healthy, true);
    } finally {
      worker.terminate();
    }
  });

  it("health check returns false for terminated worker", async () => {
    const worker = createTestWorker();
    worker.start();
    worker.terminate();
    const healthy = await worker.isHealthy(1_000);
    assertEquals(healthy, false);
  });

  it("rejects invalid health-check timeouts", async () => {
    const worker = createTestWorker();
    worker.start();
    try {
      await assertRejects(
        () => worker.isHealthy(0),
        TypeError,
        "positive safe integer",
      );
    } finally {
      worker.terminate();
    }
  });

  it("tracks request count", async () => {
    const worker = createTestWorker();
    worker.start();
    try {
      assertEquals(worker.requestCount, 0);

      // Send a ping (counted as a request via the execute path)
      // Use isHealthy which goes through the pending mechanism
      await worker.isHealthy(30_000);

      // requestCount only increments via execute(), not isHealthy
      assertEquals(worker.requestCount, 0);
    } finally {
      worker.terminate();
    }
  });

  it("projectId is set correctly", () => {
    const worker = createTestWorker();
    assertEquals(worker.projectId, "test-project");
  });

  it("rejects unrestricted network access for custom worker scripts", () => {
    const worker = new ProjectWorker({
      projectId: "test-custom-worker-network",
      permissions: { ...TEST_PERMISSIONS, net: true },
      requestTimeoutMs: 5_000,
      workerScriptUrl: TEST_WORKER_SCRIPT_URL,
    });
    let startupError: unknown;
    try {
      worker.start();
    } catch (error) {
      startupError = error;
    }
    assert(startupError instanceof Error);
    assertEquals((startupError as Error & { slug?: string }).slug, "invalid-argument");
    assertEquals(
      startupError.message,
      "Custom project worker scripts cannot use unrestricted network permissions",
    );
  });
});

testSuite("ProjectWorker - error handling", () => {
  it("ignores malformed messages before a valid worker response", async () => {
    const workerScriptUrl = `data:application/typescript,${
      encodeURIComponent(`
        self.onmessage = (event) => {
          const msg = event.data;
          if (msg.type === "ping") {
            self.postMessage({ type: "pong", id: msg.id });
            return;
          }
          self.postMessage(null);
          self.postMessage({ type: "error", id: msg.id, error: {
            name: "Error",
            message: "valid response",
          } });
        };
      `)
    }`;
    const worker = new ProjectWorker({
      projectId: "test-malformed-worker-response",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 5_000,
      workerScriptUrl,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: "malformed-response",
        modulePath: "/nonexistent.ts",
        method: "GET",
        request: {
          url: "http://localhost/api/test",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir: Deno.cwd(),
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "error");
      if (response.type !== "error") throw new Error("expected error response");
      assertEquals(response.error.message, "valid response");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });

  it("rejects execute when worker is not started", async () => {
    const worker = createTestWorker();

    try {
      await worker.execute({
        type: "execute-app-route",
        id: "test-id",
        modulePath: "/nonexistent.ts",
        method: "GET",
        request: {
          url: "http://localhost/api/test",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir: Deno.cwd(),
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assertEquals(true, false, "Should have thrown");
    } catch (error) {
      assertExists(error);
    }
  });

  it("rejects duplicate in-flight request IDs without orphaning the first request", async () => {
    const worker = new ProjectWorker({
      projectId: "test-duplicate-id",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 100,
      workerScriptUrl: TEST_WORKER_SCRIPT_URL,
    });
    const request = {
      type: "execute-app-route" as const,
      id: "duplicate-id",
      modulePath: "/nonexistent.ts",
      method: "GET",
      request: {
        url: "http://localhost/api/test",
        method: "GET",
        headers: [] as [string, string][],
        body: null,
      },
      params: {},
      projectDir: Deno.cwd(),
      sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    };

    worker.start();
    try {
      const first = worker.execute(request);
      await assertRejects(
        () => worker.execute(request),
        Error,
        "already in flight",
      );
      assertEquals((await first).type, "error");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });

  it("cleans pending state when postMessage cannot clone a request", async () => {
    const worker = createTestWorker("test-clone-failure");
    worker.start();
    try {
      await assertRejects(
        () =>
          worker.execute({
            type: "execute-app-route",
            id: "clone-failure",
            modulePath: "/nonexistent.ts",
            method: "GET",
            request: {
              url: "http://localhost/api/test",
              method: "GET",
              headers: [],
              body: null,
            },
            params: { invalid: (() => {}) as unknown as string },
            projectDir: Deno.cwd(),
            sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
          }),
        DOMException,
      );
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(worker.status, "idle");
    } finally {
      worker.terminate();
    }
  });

  it("terminates the worker when a request times out", async () => {
    const silentScript = `data:application/typescript,${
      encodeURIComponent("self.onmessage = () => {};")
    }`;
    const worker = new ProjectWorker({
      projectId: "test-timeout",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 10,
      workerScriptUrl: silentScript,
    });
    worker.start();
    try {
      await assertRejects(
        () =>
          worker.execute({
            type: "execute-app-route",
            id: "timeout",
            modulePath: "/nonexistent.ts",
            method: "GET",
            request: {
              url: "http://localhost/api/test",
              method: "GET",
              headers: [],
              body: null,
            },
            params: {},
            projectDir: Deno.cwd(),
            sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
          }),
        Error,
        "timed out",
      );
      assertEquals(worker.status, "terminated");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });
});

testSuite("ProjectWorker - clearModuleCache", () => {
  it("clearModuleCache does not throw on running worker", () => {
    const worker = createTestWorker("test-clear-cache");
    worker.start();
    try {
      worker.clearModuleCache();
      assertEquals(worker.status, "idle");
    } finally {
      worker.terminate();
    }
  });

  it("clearModuleCache is no-op on terminated worker", () => {
    const worker = createTestWorker("test-clear-cache");
    worker.start();
    worker.terminate();
    worker.clearModuleCache();
    assertEquals(worker.status, "terminated");
  });

  it("clearModuleCache is no-op before start", () => {
    const worker = createTestWorker("test-clear-cache");
    worker.clearModuleCache();
    // Should not throw
  });
});

testSuite("ProjectWorker - real worker request isolation", () => {
  it("closes broker resources when project code exits the worker", async () => {
    for (
      const [label, exitStatement] of [
        ["close", "globalThis.close()"],
        ["deno-exit", "Deno.exit(0)"],
      ]
    ) {
      const projectDir = await Deno.makeTempDir();
      const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
      await Deno.writeTextFile(
        modulePath,
        `
          export function GET() {
            self.postMessage = () => {};
            ${exitStatement};
            return Response.json({ exited: false });
          }
        `,
      );
      const worker = new ProjectWorker({
        projectId: `test-worker-${label}`,
        permissions: buildWorkerPermissions([projectDir]),
        requestTimeoutMs: 10_000,
      });
      let timeout: number | undefined;

      try {
        worker.start();
        await assertWorkerReady(worker);
        const rejected = await Promise.race([
          worker.execute({
            type: "execute-app-route",
            id: `worker-${label}`,
            modulePath,
            method: "GET",
            request: {
              url: `http://localhost/api/${label}`,
              method: "GET",
              headers: [],
              body: null,
            },
            params: {},
            projectDir,
            sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
          }).then(
            () => false,
            () => true,
          ),
          new Promise<boolean>((resolve) => {
            timeout = setTimeout(() => resolve(false), 2_000);
          }),
        ]);
        assertEquals(rejected, true, label);
        assertEquals(worker.status, "terminated", label);
        assertEquals(worker.hasPendingRequests, false, label);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        worker.terminate();
        await Deno.remove(projectDir, { recursive: true });
      }
    }
  });

  it("returns a serialized error for unknown worker request types", async () => {
    const worker = new ProjectWorker({
      projectId: "test-unknown-request",
      permissions: REAL_WORKER_PERMISSIONS,
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute(
        {
          type: "unknown-request",
          id: "unknown",
        } as unknown as Parameters<ProjectWorker["execute"]>[0],
      );

      assertEquals(response.type, "error");
      if (response.type !== "error") throw new Error("expected error response");
      assertEquals(response.id, "unknown");
      assertEquals(response.error.name, "Error");
      assertEquals(response.error.message, "Unknown request type: unknown-request");
    } finally {
      worker.terminate();
    }
  });

  it("returns a validated OpenAPI result from module code evaluated in the real worker", async () => {
    const projectDir = await Deno.makeTempDir();
    const worker = new ProjectWorker({
      projectId: "test-openapi-worker",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "generate-openapi-spec",
        id: "openapi-worker-request",
        projectDir,
        routes: [{
          pattern: "/api/health",
          moduleCode: `
            const metadata = Symbol.for("veryfront.openapi.metadata");
            function health() { return Response.json({ ok: true }); }
            Object.defineProperty(health, metadata, {
              value: { summary: "Health status", tags: ["System"] },
            });
            export { health as GET };
          `,
        }],
        info: {
          title: "Isolated API",
          version: "1.0.0",
          servers: [{ url: "https://example.com" }],
        },
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "openapi-result");
      if (response.type !== "openapi-result") throw new Error("expected OpenAPI result");
      const spec = validateOpenAPISpec(response.spec);
      assertEquals(spec.paths["/api/health"]?.get?.summary, "Health status");
      assertEquals(spec.paths["/api/health"]?.post, undefined);
      assertEquals(spec.tags, [{ name: "System" }]);
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("streams framework responses over the private worker channel", async () => {
    const projectDir = await Deno.makeTempDir();
    const pageModulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    await Deno.writeTextFile(
      pageModulePath,
      `export default function Page() { return "private-channel-stream"; }`,
    );
    const worker = new ProjectWorker({
      projectId: "test-private-stream-channel",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const stream = worker.executeStream({
        type: "render-ssr",
        id: "private-stream-channel",
        pageModulePath,
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "stream",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      const html = await new Response(stream).text();

      assert(html.includes("private-channel-stream"));
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(worker.status, "idle");
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("executes a project task module through the real worker protocol", async () => {
    const projectDir = await Deno.makeTempDir();
    const worker = new ProjectWorker({
      projectId: "test-project-run-worker",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-project-run",
        id: "project-task-worker-request",
        projectDir,
        kind: "task",
        targetId: "sync-calendar",
        modules: [{
          file: "file://tasks/sync-calendar.ts",
          dir: "tasks",
          moduleCode: `
            export default {
              run: async (ctx) => ({
                projectId: ctx.projectId,
                configured: ctx.config.enabled,
              }),
            };
          `,
        }],
        config: { enabled: true },
        projectId: "project-1",
        debug: false,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        datasetFiles: [],
      });

      if (response.type === "error") {
        throw new Error(`${response.error.name}: ${response.error.message}`);
      }
      assertEquals(response.type, "project-run-result");
      if (response.type !== "project-run-result") {
        throw new Error("expected project run result");
      }
      assertEquals(response.result.success, true);
      assertEquals(response.result.result, {
        projectId: "project-1",
        configured: true,
      });
      assertEquals(typeof response.result.durationMs, "number");
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("executes a project eval module through the real worker protocol", async () => {
    const projectDir = await Deno.makeTempDir();
    const worker = new ProjectWorker({
      projectId: "test-project-eval-worker",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-project-run",
        id: "project-eval-worker-request",
        projectDir,
        kind: "eval",
        targetId: "eval:worker-smoke",
        modules: [{
          file: "file://evals/worker-smoke.eval.ts",
          dir: "evals",
          moduleCode: `
            import { datasets, evalAgent } from "veryfront/eval";
            export default evalAgent({
              id: "eval:worker-smoke",
              target: "agent:unused",
              dataset: datasets.inline([]),
            });
          `,
        }],
        config: {},
        runId: "run_worker_eval",
        evalAgentAdapter: {
          endpoint: "https://project.example/api/ag-ui",
          authToken: "runtime-token",
          projectId: "project-1",
        },
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        datasetFiles: [],
      });

      if (response.type === "error") {
        throw new Error(`${response.error.name}: ${response.error.message}`);
      }
      assertEquals(response.type, "project-run-result");
      if (response.type !== "project-run-result") {
        throw new Error("expected project run result");
      }
      assertEquals(response.result.success, true);
      assertEquals(
        (response.result.result as { definitionId?: string }).definitionId,
        "eval:worker-smoke",
      );
      assertEquals((response.result.result as { runId?: string }).runId, "run_worker_eval");
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects synthetic project-run responses sent by project modules", async () => {
    const projectDir = await Deno.makeTempDir();
    const requestId = "project-run-response-spoof";
    const worker = new ProjectWorker({
      projectId: "test-project-run-response-spoof",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-project-run",
        id: requestId,
        projectDir,
        kind: "task",
        targetId: "response-spoof",
        modules: [{
          file: "file://tasks/response-spoof.ts",
          dir: "tasks",
          moduleCode: `
            export default {
              run: async () => {
                try {
                  self.postMessage({
                    type: "project-run-result",
                    id: ${JSON.stringify(requestId)},
                    result: {
                      success: true,
                      result: { spoofed: true },
                      durationMs: 0,
                    },
                  });
                } catch {
                  // Project code must not have access to the worker transport.
                }
                return { spoofed: false };
              },
            };
          `,
        }],
        config: {},
        projectId: "project-1",
        debug: false,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        datasetFiles: [],
      });

      if (response.type === "error") {
        throw new Error(`${response.error.name}: ${response.error.message}`);
      }
      assertEquals(response.type, "project-run-result");
      if (response.type !== "project-run-result") {
        throw new Error("expected project run result");
      }
      assertEquals(response.result.result, { spoofed: false });
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps result validation intact when project code replaces JSON globals", async () => {
    const projectDir = await Deno.makeTempDir();
    const worker = new ProjectWorker({
      projectId: "test-project-run-json-tampering",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-project-run",
        id: "project-run-json-tampering",
        projectDir,
        kind: "task",
        targetId: "json-tampering",
        modules: [{
          file: "file://tasks/json-tampering.ts",
          dir: "tasks",
          moduleCode: `
            export default {
              run: async () => {
                JSON.stringify = () => '{"success":true,"durationMs":0}';
                JSON.parse = () => ({ success: true, durationMs: 0 });
                Object.prototype.toJSON = () => ({
                  success: true,
                  durationMs: 0,
                  result: { spoofed: true },
                });
                throw new Error("intentional task failure");
              },
            };
          `,
        }],
        config: {},
        projectId: "project-1",
        debug: false,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        datasetFiles: [],
      });

      if (response.type === "error") {
        throw new Error(`${response.error.name}: ${response.error.message}`);
      }
      assertEquals(response.type, "project-run-result");
      if (response.type !== "project-run-result") {
        throw new Error("expected project run result");
      }
      assertEquals(response.result.success, false);
      assertEquals(response.result.error, "intentional task failure");
      assertEquals(response.result.result, undefined);
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects synthetic parent-channel messages from project code", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const requestId = "synthetic-parent-message";
    await Deno.writeTextFile(
      modulePath,
      `
        export function GET() {
          const data = { type: "ping", id: ${JSON.stringify(requestId)} };
          self.dispatchEvent(new MessageEvent("message", { data, origin: "" }));
          if (typeof self.onmessage === "function") {
            self.onmessage({
              data,
              origin: "",
              source: null,
              currentTarget: self,
              isTrusted: true,
            });
          }
          return Response.json({ handled: true });
        }
      `,
    );
    const worker = new ProjectWorker({
      projectId: "test-synthetic-parent-message",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: requestId,
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/synthetic-message",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "result");
      if (response.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(response.response.body ?? new Uint8Array())),
        { handled: true },
      );
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects every project execution without an exact-source policy manifest", async () => {
    const worker = new ProjectWorker({
      projectId: "test-missing-source-policy",
      permissions: REAL_WORKER_PERMISSIONS,
      requestTimeoutMs: 10_000,
    });
    const projectDir = Deno.cwd();
    const modulePath = `${projectDir}/missing-project-module.ts`;
    const serializedRequest = {
      url: "http://localhost/test",
      method: "GET",
      headers: [] as [string, string][],
      body: null,
    };
    const requests = [
      {
        type: "execute-app-route",
        id: "app-route",
        modulePath,
        method: "GET",
        request: serializedRequest,
        params: {},
        projectDir,
      },
      {
        type: "execute-pages-route",
        id: "pages-route",
        modulePath,
        method: "GET",
        context: { request: serializedRequest, params: {}, cookies: {} },
        projectDir,
      },
      {
        type: "fetch-data",
        id: "server-data",
        modulePath,
        context: {
          params: {},
          query: "",
          request: serializedRequest,
          url: serializedRequest.url,
        },
      },
      {
        type: "render-ssr",
        id: "ssr",
        pageModulePath: modulePath,
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "string",
      },
    ];

    worker.start();
    try {
      await assertWorkerReady(worker);
      for (const request of requests) {
        const response = await worker.execute(
          request as unknown as Parameters<ProjectWorker["execute"]>[0],
        );
        assertEquals(response.type, "error");
        if (response.type !== "error") throw new Error("expected error response");
        assertEquals(response.id, request.id);
        assertEquals(response.error.name, "TypeError");
        assertEquals(response.error.message, "Invalid source integration policy manifest");
      }
    } finally {
      worker.terminate();
    }
  });

  it("does not leak projectEnv overlays across requests in the same worker", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const projectKey = "VERYFRONT_TEST_TENANT_SECRET";
    const previousHostValue = Deno.env.get(projectKey);
    Deno.env.set(projectKey, "host-secret-must-not-leak");
    await Deno.writeTextFile(
      modulePath,
      `
        export function GET() {
          return Response.json({ value: Deno.env.get("VERYFRONT_TEST_TENANT_SECRET") ?? null });
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-env-overlay-scope",
      permissions: buildWorkerPermissions([projectDir], {
        projectEnvKeys: ["VERYFRONT_TEST_TENANT_SECRET"],
      }),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const first = await worker.execute({
        type: "execute-app-route",
        id: "first",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/env",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        projectEnv: { VERYFRONT_TEST_TENANT_SECRET: "tenant-a" },
      });

      assertEquals(first.type, "result");
      if (first.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(first.response.body ?? new Uint8Array())),
        { value: "tenant-a" },
      );

      const second = await worker.execute({
        type: "execute-app-route",
        id: "second",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/env",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(second.type, "result");
      if (second.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(second.response.body ?? new Uint8Array())),
        { value: null },
      );
    } finally {
      worker.terminate();
      if (previousHostValue === undefined) Deno.env.delete(projectKey);
      else Deno.env.set(projectKey, previousHostValue);
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not leak projectEnv overlays between queued back-to-back requests", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const requestAKey = "VERYFRONT_TEST_REQUEST_A_SECRET";
    const requestBKey = "VERYFRONT_TEST_REQUEST_B_SECRET";

    await Deno.writeTextFile(
      modulePath,
      `
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        export async function GET(request) {
          const url = new URL(request.url);
          if (url.searchParams.get("request") === "a") {
            await sleep(100);
          }

          return Response.json({
            request: url.searchParams.get("request"),
            requestA: Deno.env.get(${JSON.stringify(requestAKey)}) ?? null,
            requestB: Deno.env.get(${JSON.stringify(requestBKey)}) ?? null,
          });
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-concurrent-env-overlay-scope",
      permissions: buildWorkerPermissions([projectDir], {
        projectEnvKeys: [requestAKey, requestBKey],
      }),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const first = worker.execute({
        type: "execute-app-route",
        id: "request-a",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/env?request=a",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        projectEnv: { [requestAKey]: "tenant-a" },
      });

      const second = worker.execute({
        type: "execute-app-route",
        id: "request-b",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/env?request=b",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        projectEnv: { [requestBKey]: "tenant-b" },
      });

      const [firstResponse, secondResponse] = await Promise.all([first, second]);

      assertEquals(secondResponse.type, "result");
      if (secondResponse.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(secondResponse.response.body ?? new Uint8Array())),
        { request: "b", requestA: null, requestB: "tenant-b" },
      );

      assertEquals(firstResponse.type, "result");
      if (firstResponse.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(firstResponse.response.body ?? new Uint8Array())),
        { request: "a", requestA: "tenant-a", requestB: null },
      );
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("denies host env secrets while allowing project env keys", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const hostKey = "VERYFRONT_TEST_HOST_ONLY_SECRET";
    const projectKey = "VERYFRONT_TEST_PROJECT_ALLOWED_SECRET";
    const previousHostSecret = Deno.env.get(hostKey);

    await Deno.writeTextFile(
      modulePath,
      `
        export function GET() {
          let hostValue = null;
          let hostDenied = false;
          try {
            hostValue = Deno.env.get(${JSON.stringify(hostKey)}) ?? null;
          } catch {
            hostDenied = true;
          }

          let objectHostValue = null;
          let objectDenied = false;
          try {
            objectHostValue = Deno.env.toObject()[${JSON.stringify(hostKey)}] ?? null;
          } catch {
            objectDenied = true;
          }

          return Response.json({
            hostValue,
            hostDenied,
            objectHostValue,
            objectDenied,
            projectValue: Deno.env.get(${JSON.stringify(projectKey)}) ?? null,
          });
        }
      `,
    );

    Deno.env.set(hostKey, "host-secret");

    const worker = new ProjectWorker({
      projectId: "test-env-allowlist",
      permissions: buildWorkerPermissions([projectDir], {
        projectEnvKeys: [projectKey],
      }),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "env-allowlist",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/env",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        projectEnv: { [projectKey]: "project-secret" },
      });

      assertEquals(response.type, "result");
      if (response.type !== "result") throw new Error("expected result response");

      const body = JSON.parse(new TextDecoder().decode(response.response.body ?? new Uint8Array()));
      assertEquals(body.hostValue, null);
      assertEquals(body.hostDenied, true);
      assertEquals(body.objectHostValue, null);
      assertEquals(body.projectValue, "project-secret");
    } finally {
      worker.terminate();
      if (previousHostSecret === undefined) {
        Deno.env.delete(hostKey);
      } else {
        Deno.env.set(hostKey, previousHostSecret);
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects direct Deno file reads outside scoped worker read permissions", async () => {
    const projectDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsidePath = await Deno.makeTempFile({ dir: outsideDir, suffix: ".txt" });
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });

    await Deno.writeTextFile(outsidePath, "outside secret");
    await Deno.writeTextFile(
      modulePath,
      `
        export async function GET() {
          await Deno.readTextFile(${JSON.stringify(outsidePath)});
          return Response.json({ leaked: true });
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-direct-deno-read-denied",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "direct-read",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/read",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "error");
      if (response.type !== "error") throw new Error("expected error response");
      assert(
        response.error.message.includes("Requires read access"),
        `expected permission denial, got: ${response.error.message}`,
      );
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("blocks project fetches to loopback network targets", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const loopbackServer = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      () => Response.json({ leaked: true }),
    );
    const loopbackUrl = `http://127.0.0.1:${loopbackServer.addr.port}/secret`;

    await Deno.writeTextFile(
      modulePath,
      `
        export async function GET() {
          const response = await fetch(${JSON.stringify(loopbackUrl)});
          return Response.json({ leaked: response.ok });
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-worker-egress-loopback-denied",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "loopback-fetch",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/fetch-loopback",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "error");
      if (response.type !== "error") throw new Error("expected error response");
      assert(
        response.error.message.includes("Worker network egress blocked"),
        `expected egress denial, got: ${response.error.message}`,
      );
    } finally {
      worker.terminate();
      await loopbackServer.shutdown();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("blocks project TCP connections to loopback network targets", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const accept = (async () => {
      const conn = await listener.accept();
      conn.close();
    })();

    await Deno.writeTextFile(
      modulePath,
      `
        export async function GET() {
          const conn = await Deno.connect({
            hostname: "127.0.0.1",
            port: ${listener.addr.port},
          });
          conn.close();
          return Response.json({ connected: true });
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-worker-egress-loopback-connect-denied",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "loopback-connect",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/connect-loopback",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "error");
      if (response.type !== "error") throw new Error("expected error response");
      assert(
        response.error.message.includes("Worker network egress blocked"),
        `expected egress denial, got: ${response.error.message}`,
      );
    } finally {
      worker.terminate();
      listener.close();
      await accept.catch(() => {});
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("allows project loopback fetches when internal egress override is enabled", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const previousOverride = Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
    const loopbackServer = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      () => Response.json({ reachable: true }),
    );
    const loopbackUrl = `http://127.0.0.1:${loopbackServer.addr.port}/internal`;

    await Deno.writeTextFile(
      modulePath,
      `
        export async function GET() {
          const response = await fetch(${JSON.stringify(loopbackUrl)});
          return Response.json(await response.json());
        }
      `,
    );

    Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "1");

    const worker = new ProjectWorker({
      projectId: "test-worker-egress-loopback-override",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "loopback-fetch-override",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/fetch-loopback",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "result");
      if (response.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(response.response.body ?? new Uint8Array())),
        { reachable: true },
      );
    } finally {
      worker.terminate();
      await loopbackServer.shutdown();
      if (previousOverride === undefined) {
        Deno.env.delete(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
      } else {
        Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, previousOverride);
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("replays a POST body safely across a brokered 307 redirect", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const previousOverride = Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
    let finalRequests = 0;
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/start") {
          return new Response(null, { status: 307, headers: { location: "/final" } });
        }
        finalRequests++;
        return Response.json({
          method: request.method,
          body: await request.text(),
          marker: request.headers.get("x-test-marker"),
        });
      },
    );
    const address = server.addr;
    if (address.transport !== "tcp") throw new Error("expected TCP test server");
    const targetUrl = `http://127.0.0.1:${address.port}/start`;

    await Deno.writeTextFile(
      modulePath,
      `
        export async function GET() {
          const response = await fetch(${JSON.stringify(targetUrl)}, {
            method: "POST",
            body: "payload",
            headers: { "x-test-marker": "preserved" },
          });
          return Response.json(await response.json());
        }
      `,
    );
    Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "1");

    const worker = new ProjectWorker({
      projectId: "test-worker-egress-post-307",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });
    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: "post-307",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/post-307",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assertEquals(response.type, "result");
      if (response.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(response.response.body ?? new Uint8Array())),
        { method: "POST", body: "payload", marker: "preserved" },
      );
      assertEquals(finalRequests, 1);
    } finally {
      worker.terminate();
      await server.shutdown();
      if (previousOverride === undefined) {
        Deno.env.delete(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
      } else {
        Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, previousOverride);
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("connects fetch to the validated address without a second DNS lookup", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const previousOverride = Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
    let trapRequests = 0;
    let validatedRequests = 0;
    let resolutionCount = 0;
    const trapServer = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      () => {
        trapRequests++;
        return Response.json({ source: "dns-rebind" });
      },
    );
    const trapAddress = trapServer.addr;
    if (trapAddress.transport !== "tcp") throw new Error("expected TCP test server");
    const validatedServer = Deno.serve(
      { hostname: "::1", port: trapAddress.port, onListen: () => {} },
      (request) => {
        validatedRequests++;
        return Response.json({
          source: "validated",
          host: request.headers.get("host"),
        });
      },
    );
    const targetUrl = `http://localhost:${trapAddress.port}/pinned`;

    await Deno.writeTextFile(
      modulePath,
      `
        export async function GET() {
          const response = await fetch(${JSON.stringify(targetUrl)});
          return Response.json(await response.json());
        }
      `,
    );
    Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "1");

    const worker = new ProjectWorker({
      projectId: "test-worker-egress-dns-pinned-fetch",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      egressResolveHost: (hostname) => {
        assertEquals(hostname, "localhost");
        resolutionCount++;
        return Promise.resolve(resolutionCount === 1 ? ["::1"] : ["127.0.0.1"]);
      },
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: "dns-pinned-fetch",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/dns-pinned-fetch",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "result");
      if (response.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(response.response.body ?? new Uint8Array())),
        { source: "validated", host: `localhost:${trapAddress.port}` },
      );
      assertEquals(resolutionCount, 1);
      assertEquals(validatedRequests, 1);
      assertEquals(trapRequests, 0);
    } finally {
      worker.terminate();
      await Promise.all([trapServer.shutdown(), validatedServer.shutdown()]);
      if (previousOverride === undefined) {
        Deno.env.delete(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
      } else {
        Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, previousOverride);
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("routes raw TCP through the validated broker connection", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const previousOverride = Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
    const listener = Deno.listen({ hostname: "::1", port: 0 });
    const exchange = (async () => {
      const connection = await listener.accept();
      try {
        const request = new Uint8Array(4);
        let offset = 0;
        while (offset < request.length) {
          const read = await connection.read(request.subarray(offset));
          if (read === null) throw new Error("raw TCP test connection closed early");
          offset += read;
        }
        assertEquals(new TextDecoder().decode(request), "ping");
        assertEquals(await connection.read(new Uint8Array(1)), null);
        await connection.write(new TextEncoder().encode("pong"));
      } finally {
        connection.close();
      }
    })();
    let resolutionCount = 0;

    await Deno.writeTextFile(
      modulePath,
      `
        export async function GET() {
          const connection = await Deno.connect({
            hostname: "socket.invalid",
            port: ${listener.addr.port},
          });
          try {
            await connection.write(new TextEncoder().encode("ping"));
            await connection.closeWrite();
            const response = new Uint8Array(4);
            let offset = 0;
            while (offset < response.length) {
              const read = await connection.read(response.subarray(offset));
              if (read === null) throw new Error("raw TCP response closed early");
              offset += read;
            }
            return Response.json({ value: new TextDecoder().decode(response) });
          } finally {
            connection.close();
          }
        }
      `,
    );
    Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "1");

    const worker = new ProjectWorker({
      projectId: "test-worker-egress-raw-tcp-pinned",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      egressResolveHost: (hostname) => {
        assertEquals(hostname, "socket.invalid");
        resolutionCount++;
        return Promise.resolve(["::1"]);
      },
    });
    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: "raw-tcp-pinned",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/raw-tcp",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assertEquals(response.type, "result", JSON.stringify(response));
      if (response.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(response.response.body ?? new Uint8Array())),
        { value: "pong" },
      );
      assertEquals(resolutionCount, 1);
      await exchange;
    } finally {
      worker.terminate();
      listener.close();
      await exchange.catch(() => undefined);
      if (previousOverride === undefined) {
        Deno.env.delete(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
      } else {
        Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, previousOverride);
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("denies unwrapped native network clients at the worker permission boundary", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const previousOverride = Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    let accepted = false;
    const accept = listener.accept().then((connection) => {
      accepted = true;
      connection.close();
    }).catch(() => undefined);
    let webSocketAccepted = 0;
    const webSocketServer = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      (request) => {
        webSocketAccepted++;
        const { response, socket } = Deno.upgradeWebSocket(request);
        socket.onopen = () => socket.close();
        return response;
      },
    );
    const webSocketAddress = webSocketServer.addr;
    if (webSocketAddress.transport !== "tcp") throw new Error("expected TCP WebSocket server");

    await Deno.writeTextFile(
      modulePath,
      `
        import { connect } from "node:net";

        export async function GET() {
          const result = await new Promise((resolve) => {
            const socket = connect({ host: "127.0.0.1", port: ${listener.addr.port} });
            socket.setTimeout(2_000);
            socket.once("connect", () => {
              socket.destroy();
              resolve({ blocked: false });
            });
            socket.once("error", (error) => resolve({
              blocked: true,
              message: String(error?.message ?? error),
            }));
            socket.once("timeout", () => {
              socket.destroy();
              resolve({ blocked: true, message: "timed out" });
            });
          });
          const webSocketBlocked = await new Promise((resolve) => {
            try {
              const socket = new WebSocket("ws://127.0.0.1:${webSocketAddress.port}/socket");
              const timer = setTimeout(() => {
                socket.close();
                resolve(false);
              }, 2_000);
              socket.onopen = () => {
                clearTimeout(timer);
                socket.close();
                resolve(false);
              };
              socket.onerror = () => {
                clearTimeout(timer);
                resolve(true);
              };
            } catch {
              resolve(true);
            }
          });
          return Response.json({
            nodeBlocked: result.blocked,
            nodeMessage: result.message,
            webSocketBlocked,
          });
        }
      `,
    );
    Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "1");

    const worker = new ProjectWorker({
      projectId: "test-worker-egress-native-bypass-denied",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
    });
    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: "native-bypass-denied",
        modulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/native-bypass",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assertEquals(response.type, "result");
      if (response.type !== "result") throw new Error("expected result response");
      const body = JSON.parse(
        new TextDecoder().decode(response.response.body ?? new Uint8Array()),
      );
      assertEquals(body.nodeBlocked, true);
      assertEquals(body.nodeMessage === "timed out", false);
      assertEquals(body.webSocketBlocked, true);
      assertEquals(accepted, false);
      assertEquals(webSocketAccepted, 0);
    } finally {
      worker.terminate();
      listener.close();
      await accept;
      await webSocketServer.shutdown();
      if (previousOverride === undefined) {
        Deno.env.delete(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
      } else {
        Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, previousOverride);
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

testSuite("ProjectWorker - executeStream", () => {
  it("throws when worker is not started", () => {
    const worker = createTestWorker("test-stream");
    let threw = false;
    try {
      worker.executeStream({
        type: "render-ssr",
        id: "test-id",
        pageModulePath: "/nonexistent.ts",
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "stream",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
    } catch {
      threw = true;
    }
    assert(threw, "should throw when worker is not available");
  });

  it("returns a ReadableStream when worker is started", async () => {
    const worker = createTestWorker("test-stream");
    worker.start();
    try {
      const stream = worker.executeStream({
        type: "render-ssr",
        id: "test-id",
        pageModulePath: "/nonexistent.ts",
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "stream",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assert(stream instanceof ReadableStream, "should return a ReadableStream");
      // Cancel the stream to clean up
      await stream.cancel();
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(worker.status, "terminated");
    } finally {
      worker.terminate();
    }
  });

  it("does not increment request state for a duplicate stream ID", async () => {
    const worker = createTestWorker("test-duplicate-stream");
    const request = {
      type: "render-ssr" as const,
      id: "duplicate-stream",
      pageModulePath: "/nonexistent.ts",
      layoutModulePaths: [],
      pageProps: {},
      layoutProps: [],
      delivery: "stream" as const,
      sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    };

    worker.start();
    try {
      const stream = worker.executeStream(request);
      assertThrows(
        () => worker.executeStream(request),
        Error,
        "already in flight",
      );
      assertEquals(worker.requestCount, 1);
      await stream.cancel();
    } finally {
      worker.terminate();
    }
  });
});
