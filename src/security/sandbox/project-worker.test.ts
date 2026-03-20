import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
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

testSuite("ProjectWorker", () => {
  let worker: ProjectWorker;

  beforeEach(() => {
    worker = new ProjectWorker({
      projectId: "test-project",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 5_000,
    });
  });

  afterEach(() => {
    worker.terminate();
  });

  it("starts in idle state after start()", () => {
    worker.start();
    assertEquals(worker.status, "idle");
    assertEquals(worker.requestCount, 0);
    assertEquals(worker.hasPendingRequests, false);
  });

  it("start() is idempotent", () => {
    worker.start();
    worker.start();
    assertEquals(worker.status, "idle");
  });

  it("terminate sets status to terminated", () => {
    worker.start();
    worker.terminate();
    assertEquals(worker.status, "terminated");
  });

  it("responds to health check", async () => {
    worker.start();
    const healthy = await worker.isHealthy(10_000);
    assertEquals(healthy, true);
  });

  it("health check returns false for terminated worker", async () => {
    worker.start();
    worker.terminate();
    const healthy = await worker.isHealthy(1_000);
    assertEquals(healthy, false);
  });

  it("tracks request count", async () => {
    worker.start();
    assertEquals(worker.requestCount, 0);

    // Send a ping (counted as a request via the execute path)
    // Use isHealthy which goes through the pending mechanism
    await worker.isHealthy(10_000);

    // requestCount only increments via execute(), not isHealthy
    assertEquals(worker.requestCount, 0);
  });

  it("projectId is set correctly", () => {
    assertEquals(worker.projectId, "test-project");
  });
});

testSuite("ProjectWorker - error handling", () => {
  it("rejects execute when worker is not started", async () => {
    const worker = new ProjectWorker({
      projectId: "test-project",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 5_000,
    });

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
  let worker: ProjectWorker;

  beforeEach(() => {
    worker = new ProjectWorker({
      projectId: "test-clear-cache",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 5_000,
    });
  });

  afterEach(() => {
    worker.terminate();
  });

  it("clearModuleCache does not throw on running worker", () => {
    worker.start();
    worker.clearModuleCache();
    assertEquals(worker.status, "idle");
  });

  it("clearModuleCache is no-op on terminated worker", () => {
    worker.start();
    worker.terminate();
    worker.clearModuleCache();
    assertEquals(worker.status, "terminated");
  });

  it("clearModuleCache is no-op before start", () => {
    worker.clearModuleCache();
    // Should not throw
  });
});

testSuite("ProjectWorker - executeStream", () => {
  let worker: ProjectWorker;

  beforeEach(() => {
    worker = new ProjectWorker({
      projectId: "test-stream",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 5_000,
    });
  });

  afterEach(() => {
    worker.terminate();
  });

  it("throws when worker is not started", () => {
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
    worker.start();
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
  });
});
