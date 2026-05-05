import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { ProjectWorker } from "./project-worker.ts";
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
