import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { ProjectWorker } from "./project-worker.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";
import type { WorkerPermissions } from "./worker-permissions.ts";

const testSuite = isDeno ? describe : describe.skip;

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
});

testSuite("ProjectWorker - error handling", () => {
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
      });
      assertEquals(true, false, "Should have thrown");
    } catch (error) {
      assertExists(error);
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
  it("returns a serialized error for unknown worker request types", async () => {
    const worker = new ProjectWorker({
      projectId: "test-unknown-request",
      permissions: REAL_WORKER_PERMISSIONS,
      requestTimeoutMs: 10_000,
    });

    worker.start();
    try {
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

  it("does not leak projectEnv overlays across requests in the same worker", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
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
      });

      assertEquals(second.type, "result");
      if (second.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(second.response.body ?? new Uint8Array())),
        { value: null },
      );
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not leak overlapping projectEnv overlays between concurrent requests", async () => {
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
        projectEnv: { [requestAKey]: "tenant-a" },
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const second = await worker.execute({
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
        projectEnv: { [requestBKey]: "tenant-b" },
      });

      const firstResponse = await first;

      assertEquals(second.type, "result");
      if (second.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(second.response.body ?? new Uint8Array())),
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
      });
    } catch {
      threw = true;
    }
    assert(threw, "should throw when worker is not available");
  });

  it("returns a ReadableStream when worker is started", () => {
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
      });
      assert(stream instanceof ReadableStream, "should return a ReadableStream");
      // Cancel the stream to clean up
      stream.cancel();
    } finally {
      worker.terminate();
    }
  });
});
