import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { ProjectWorker } from "./project-worker.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";
import type { WorkerPermissions } from "./worker-permissions.ts";
import {
  MAX_WORKER_REQUEST_ID_CHARS,
  MAX_WORKER_SSR_CHUNK_BYTES,
  MAX_WORKER_SSR_OUTPUT_BYTES,
  MAX_WORKER_SSR_OUTPUT_CHUNKS,
} from "./worker-types.ts";
import { WORKER_INTERNAL_EGRESS_OVERRIDE_ENV } from "./worker-egress-guard.ts";
import type { WorkerEgressBroker } from "./worker-egress-guard.ts";
import { computeHash } from "#veryfront/utils";
import { SERVICE_OVERLOADED, VeryfrontError } from "#veryfront/errors";
import { validateDataResult } from "#veryfront/data/data-result-validation.ts";
import { fromFileUrl, join, toFileUrl } from "#veryfront/compat/path";

const testSuite = isDeno ? describe : describe.skip;
const TEST_SOURCE_INTEGRATION_POLICY = { schemaVersion: 1, mode: "unrestricted" } as const;
const TEST_EMPTY_MODULE_SOURCE = "export {};";
const TEST_EMPTY_PREPARED_MODULE = {
  source: TEST_EMPTY_MODULE_SOURCE,
  sha256: await computeHash(TEST_EMPTY_MODULE_SOURCE),
};
const TEST_APPLICATION_IDENTITY = Object.freeze({
  issuer: "veryfront:trusted-proxy",
  subject: "user-123",
  email: "user@example.test",
  name: "Example User",
  groups: Object.freeze(["admin"]),
  roles: Object.freeze(["operator"]),
  groupsComplete: true,
  claims: (() => {
    const claims = Object.create(null);
    Object.defineProperty(claims, "sub", {
      value: "user-123",
      enumerable: true,
    });
    Object.defineProperty(claims, "__proto__", {
      value: Object.freeze({ preserved: true }),
      enumerable: true,
    });
    return Object.freeze(claims);
  })(),
});
const TEST_ISOLATED_SSR_RENDERER_MODULE_URL = new URL(
  "../../../extensions/ext-react-ssr/src/worker-renderer.ts",
  import.meta.url,
).href;
const TEST_ISOLATED_SSR_RENDERER_READ_PATHS = [
  fromFileUrl(new URL("../../../extensions/ext-react-ssr/src/", import.meta.url)),
];

const TEST_PERMISSIONS: WorkerPermissions = {
  read: true,
  write: false,
  net: false,
  env: false,
  run: false,
  ffi: false,
  sys: false,
  import: false,
};

const REAL_WORKER_PERMISSIONS: WorkerPermissions = {
  read: true,
  write: false,
  net: false,
  env: false,
  run: false,
  ffi: false,
  sys: false,
  import: false,
};

const TEST_WORKER_SCRIPT_URL = `data:application/typescript,${
  encodeURIComponent(`
    self.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "ping") {
        self.postMessage({ type: "pong", id: msg.id });
        return;
      }
      if (msg.type === "ssr-execution-open" || msg.type === "stream-credit") return;
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
    allowInternalEgress: false,
    workerScriptUrl: TEST_WORKER_SCRIPT_URL,
  });
}

function createScriptedWorker(
  projectId: string,
  script: string,
  requestTimeoutMs = 5_000,
): ProjectWorker {
  return new ProjectWorker({
    projectId,
    permissions: TEST_PERMISSIONS,
    requestTimeoutMs,
    allowInternalEgress: false,
    workerScriptUrl: `data:application/typescript,${encodeURIComponent(script)}`,
  });
}

function createSSRScriptedWorker(
  projectId: string,
  behavior: string,
  requestTimeoutMs = 5_000,
): ProjectWorker {
  return createScriptedWorker(
    projectId,
    `
      // @ts-nocheck
      const opens = new Map();
      const send = (open, type, sequence, extra = {}) => {
        self.postMessage({
          type,
          id: open.id,
          generation: open.generation,
          token: open.token,
          sequence,
          ...extra,
        });
      };
      self.onmessage = (event) => {
        const message = event.data;
        if (message.type === "ping") {
          self.postMessage({ type: "pong", id: message.id });
          return;
        }
        if (message.type === "ssr-execution-open") {
          opens.set(message.id, message);
          return;
        }
        const open = opens.get(message.id);
        ${behavior}
      };
    `,
    requestTimeoutMs,
  );
}

function createProductionSSRWorker(
  projectId: string,
  projectDir: string,
): ProjectWorker {
  return new ProjectWorker({
    projectId,
    permissions: buildWorkerPermissions([
      projectDir,
      ...TEST_ISOLATED_SSR_RENDERER_READ_PATHS,
    ]),
    requestTimeoutMs: 30_000,
    allowInternalEgress: false,
    isolatedSsrRendererModuleUrl: TEST_ISOLATED_SSR_RENDERER_MODULE_URL,
  });
}

async function assertWorkerReady(worker: ProjectWorker): Promise<void> {
  assertEquals(await worker.isHealthy(30_000), true);
}

async function collectTightStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const frames: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const frame = result.value;
      assert(frame.byteLength > 0);
      assert(frame.byteLength <= MAX_WORKER_SSR_CHUNK_BYTES);
      assertEquals(frame.byteOffset, 0);
      assert(frame.buffer instanceof ArrayBuffer);
      assertEquals(frame.buffer.byteLength, frame.byteLength);
      const resizable = Object.getOwnPropertyDescriptor(
        ArrayBuffer.prototype,
        "resizable",
      )?.get;
      if (resizable) {
        assertEquals(Reflect.apply(resizable, frame.buffer, []), false);
      }
      frames.push(frame);
      total += frame.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    bytes.set(frame, offset);
    offset += frame.byteLength;
  }
  return bytes;
}

async function waitForWorkerStatus(
  worker: ProjectWorker,
  status: "idle" | "busy" | "crashed" | "terminated",
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (worker.status !== status && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assertEquals(worker.status, status);
}

function makeScriptedSSRRequest(
  id: string,
  delivery: "string" | "stream" = "stream",
) {
  return {
    type: "render-ssr" as const,
    id,
    pageModulePath: "/nonexistent.ts",
    layoutModulePaths: [],
    pageProps: {},
    layoutProps: [],
    delivery,
    sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
  };
}

async function prepareModulePath(modulePath: string) {
  const source = await Deno.readTextFile(modulePath);
  return { source, sha256: await computeHash(source) };
}

async function executeIsolatedDataModule(source: string, id: string) {
  const projectDir = await Deno.makeTempDir();
  const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
  await Deno.writeTextFile(modulePath, source);
  const worker = new ProjectWorker({
    projectId: `test-data-result-${id}`,
    permissions: buildWorkerPermissions([projectDir]),
    requestTimeoutMs: 10_000,
    allowInternalEgress: false,
  });
  worker.start();

  try {
    await assertWorkerReady(worker);
    return await worker.execute({
      type: "fetch-data",
      id,
      modulePath,
      context: {
        params: {},
        query: "",
        request: {
          url: "http://localhost/data",
          method: "GET",
          headers: [],
          body: null,
        },
        url: "http://localhost/data",
      },
      sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    });
  } finally {
    worker.terminate();
    await Deno.remove(projectDir, { recursive: true });
  }
}

function assertInvalidIsolatedDataResult(
  response: Awaited<ReturnType<ProjectWorker["execute"]>>,
): void {
  assertEquals(response.type, "error");
  if (response.type !== "error") throw new Error("expected error response");
  assertEquals(response.error.name, "TypeError");
  assert(response.error.message.includes("Invalid isolated data result"));
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

  it("shutdown is single-flight and waits for stalled broker work", async () => {
    const worker = createTestWorker("test-quiescent-shutdown");
    worker.start();
    const brokerCompletion = Promise.withResolvers<void>();
    let closeCalls = 0;
    const broker: WorkerEgressBroker = {
      config: {
        socksProxy: {
          hostname: "127.0.0.1",
          port: 1,
          username: "test",
          password: "test",
        },
        httpBroker: { url: "http://127.0.0.1:1/fetch", token: "test" },
        netAllowlist: ["127.0.0.1:1"],
      },
      close() {
        closeCalls++;
      },
      closed: brokerCompletion.promise,
    };
    (worker as unknown as { egressBroker: WorkerEgressBroker | null }).egressBroker = broker;

    const first = worker.shutdown();
    const second = worker.shutdown();
    assert(first === second);
    assertEquals(worker.status, "terminated");
    assertEquals(closeCalls, 1);

    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assertEquals(settled, false);

    brokerCompletion.resolve();
    await first;
    assertEquals(settled, true);
    assertEquals(closeCalls, 1);
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

  it("snapshots permissions at construction so later mutation cannot broaden the worker", async () => {
    const secretPath = await Deno.makeTempFile();
    await Deno.writeTextFile(secretPath, "permission-snapshot-secret");
    const mutableRead: string[] = [];
    const mutablePermissions: WorkerPermissions = {
      read: mutableRead,
      write: false,
      net: false,
      env: false,
      run: false,
      ffi: false,
      sys: false,
      import: false,
    };
    const worker = new ProjectWorker({
      projectId: "test-permission-snapshot",
      permissions: mutablePermissions,
      requestTimeoutMs: 5_000,
      allowInternalEgress: false,
      workerScriptUrl: `data:application/typescript,${
        encodeURIComponent(`
          self.onmessage = async (event) => {
            const message = event.data;
            if (message.type !== "ping") return;
            let broadened = false;
            try {
              await Deno.readTextFile(${JSON.stringify(secretPath)});
              broadened = true;
            } catch {
              // Expected: the construction-time empty read scope is immutable.
            }
            self.postMessage({
              type: broadened ? "permission-broadened" : "pong",
              id: message.id,
            });
          };
        `)
      }`,
    });

    mutableRead.push(secretPath);
    mutablePermissions.read = true;
    mutablePermissions.net = true;

    try {
      worker.start();
      assertEquals(await worker.isHealthy(5_000), true);
    } finally {
      await worker.shutdown();
      await Deno.remove(secretPath);
    }
  });

  it("canonicalizes and freezes permission arrays without retaining caller storage", () => {
    const source = ["/project/b", "/project/a", "/project/b"];
    const worker = new ProjectWorker({
      projectId: "test-permission-canonicalization",
      permissions: { ...TEST_PERMISSIONS, read: source },
      requestTimeoutMs: 5_000,
      allowInternalEgress: false,
      workerScriptUrl: TEST_WORKER_SCRIPT_URL,
    });
    const captured = (worker as unknown as {
      permissions: Readonly<WorkerPermissions>;
    }).permissions;

    source.push("/project/c");
    assertEquals(captured.read, ["/project/a", "/project/b"]);
    assertEquals(Object.isFrozen(captured), true);
    assertEquals(Object.isFrozen(captured.read), true);
  });

  it("rejects hostile permission accessors without invoking them", () => {
    let getterCalls = 0;
    const permissions = Object.defineProperty(
      { ...TEST_PERMISSIONS },
      "read",
      {
        enumerable: true,
        get() {
          getterCalls++;
          return true;
        },
      },
    );

    assertThrows(
      () =>
        new ProjectWorker({
          projectId: "test-permission-accessor",
          permissions,
          requestTimeoutMs: 5_000,
          allowInternalEgress: false,
        }),
      TypeError,
      "read must be an enumerable data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("rejects non-enumerable permission array entries", () => {
    const read = ["/project/a"];
    Object.defineProperty(read, "0", {
      configurable: true,
      enumerable: false,
      value: "/project/a",
      writable: true,
    });

    assertThrows(
      () =>
        new ProjectWorker({
          projectId: "test-permission-array-enumerability",
          permissions: { ...TEST_PERMISSIONS, read },
          requestTimeoutMs: 5_000,
          allowInternalEgress: false,
        }),
      TypeError,
      "read contains a noncanonical entry",
    );
  });

  it("rejects unrestricted network access for custom worker scripts", () => {
    const worker = new ProjectWorker({
      projectId: "test-custom-worker-network",
      permissions: { ...TEST_PERMISSIONS, net: true },
      requestTimeoutMs: 5_000,
      allowInternalEgress: false,
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

  it("rejects invalid request timeouts before starting a worker", () => {
    for (
      const requestTimeoutMs of [
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]
    ) {
      assertThrows(
        () =>
          new ProjectWorker({
            projectId: "invalid-timeout",
            permissions: TEST_PERMISSIONS,
            requestTimeoutMs,
            allowInternalEgress: false,
          }),
        Error,
        "requestTimeoutMs must be a positive safe integer",
      );
    }
  });

  it("requires an explicit host-owned internal-egress decision", () => {
    assertThrows(
      () =>
        new ProjectWorker({
          projectId: "missing-internal-egress-policy",
          permissions: TEST_PERMISSIONS,
          requestTimeoutMs: 5_000,
          allowInternalEgress: undefined as unknown as boolean,
        }),
      TypeError,
      "allowInternalEgress must be a boolean",
    );
  });
});

testSuite("ProjectWorker - error handling", () => {
  it("cancels an uncaught child error and retires its pending generation once", async () => {
    const worker = createScriptedWorker(
      "test-uncaught-child-error",
      `
        self.onmessage = (event) => {
          if (event.data.type === "ping") {
            self.postMessage({ type: "pong", id: event.data.id });
            return;
          }
          queueMicrotask(() => {
            throw new Error("uncaught child worker failure");
          });
        };
      `,
    );
    let idleNotifications = 0;
    let rejections = 0;
    const unsubscribe = worker.onIdle(() => idleNotifications++);
    worker.start();

    try {
      const error = await worker.execute({
        type: "execute-app-route",
        id: "uncaught-child-error",
        module: TEST_EMPTY_PREPARED_MODULE,
        modulePath: "/project/route.ts",
        method: "GET",
        request: {
          url: "http://localhost/api/test",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir: "/project",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,

        applicationIdentity: null,
      }).then(
        () => undefined,
        (cause: unknown) => {
          rejections++;
          return cause;
        },
      );

      assert(error instanceof Error);
      await waitForWorkerStatus(worker, "crashed");
      await new Promise((resolve) => setTimeout(resolve, 25));
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(rejections, 1);
      assertEquals(idleNotifications, 1);
    } finally {
      unsubscribe();
      worker.terminate();
    }
  });

  it("rejects malformed request ids before worker protocol admission", async () => {
    const worker = createTestWorker("test-invalid-request-id");
    worker.start();
    try {
      for (const id of ["", "x".repeat(MAX_WORKER_REQUEST_ID_CHARS + 1)]) {
        await assertRejects(
          () =>
            worker.execute({
              type: "execute-app-route",
              id,
              module: TEST_EMPTY_PREPARED_MODULE,
              modulePath: "/project/route.ts",
              method: "GET",
              request: {
                url: "http://localhost/api/test",
                method: "GET",
                headers: [],
                body: null,
              },
              params: {},
              projectDir: "/project",
              sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,

              applicationIdentity: null,
            }),
          Error,
          "Worker request id must be a non-empty string",
        );
      }

      assertEquals(worker.hasPendingRequests, false);
      assertEquals(worker.requestCount, 0);
      assertEquals(worker.status, "idle");
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
        module: TEST_EMPTY_PREPARED_MODULE,
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

        applicationIdentity: null,
      });
      assertEquals(true, false, "Should have thrown");
    } catch (error) {
      assertExists(error);
    }
  });

  it("cleans pending state and retires the worker on synchronous clone failure", async () => {
    const worker = createTestWorker("test-clone-failure");
    worker.start();
    try {
      const rejected = await worker.execute({
        type: "execute-app-route",
        id: "invalid-clone",
        module: {
          source: "export function GET() {}",
          sha256: "0".repeat(64),
        },
        modulePath: "/project/route.ts",
        method: "GET",
        request: {
          url: "http://localhost/api/test",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {
          invalid: (() => undefined) as unknown as string,
        },
        projectDir: "/project",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,

        applicationIdentity: null,
      }).then(
        () => false,
        () => true,
      );

      assertEquals(rejected, true);
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(worker.status, "crashed");
    } finally {
      worker.terminate();
    }
  });

  it("rejects existing requests when a later send proves the channel unusable", async () => {
    const worker = createTestWorker("test-clone-failure-concurrent");
    worker.start();
    try {
      const hanging = worker.execute({
        type: "render-ssr",
        id: "hanging",
        pageModulePath: "/project/page.ts",
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "string",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      const invalid = worker.execute({
        type: "execute-app-route",
        id: "invalid-clone",
        module: {
          source: "export function GET() {}",
          sha256: "0".repeat(64),
        },
        modulePath: "/project/route.ts",
        method: "GET",
        request: {
          url: "http://localhost/api/test",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {
          invalid: (() => undefined) as unknown as string,
        },
        projectDir: "/project",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,

        applicationIdentity: null,
      });

      const results = await Promise.allSettled([hanging, invalid]);
      assertEquals(results[0]?.status, "rejected");
      assertEquals(results[1]?.status, "rejected");
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(worker.status, "crashed");
    } finally {
      worker.terminate();
    }
  });

  it("fatally rejects a response that does not match the pending request type", async () => {
    const script = `data:application/typescript,${
      encodeURIComponent(`
        self.onmessage = (event) => {
          const msg = event.data;
          self.postMessage({ type: "data-result", id: msg.id, result: { props: {} } });
        };
      `)
    }`;
    const worker = new ProjectWorker({
      projectId: "test-response-type-mismatch",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 5_000,
      allowInternalEgress: false,
      workerScriptUrl: script,
    });
    worker.start();
    try {
      const rejected = await worker.execute({
        type: "execute-app-route",
        id: "wrong-response",
        module: {
          source: "export function GET() {}",
          sha256: "0".repeat(64),
        },
        modulePath: "/project/route.ts",
        method: "GET",
        request: {
          url: "http://localhost/api/test",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir: "/project",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,

        applicationIdentity: null,
      }).then(
        () => false,
        () => true,
      );

      assertEquals(rejected, true);
      assertEquals(worker.status, "crashed");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });
});

testSuite("ProjectWorker - clearModuleCache", () => {
  it("retires a running worker because ESM modules cannot be evicted in-place", () => {
    const worker = createTestWorker("test-clear-cache");
    worker.start();
    try {
      worker.clearModuleCache();
      assertEquals(worker.status, "terminated");
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
      const [label, exitStatement, overrideAttempt] of [
        [
          "close",
          "globalThis.close()",
          `
            try { globalThis.close = () => {}; } catch {}
            try {
              Object.defineProperty(self, "close", {
                configurable: true,
                writable: true,
                value: () => {},
              });
            } catch {}
          `,
        ],
        [
          "deno-exit",
          "Deno.exit(0)",
          `
            try { Deno.exit = () => {}; } catch {}
            try {
              Object.defineProperty(Deno, "exit", {
                configurable: true,
                writable: true,
                value: () => {},
              });
            } catch {}
          `,
        ],
      ]
    ) {
      const projectDir = await Deno.makeTempDir();
      const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
      await Deno.writeTextFile(
        modulePath,
        `
          export function GET() {
            self.postMessage = () => {};
            ${overrideAttempt}
            ${exitStatement};
            return Response.json({ exited: false });
          }
        `,
      );
      const worker = new ProjectWorker({
        projectId: `test-worker-${label}`,
        permissions: buildWorkerPermissions([projectDir]),
        requestTimeoutMs: 10_000,
        allowInternalEgress: false,
      });
      let timeout: number | undefined;

      try {
        worker.start();
        await assertWorkerReady(worker);
        const rejected = await Promise.race([
          worker.execute({
            type: "execute-app-route",
            id: `worker-${label}`,
            module: await prepareModulePath(modulePath),
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

            applicationIdentity: null,
          }).then(
            () => false,
            () => true,
          ),
          new Promise<boolean>((resolve) => {
            timeout = setTimeout(() => resolve(false), 15_000);
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
      allowInternalEgress: false,
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
      assertEquals(response.error.name, "TypeError");
      assertEquals(response.error.message, "Invalid worker request type");
    } finally {
      worker.terminate();
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
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: requestId,
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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
      allowInternalEgress: false,
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
        module: TEST_EMPTY_PREPARED_MODULE,
        modulePath,
        method: "GET",
        request: serializedRequest,
        params: {},
        projectDir,

        applicationIdentity: null,
      },
      {
        type: "execute-pages-route",
        id: "pages-route",
        module: TEST_EMPTY_PREPARED_MODULE,
        modulePath,
        method: "GET",
        context: { request: serializedRequest, params: {}, cookies: {} },
        projectDir,

        applicationIdentity: null,
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

  it("passes immutable request env without granting process-global env access", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const projectKey = "VERYFRONT_TEST_TENANT_SECRET";
    const previousOverride = Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
    await Deno.writeTextFile(
      modulePath,
      `
        export function GET(_request, context) {
          let processEnvDenied = false;
          try {
            Deno.env.set(${JSON.stringify(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV)}, "1");
          } catch {
            processEnvDenied = true;
          }

          let mutationDenied = false;
          try {
            context.env[${JSON.stringify(projectKey)}] = "mutated";
          } catch {
            mutationDenied = true;
          }

          return Response.json({
            value: context.env[${JSON.stringify(projectKey)}] ?? null,
            frozen: Object.isFrozen(context.env),
            mutationDenied,
            processEnvDenied,
          });
        }
      `,
    );

    Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "0");

    const worker = new ProjectWorker({
      projectId: "test-env-overlay-scope",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const first = await worker.execute({
        type: "execute-app-route",
        id: "first",
        module: await prepareModulePath(modulePath),
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
        projectEnv: { [projectKey]: "tenant-a" },

        applicationIdentity: null,
      });

      assertEquals(first.type, "result");
      if (first.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(first.response.body ?? new Uint8Array())),
        {
          value: "tenant-a",
          frozen: true,
          mutationDenied: true,
          processEnvDenied: true,
        },
      );
      assertEquals(Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV), "0");

      const second = await worker.execute({
        type: "execute-app-route",
        id: "second",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
      });

      assertEquals(second.type, "result");
      if (second.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(second.response.body ?? new Uint8Array())),
        {
          value: null,
          frozen: true,
          mutationDenied: true,
          processEnvDenied: true,
        },
      );
      assertEquals(Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV), "0");
    } finally {
      worker.terminate();
      if (previousOverride === undefined) {
        Deno.env.delete(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
      } else {
        Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, previousOverride);
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("passes immutable request env to Pages route context", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const projectKey = "VERYFRONT_TEST_PAGES_ENV";
    await Deno.writeTextFile(
      modulePath,
      `
        export function GET(context) {
          return Response.json({
            value: context.env[${JSON.stringify(projectKey)}] ?? null,
            frozen: Object.isFrozen(context.env),
          });
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-pages-request-env",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-pages-route",
        id: "pages-request-env",
        module: await prepareModulePath(modulePath),
        modulePath,
        method: "GET",
        context: {
          url: "http://localhost/api/pages-env",
          method: "GET",
          headers: [],
          body: null,
          params: {},
          cookies: {},
        },
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        projectEnv: { [projectKey]: "pages-secret" },

        applicationIdentity: null,
      });

      assertEquals(response.type, "result");
      if (response.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(response.response.body ?? new Uint8Array())),
        { value: "pages-secret", frozen: true },
      );
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("passes immutable application identity per App and Pages route request without reuse bleed", async () => {
    const projectDir = await makeTempDir();
    const appModulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const pagesModulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const poisonModulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    await Deno.writeTextFile(
      appModulePath,
      `
        export function GET(_request, context) {
          const identity = context.identity;
          return Response.json({
            subject: identity?.subject ?? null,
            email: identity?.email ?? null,
            groups: identity?.groups ?? null,
            roles: identity?.roles ?? null,
            groupsComplete: identity?.groupsComplete ?? null,
            frozen: identity === null ? null : {
              root: Object.isFrozen(identity),
              rootProto: Object.getPrototypeOf(identity) === null,
              groups: Object.isFrozen(identity.groups),
              roles: Object.isFrozen(identity.roles),
              claims: Object.isFrozen(identity.claims),
              proto: Object.getPrototypeOf(identity.claims) === null,
              protoClaim: identity.claims.__proto__,
            },
            sameWithinContext: identity === context.identity,
          });
        }
      `,
    );
    await Deno.writeTextFile(
      pagesModulePath,
      `
        export function GET(context) {
          const identity = context.identity;
          return Response.json({
            subject: identity?.subject ?? null,
            email: identity?.email ?? null,
            frozen: identity === null ? null : {
              root: Object.isFrozen(identity),
              rootProto: Object.getPrototypeOf(identity) === null,
              groups: Object.isFrozen(identity.groups),
              roles: Object.isFrozen(identity.roles),
              claims: Object.isFrozen(identity.claims),
            },
            sameWithinContext: identity === context.identity,
          });
        }
      `,
    );
    await Deno.writeTextFile(
      poisonModulePath,
      `
        export function GET() {
          Set.prototype[Symbol.iterator] = function* () {
            throw new Error("poisoned Set iterator");
          };
          return new Response("poisoned");
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-worker-application-identity",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);
      const appResponse = await worker.execute({
        type: "execute-app-route",
        id: "app-identity",
        module: await prepareModulePath(appModulePath),
        modulePath: appModulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/app-identity",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        applicationIdentity: TEST_APPLICATION_IDENTITY,
      });
      assertEquals(appResponse.type, "result");
      if (appResponse.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(appResponse.response.body ?? new Uint8Array())),
        {
          subject: "user-123",
          email: "user@example.test",
          groups: ["admin"],
          roles: ["operator"],
          groupsComplete: true,
          frozen: {
            root: true,
            rootProto: true,
            groups: true,
            roles: true,
            claims: true,
            proto: true,
            protoClaim: { preserved: true },
          },
          sameWithinContext: true,
        },
      );

      const pagesResponse = await worker.execute({
        type: "execute-pages-route",
        id: "pages-identity",
        module: await prepareModulePath(pagesModulePath),
        modulePath: pagesModulePath,
        method: "GET",
        context: {
          url: "http://localhost/api/pages-identity",
          method: "GET",
          headers: [],
          body: null,
          params: {},
          cookies: {},
        },
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        applicationIdentity: TEST_APPLICATION_IDENTITY,
      });
      assertEquals(pagesResponse.type, "result");
      if (pagesResponse.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(pagesResponse.response.body ?? new Uint8Array())),
        {
          subject: "user-123",
          email: "user@example.test",
          frozen: {
            root: true,
            rootProto: true,
            groups: true,
            roles: true,
            claims: true,
          },
          sameWithinContext: true,
        },
      );

      const poisonResponse = await worker.execute({
        type: "execute-app-route",
        id: "poison-set-iterator",
        module: await prepareModulePath(poisonModulePath),
        modulePath: poisonModulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/poison",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        applicationIdentity: null,
      });
      assertEquals(poisonResponse.type, "result");
      if (poisonResponse.type !== "result") throw new Error("expected result response");
      assertEquals(
        new TextDecoder().decode(poisonResponse.response.body ?? new Uint8Array()),
        "poisoned",
      );

      const postPoisonResponse = await worker.execute({
        type: "execute-app-route",
        id: "identity-after-set-iterator-poisoning",
        module: await prepareModulePath(appModulePath),
        modulePath: appModulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/app-identity",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        applicationIdentity: TEST_APPLICATION_IDENTITY,
      });
      assertEquals(postPoisonResponse.type, "result");
      if (postPoisonResponse.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(postPoisonResponse.response.body ?? new Uint8Array())),
        {
          subject: "user-123",
          email: "user@example.test",
          groups: ["admin"],
          roles: ["operator"],
          groupsComplete: true,
          frozen: {
            root: true,
            rootProto: true,
            groups: true,
            roles: true,
            claims: true,
            proto: true,
            protoClaim: { preserved: true },
          },
          sameWithinContext: true,
        },
      );

      const anonymousResponse = await worker.execute({
        type: "execute-app-route",
        id: "anonymous-after-identity",
        module: await prepareModulePath(appModulePath),
        modulePath: appModulePath,
        method: "GET",
        request: {
          url: "http://localhost/api/app-identity",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        applicationIdentity: null,
      });
      assertEquals(anonymousResponse.type, "result");
      if (anonymousResponse.type !== "result") throw new Error("expected result response");
      assertEquals(
        JSON.parse(new TextDecoder().decode(anonymousResponse.response.body ?? new Uint8Array())),
        {
          subject: null,
          email: null,
          groups: null,
          roles: null,
          groupsComplete: null,
          frozen: null,
          sameWithinContext: true,
        },
      );
    } finally {
      worker.terminate();
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

        export async function GET(request, context) {
          const url = new URL(request.url);
          if (url.searchParams.get("request") === "a") {
            await sleep(100);
          }

          return Response.json({
            request: url.searchParams.get("request"),
            requestA: context.env[${JSON.stringify(requestAKey)}] ?? null,
            requestB: context.env[${JSON.stringify(requestBKey)}] ?? null,
          });
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-concurrent-env-overlay-scope",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const first = worker.execute({
        type: "execute-app-route",
        id: "request-a",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
      });

      const second = worker.execute({
        type: "execute-app-route",
        id: "request-b",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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

  it("denies all Deno env access while exposing only request env in context", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    const hostKey = "VERYFRONT_TEST_HOST_ONLY_SECRET";
    const projectKey = "VERYFRONT_TEST_PROJECT_ALLOWED_SECRET";
    const previousHostSecret = Deno.env.get(hostKey);

    await Deno.writeTextFile(
      modulePath,
      `
        export function GET(_request, context) {
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

          let projectValue = null;
          let projectDenied = false;
          try {
            projectValue = Deno.env.get(${JSON.stringify(projectKey)}) ?? null;
          } catch {
            projectDenied = true;
          }

          return Response.json({
            hostValue,
            hostDenied,
            objectHostValue,
            objectDenied,
            projectValue,
            projectDenied,
            contextProjectValue: context.env[${JSON.stringify(projectKey)}] ?? null,
          });
        }
      `,
    );

    Deno.env.set(hostKey, "host-secret");

    const worker = new ProjectWorker({
      projectId: "test-env-allowlist",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "env-allowlist",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
      });

      assertEquals(response.type, "result");
      if (response.type !== "result") throw new Error("expected result response");

      const body = JSON.parse(new TextDecoder().decode(response.response.body ?? new Uint8Array()));
      assertEquals(body.hostValue, null);
      assertEquals(body.hostDenied, true);
      assertEquals(body.objectHostValue, null);
      assertEquals(body.objectDenied, true);
      assertEquals(body.projectValue, null);
      assertEquals(body.projectDenied, true);
      assertEquals(body.contextProjectValue, "project-secret");
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

  it("rejects cyclic fetch-data results before control-port serialization", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
    await Deno.writeTextFile(
      modulePath,
      `
        export function getServerData() {
          const props = {};
          props.self = props;
          return { props };
        }
      `,
    );

    const worker = new ProjectWorker({
      projectId: "test-cyclic-data-result",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });
    worker.start();

    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "fetch-data",
        id: "cyclic-data-result",
        modulePath,
        context: {
          params: {},
          query: "",
          request: {
            url: "http://localhost/data",
            method: "GET",
            headers: [],
            body: null,
          },
          url: "http://localhost/data",
        },
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(response.type, "error");
      if (response.type !== "error") throw new Error("expected error response");
      assertEquals(response.error.name, "TypeError");
      assert(response.error.message.includes("Invalid isolated data result"));
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects unsupported fetch-data result values", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() { return { props: new Map([["key", "value"]]) }; }`,
      "unsupported-data-result",
    );
    assertInvalidIsolatedDataResult(response);
  });

  it("rejects oversized fetch-data result values", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() {
        return { props: { value: "x".repeat(16 * 1024 * 1024 + 1) } };
      }`,
      "oversized-data-result",
    );
    assertInvalidIsolatedDataResult(response);
  });

  it("preserves control precedence for fetch-data outcome combinations", async () => {
    for (
      const [source, expected, slug] of [
        [
          `export function getServerData() {
            return {
              props: { ignored: true },
              redirect: { destination: "/other" },
              notFound: true,
              revalidate: Number.POSITIVE_INFINITY,
            };
          }`,
          { redirect: { destination: "/other" } },
          "redirect-precedence-data-result",
        ],
        [
          `export function getServerData() {
            return {
              props: { ignored: true },
              notFound: true,
              revalidate: "ignored",
            };
          }`,
          { notFound: true },
          "not-found-precedence-data-result",
        ],
      ] as const
    ) {
      const response = await executeIsolatedDataModule(source, slug);

      assertEquals(response.type, "data-result");
      if (response.type !== "data-result") throw new Error("expected data result response");
      assertEquals(response.result, expected);
    }
  });

  it("drops unknown fields from isolated data results before snapshotting", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() {
        return {
          redirect: { destination: "/other", permanent: false, ignored: "nested" },
          ignored: "top-level",
        };
      }`,
      "unknown-data-result-fields",
    );

    assertEquals(response.type, "data-result");
    if (response.type !== "data-result") throw new Error("expected data result response");
    assertEquals(response.result, {
      redirect: { destination: "/other", permanent: false },
    });
  });

  it("matches direct data validation for an empty redirect destination", async () => {
    const directResult = validateDataResult(
      { redirect: { destination: "", permanent: false } },
      "getServerData",
    );
    const isolatedResponse = await executeIsolatedDataModule(
      `export function getServerData() {
        return { redirect: { destination: "", permanent: false } };
      }`,
      "empty-redirect-destination",
    );

    assertEquals(isolatedResponse.type, "data-result");
    if (isolatedResponse.type !== "data-result") {
      throw new Error("expected data result response");
    }
    assertEquals(isolatedResponse.result, directResult);
  });

  it("treats own undefined isolated data-result fields as absent", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() {
        return {
          props: undefined,
          redirect: undefined,
          notFound: true,
          revalidate: undefined,
        };
      }`,
      "undefined-data-result-fields",
    );

    assertEquals(response.type, "data-result");
    if (response.type !== "data-result") throw new Error("expected data result response");
    assertEquals(response.result, { notFound: true });
  });

  it("rejects accessors even when their isolated data-result field is unknown", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() {
        const result = { props: { ok: true } };
        Object.defineProperty(result, "ignored", {
          enumerable: true,
          get() { return "hostile"; },
        });
        return result;
      }`,
      "accessor-data-result-field",
    );
    assertInvalidIsolatedDataResult(response);
  });

  it("preserves valid inactive controls and revalidation metadata", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() {
        return { props: { ok: true }, notFound: false, revalidate: 30 };
      }`,
      "valid-data-result",
    );

    assertEquals(response.type, "data-result");
    if (response.type !== "data-result") throw new Error("expected data result response");
    assertEquals(response.result, {
      props: { ok: true },
      notFound: false,
      revalidate: 30,
    });
  });

  it("rejects negative revalidation metadata", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() {
        return { props: { ok: true }, revalidate: -100 };
      }`,
      "negative-revalidation-data-result",
    );

    assertInvalidIsolatedDataResult(response);
  });

  it("preserves response metadata across the isolated data boundary", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() {
        return {
          props: { ok: true },
          headers: { "x-page-state": "fresh" },
          cookies: [{
            name: "session",
            value: "abc",
            path: "/",
            httpOnly: true,
            sameSite: "lax",
          }],
        };
      }`,
      "response-metadata-data-result",
    );

    assertEquals(response.type, "data-result");
    if (response.type !== "data-result") throw new Error("expected data result response");
    assertEquals(response.result, {
      props: { ok: true },
      headers: { "x-page-state": "fresh" },
      cookies: [{
        name: "session",
        value: "abc",
        path: "/",
        httpOnly: true,
        sameSite: "lax",
      }],
    });
  });

  it("rejects unknown isolated response cookie fields", async () => {
    const response = await executeIsolatedDataModule(
      `export function getServerData() {
        return {
          props: {},
          cookies: [{ name: "session", value: "abc", ignored: true }],
        };
      }`,
      "unknown-response-cookie-field",
    );
    assertInvalidIsolatedDataResult(response);
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
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "direct-read",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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

  it("rejects a scoped read root containing a symlink to an outside file", async () => {
    const projectDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsidePath = join(outsideDir, "secret.txt");
    const linkedPath = join(projectDir, "linked-secret.txt");
    await Deno.writeTextFile(outsidePath, "outside secret");
    await Deno.symlink(outsidePath, linkedPath);

    const worker = new ProjectWorker({
      projectId: "test-preexisting-symlink-denied",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });

    try {
      assertThrows(
        () => worker.start(),
        VeryfrontError,
        "Worker read scope contains a symlink outside its allowed roots",
      );
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("revalidates changed read roots when a replacement source generation starts", async () => {
    const projectDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsidePath = join(outsideDir, "secret.txt");
    const linkedPath = join(projectDir, "linked-secret.txt");
    await Deno.writeTextFile(outsidePath, "outside secret");

    const currentGeneration = new ProjectWorker({
      projectId: "test-current-symlink-generation",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });
    const replacementGeneration = new ProjectWorker({
      projectId: "test-replacement-symlink-generation",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: false,
    });

    currentGeneration.start();
    try {
      await assertWorkerReady(currentGeneration);
      currentGeneration.terminate();
      await Deno.symlink(outsidePath, linkedPath);

      assertThrows(
        () => replacementGeneration.start(),
        VeryfrontError,
        "Worker read scope contains a symlink outside its allowed roots",
      );
    } finally {
      currentGeneration.terminate();
      replacementGeneration.terminate();
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
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "loopback-fetch",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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
      allowInternalEgress: false,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "loopback-connect",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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

  it("allows project loopback fetches only from the captured host egress policy", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = await Deno.makeTempFile({ dir: projectDir, suffix: ".mjs" });
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

    const worker = new ProjectWorker({
      projectId: "test-worker-egress-loopback-override",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 10_000,
      allowInternalEgress: true,
    });

    worker.start();
    try {
      await assertWorkerReady(worker);

      const response = await worker.execute({
        type: "execute-app-route",
        id: "loopback-fetch-override",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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
      allowInternalEgress: true,
    });
    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: "post-307",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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
      allowInternalEgress: true,
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
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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
      allowInternalEgress: true,
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
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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
      allowInternalEgress: false,
    });
    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "execute-app-route",
        id: "native-bypass-denied",
        module: await prepareModulePath(modulePath),
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

        applicationIdentity: null,
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

  it("revalidates changed stream roots when a replacement source generation starts", async () => {
    const projectDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsidePath = join(outsideDir, "secret.txt");
    await Deno.writeTextFile(outsidePath, "outside secret");

    const currentGeneration = new ProjectWorker({
      projectId: "test-current-stream-symlink-generation",
      permissions: { ...buildWorkerPermissions([projectDir]), net: false },
      requestTimeoutMs: 5_000,
      allowInternalEgress: false,
      workerScriptUrl: TEST_WORKER_SCRIPT_URL,
    });
    const replacementGeneration = new ProjectWorker({
      projectId: "test-replacement-stream-symlink-generation",
      permissions: { ...buildWorkerPermissions([projectDir]), net: false },
      requestTimeoutMs: 5_000,
      allowInternalEgress: false,
      workerScriptUrl: TEST_WORKER_SCRIPT_URL,
    });

    currentGeneration.start();
    try {
      currentGeneration.terminate();
      await Deno.symlink(outsidePath, join(projectDir, "linked-secret.txt"));

      assertThrows(
        () => replacementGeneration.start(),
        VeryfrontError,
        "Worker read scope contains a symlink outside its allowed roots",
      );
    } finally {
      currentGeneration.terminate();
      replacementGeneration.terminate();
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
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
    } finally {
      worker.terminate();
    }
  });

  it("terminates the worker generation and rejects concurrent work when the consumer cancels", async () => {
    const worker = createTestWorker("test-stream-cancel");
    worker.start();
    try {
      const concurrentOutcome = worker.execute({
        type: "render-ssr",
        id: "concurrent-request",
        pageModulePath: "/nonexistent.ts",
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "string",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      }).then(
        () => "resolved",
        () => "rejected",
      );
      const stream = worker.executeStream({
        type: "render-ssr",
        id: "cancelled-stream",
        pageModulePath: "/nonexistent.ts",
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "stream",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(worker.status, "busy");
      assertEquals(worker.hasPendingRequests, true);

      await stream.cancel("downstream disconnected");

      assertEquals(await concurrentOutcome, "rejected");
      assertEquals(worker.status, "terminated");
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(await worker.isHealthy(), false);
    } finally {
      worker.terminate();
    }
  });

  it("fails closed with an actionable error when no isolated SSR extension is configured", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-worker-ssr-missing-" });
    const pageModulePath = `${projectDir}/page.ts`;
    await Deno.writeTextFile(pageModulePath, `export default function Page() { return "unused"; }`);
    const worker = new ProjectWorker({
      projectId: "test-missing-ssr-renderer",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 30_000,
      allowInternalEgress: false,
    });
    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "render-ssr",
        id: "missing-renderer",
        pageModulePath,
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "string",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assertEquals(response.type, "error");
      if (response.type !== "error") throw new Error("expected renderer configuration error");
      assert(response.error.message.includes("Install and register @veryfront/ext-react-ssr"));
    } finally {
      await worker.shutdown();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves a sanitized renderer import diagnostic and detached cause", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-worker-ssr-import-" });
    const pageModulePath = `${projectDir}/page.ts`;
    const rendererModulePath = `${projectDir}/renderer.ts`;
    await Deno.writeTextFile(pageModulePath, `export default function Page() { return "unused"; }`);
    await Deno.writeTextFile(
      rendererModulePath,
      `throw new Error("renderer import failed for https://user:secret@example.test/private");`,
    );
    const worker = new ProjectWorker({
      projectId: "test-failed-ssr-renderer-import",
      permissions: buildWorkerPermissions([projectDir]),
      requestTimeoutMs: 30_000,
      allowInternalEgress: false,
      isolatedSsrRendererModuleUrl: toFileUrl(rendererModulePath).href,
    });
    worker.start();
    try {
      await assertWorkerReady(worker);
      const response = await worker.execute({
        type: "render-ssr",
        id: "failed-renderer-import",
        pageModulePath,
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "string",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assertEquals(response.type, "error");
      if (response.type !== "error") throw new Error("expected renderer import error");
      assert(
        response.error.message.includes(
          "Isolated SSR renderer extension import failed: renderer import failed",
        ),
      );
      assertEquals(response.error.message.includes("secret"), false);
      const serializedCause = response.error.problem?.cause;
      assertEquals(serializedCause?.includes("secret"), false);
      assertEquals(serializedCause?.includes("renderer import failed"), true);
    } finally {
      await worker.shutdown();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("streams production isolated SSR through the bounded continuation protocol", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-worker-ssr-stream-" });
    const pageModulePath = `${projectDir}/page.ts`;
    await Deno.writeTextFile(
      pageModulePath,
      `export default function Page() { return "bounded worker stream"; }`,
    );
    const worker = createProductionSSRWorker("test-real-stream-protocol", projectDir);
    worker.start();
    try {
      await assertWorkerReady(worker);
      const stream = worker.executeStream({
        type: "render-ssr",
        id: "real-stream",
        pageModulePath,
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "stream",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      assertEquals(await new Response(stream).text(), "bounded worker stream");
      assertEquals(worker.status, "idle");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("pairs more than 64 concurrent SSR admissions without a hidden wire cap", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-worker-ssr-concurrency-" });
    const pageModulePath = `${projectDir}/page.ts`;
    await Deno.writeTextFile(
      pageModulePath,
      `export default function Page(props) { return "render-" + props.index; }`,
    );
    const worker = createProductionSSRWorker("test-real-concurrent-admission", projectDir);
    worker.start();
    try {
      await assertWorkerReady(worker);
      const responses = await Promise.all(
        Array.from({ length: 65 }, (_, index) =>
          worker.execute({
            type: "render-ssr",
            id: `concurrent-${index}`,
            pageModulePath,
            layoutModulePaths: [],
            pageProps: { index },
            layoutProps: [],
            delivery: "string",
            sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
          })),
      );
      assertEquals(
        responses.map((response) => response.type === "ssr-result" ? response.html : response.type),
        Array.from({ length: 65 }, (_, index) => `render-${index}`),
      );
      assertEquals(worker.status, "idle");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps a 2.5 MiB React text node byte-identical across string and stream delivery", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-worker-ssr-large-" });
    const pageModulePath = `${projectDir}/page.ts`;
    const textBytes = 2 * 1024 * 1024 + 512 * 1024 + 17;
    const multibyteCharacters = Math.floor(textBytes / 2);
    await Deno.writeTextFile(
      pageModulePath,
      `export default function Page() {
        return "é".repeat(${multibyteCharacters}) + ${textBytes % 2 === 0 ? '""' : '"x"'};
      }`,
    );
    const worker = createProductionSSRWorker("test-real-large-frame-splitting", projectDir);
    worker.start();
    try {
      await assertWorkerReady(worker);
      const stringResponse = await worker.execute({
        type: "render-ssr",
        id: "large-string",
        pageModulePath,
        layoutModulePaths: [],
        pageProps: {},
        layoutProps: [],
        delivery: "string",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assertEquals(stringResponse.type, "ssr-result");
      if (stringResponse.type !== "ssr-result") {
        throw new Error("expected an isolated SSR string result");
      }
      const stringBytes = new TextEncoder().encode(stringResponse.html);
      assertEquals(stringBytes.byteLength, textBytes);

      const streamedBytes = await collectTightStream(
        worker.executeStream({
          type: "render-ssr",
          id: "large-stream",
          pageModulePath,
          layoutModulePaths: [],
          pageProps: {},
          layoutProps: [],
          delivery: "stream",
          sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        }),
      );
      assertEquals(streamedBytes.byteLength, textBytes);
      assertEquals(streamedBytes, stringBytes);
      assertEquals(streamedBytes[0], 0xc3);
      assertEquals(streamedBytes.at(-1), "x".charCodeAt(0));
      assertEquals(worker.status, "idle");
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects oversized production SSR in the bounded string collector", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-worker-ssr-limit-" });
    const pageModulePath = `${projectDir}/page.ts`;
    await Deno.writeTextFile(
      pageModulePath,
      `export default function Page() { return "x".repeat(${MAX_WORKER_SSR_OUTPUT_BYTES + 1}); }`,
    );
    const worker = createProductionSSRWorker("test-real-string-limit", projectDir);
    worker.start();
    try {
      await assertWorkerReady(worker);
      const error = await assertRejects(
        () =>
          worker.execute({
            type: "render-ssr",
            id: "real-string-limit",
            pageModulePath,
            layoutModulePaths: [],
            pageProps: {},
            layoutProps: [],
            delivery: "string",
            sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
          }),
        Error,
        `Isolated SSR output exceeded ${MAX_WORKER_SSR_OUTPUT_BYTES} bytes`,
      );
      assertEquals(
        (error as Error & { slug?: string }).slug,
        "ssr-output-limit-exceeded",
      );
      assertEquals(worker.status, "idle");
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(await worker.isHealthy(), true);
    } finally {
      worker.terminate();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("tight-copies an offset byte view without retaining its 10 MiB backing buffer", async () => {
    const worker = createSSRScriptedWorker(
      "test-stream-tight-copy",
      `
        if (message.type === "render-ssr") {
          const backing = new ArrayBuffer(10 * 1024 * 1024);
          const visible = new Uint8Array(backing, 4096, 1);
          visible[0] = 73;
          send(open, "stream-frame", 0, { chunk: visible });
          visible[0] = 99;
          return;
        }
        if (message.type === "stream-credit") {
          send(open, "stream-end", 1);
        }
      `,
    );
    worker.start();
    try {
      await assertWorkerReady(worker);
      const reader = worker.executeStream(makeScriptedSSRRequest("tight-copy")).getReader();
      const first = await reader.read();
      assertEquals(first.done, false);
      assertExists(first.value);
      assertEquals(first.value, new Uint8Array([73]));
      assertEquals(first.value.byteOffset, 0);
      assert(first.value.buffer instanceof ArrayBuffer);
      assertEquals(first.value.buffer.byteLength, 1);
      assertEquals((await reader.read()).done, true);
      reader.releaseLock();
      assertEquals(worker.status, "idle");
    } finally {
      worker.terminate();
    }
  });

  it("rejects shared and growable stream backing memory before enqueue", async () => {
    const assertUnsafeBackingRejected = async (
      projectId: string,
      viewExpression: string,
    ) => {
      const worker = createSSRScriptedWorker(
        projectId,
        `
          if (message.type === "render-ssr") {
            const chunk = ${viewExpression};
            send(open, "stream-frame", 0, { chunk });
          }
        `,
      );
      worker.start();
      try {
        await assertWorkerReady(worker);
        const error = await new Response(
          worker.executeStream(makeScriptedSSRRequest(projectId)),
        ).arrayBuffer().then(
          () => undefined,
          (cause: unknown) => cause,
        );
        assert(error instanceof Error);
        assertEquals(worker.status, "crashed");
        assertEquals(worker.hasPendingRequests, false);
      } finally {
        worker.terminate();
      }
    };

    await assertUnsafeBackingRejected(
      "shared-backing",
      "new Uint8Array(new SharedArrayBuffer(8))",
    );

    const ResizableArrayBuffer = ArrayBuffer as unknown as new (
      byteLength: number,
      options: { maxByteLength: number },
    ) => ArrayBuffer;
    const resizable = new ResizableArrayBuffer(8, { maxByteLength: 16 }) as
      & ArrayBuffer
      & { resizable?: boolean };
    if (resizable.resizable === true) {
      await assertUnsafeBackingRejected(
        "resizable-backing",
        "new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }))",
      );
    }

    const GrowableSharedArrayBuffer = SharedArrayBuffer as unknown as new (
      byteLength: number,
      options: { maxByteLength: number },
    ) => SharedArrayBuffer;
    const growable = new GrowableSharedArrayBuffer(8, {
      maxByteLength: 16,
    }) as SharedArrayBuffer & { growable?: boolean };
    if (growable.growable === true) {
      await assertUnsafeBackingRejected(
        "growable-shared-backing",
        "new Uint8Array(new SharedArrayBuffer(8, { maxByteLength: 16 }))",
      );
    }
  });

  it("fails closed on an uncredited second frame", async () => {
    const worker = createSSRScriptedWorker(
      "test-stream-uncredited-frame",
      `
        if (message.type === "render-ssr") {
          send(open, "stream-frame", 0, { chunk: new Uint8Array([1]) });
          send(open, "stream-frame", 1, { chunk: new Uint8Array([2]) });
        }
      `,
    );
    worker.start();
    try {
      await assertWorkerReady(worker);
      const stream = worker.executeStream(
        makeScriptedSSRRequest("uncredited"),
      );
      await waitForWorkerStatus(worker, "crashed");
      const error = await new Response(stream).arrayBuffer().then(
        () => undefined,
        (cause: unknown) => cause,
      );
      assert(error instanceof Error);
      assertEquals(worker.status, "crashed");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });

  it("holds exactly one max-sized frame at HWM and advances one credit at a time", async () => {
    const worker = createSSRScriptedWorker(
      "test-stream-one-frame-hwm",
      `
        if (message.type === "render-ssr") {
          send(open, "stream-frame", 0, {
            chunk: new Uint8Array(${MAX_WORKER_SSR_CHUNK_BYTES}).fill(1),
          });
          return;
        }
        if (message.type === "stream-credit" && message.sequence === 1) {
          send(open, "stream-frame", 1, {
            chunk: new Uint8Array(${MAX_WORKER_SSR_CHUNK_BYTES}).fill(2),
          });
          return;
        }
        if (message.type === "stream-credit" && message.sequence === 2) {
          send(open, "stream-end", 2);
        }
      `,
      3_000,
    );
    worker.start();
    try {
      await assertWorkerReady(worker);
      const stream = worker.executeStream(makeScriptedSSRRequest("one-frame-hwm"));
      await new Promise((resolve) => setTimeout(resolve, 25));
      assertEquals(worker.status, "busy");

      const bytes = await collectTightStream(stream);
      assertEquals(bytes.byteLength, 2 * MAX_WORKER_SSR_CHUNK_BYTES);
      assertEquals(bytes[0], 1);
      assertEquals(bytes[MAX_WORKER_SSR_CHUNK_BYTES - 1], 1);
      assertEquals(bytes[MAX_WORKER_SSR_CHUNK_BYTES], 2);
      assertEquals(bytes.at(-1), 2);
      assertEquals(worker.status, "idle");
    } finally {
      worker.terminate();
    }
  });

  it("rejects reordered frames and a frame-to-string terminal transition", async () => {
    for (
      const [projectId, behavior] of [
        [
          "reordered-frame",
          `send(open, "stream-frame", 1, { chunk: new Uint8Array([1]) });`,
        ],
        [
          "mixed-terminal",
          `
            send(open, "stream-frame", 0, { chunk: new Uint8Array([1]) });
            send(open, "ssr-wire-result", 1, { html: "mixed" });
          `,
        ],
      ] as const
    ) {
      const worker = createSSRScriptedWorker(
        projectId,
        `if (message.type === "render-ssr") { ${behavior} }`,
      );
      worker.start();
      try {
        await assertWorkerReady(worker);
        const error = await new Response(
          worker.executeStream(makeScriptedSSRRequest(projectId)),
        ).arrayBuffer().then(
          () => undefined,
          (cause: unknown) => cause,
        );
        assert(error instanceof Error);
        assertEquals(worker.status, "crashed");
      } finally {
        worker.terminate();
      }
    }
  });

  it("retires the generation after a duplicate terminal", async () => {
    const worker = createSSRScriptedWorker(
      "test-stream-duplicate-terminal",
      `
        if (message.type === "render-ssr") {
          send(open, "stream-end", 0);
          send(open, "stream-end", 0);
        }
      `,
    );
    worker.start();
    try {
      await assertWorkerReady(worker);
      assertEquals(
        await new Response(
          worker.executeStream(makeScriptedSSRRequest("duplicate-terminal")),
        ).text(),
        "",
      );
      await waitForWorkerStatus(worker, "crashed");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });

  it("rejects stale output when a caller reuses an id with a fresh token", async () => {
    const worker = createSSRScriptedWorker(
      "test-stream-reused-id",
      `
        if (message.type === "render-ssr") {
          globalThis.renderCount = (globalThis.renderCount ?? 0) + 1;
          if (globalThis.renderCount === 1) {
            globalThis.firstOpen = open;
            send(open, "stream-end", 0);
          } else {
            send(globalThis.firstOpen, "stream-end", 0);
          }
        }
      `,
    );
    worker.start();
    try {
      await assertWorkerReady(worker);
      const id = "reused-id";
      assertEquals(
        await new Response(
          worker.executeStream(makeScriptedSSRRequest(id)),
        ).text(),
        "",
      );
      assertEquals(worker.status, "idle");

      const error = await new Response(
        worker.executeStream(makeScriptedSSRRequest(id)),
      ).arrayBuffer().then(
        () => undefined,
        (cause: unknown) => cause,
      );
      assert(error instanceof Error);
      assertEquals(worker.status, "crashed");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });

  it("maps an authenticated output limit once and returns to reusable idle state", async () => {
    const worker = createSSRScriptedWorker(
      "test-stream-output-limit",
      `
        if (message.type === "render-ssr") {
          send(open, "ssr-output-limit", 0, { limit: "chunks" });
        }
      `,
    );
    let idleNotifications = 0;
    worker.onIdle(() => idleNotifications++);
    worker.start();
    try {
      await assertWorkerReady(worker);
      const error = await new Response(
        worker.executeStream(makeScriptedSSRRequest("output-limit")),
      ).arrayBuffer().then(
        () => undefined,
        (cause: unknown) => cause,
      );
      assert(error instanceof Error);
      assertEquals(
        error.message,
        `Isolated SSR output exceeded ${MAX_WORKER_SSR_OUTPUT_CHUNKS} chunks`,
      );
      assertEquals(
        (error as Error & { slug?: string }).slug,
        "ssr-output-limit-exceeded",
      );
      assertEquals(idleNotifications, 1);
      assertEquals(worker.status, "idle");
      assertEquals(worker.hasPendingRequests, false);
      assertEquals(await worker.isHealthy(), true);
      assertEquals(idleNotifications, 1);
      worker.terminate();
      assertEquals(idleNotifications, 1);
    } finally {
      worker.terminate();
    }
  });

  it("reconstructs registered streaming errors with a sanitized stack", async () => {
    const serializedError = {
      name: "VeryfrontError",
      message: "project dependency overloaded",
      stack:
        "VeryfrontError: project dependency overloaded\n    at postgres://admin:secret@db.internal/query:1:1",
      problem: {
        slug: SERVICE_OVERLOADED.slug,
        category: SERVICE_OVERLOADED.category,
        status: 429,
        title: SERVICE_OVERLOADED.title,
        suggestion: SERVICE_OVERLOADED.suggestion,
        detail: "capacity exhausted",
      },
    };
    const worker = createSSRScriptedWorker(
      "test-stream-registered-error",
      `
        if (message.type === "render-ssr") {
          send(open, "ssr-wire-error", 0, {
            error: ${JSON.stringify(serializedError)},
          });
        }
      `,
    );
    worker.start();
    try {
      await assertWorkerReady(worker);
      const error = await new Response(
        worker.executeStream(makeScriptedSSRRequest("registered-error")),
      ).arrayBuffer().then(
        () => undefined,
        (cause: unknown) => cause,
      );

      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, SERVICE_OVERLOADED.slug);
      assertEquals(error.status, 429);
      assertEquals(error.detail, "capacity exhausted");
      assert(error.stack?.includes("postgres://admin:[REDACTED]@db.internal/query"));
      assertEquals(error.stack?.includes("secret"), false);
      assertEquals(worker.status, "idle");
      assertEquals(worker.hasPendingRequests, false);
    } finally {
      worker.terminate();
    }
  });

  it("uses one absolute deadline after receiving frames from an active producer", async () => {
    const worker = createSSRScriptedWorker(
      "test-stream-absolute-timeout",
      `
        if (message.type === "render-ssr") {
          send(open, "stream-frame", 0, { chunk: new Uint8Array([1]) });
          return;
        }
        if (message.type === "stream-credit") {
          setTimeout(() => {
            send(open, "stream-frame", message.sequence, {
              chunk: new Uint8Array([message.sequence & 255]),
            });
          }, 2);
        }
      `,
      250,
    );
    worker.start();
    try {
      await assertWorkerReady(worker);
      const reader = worker.executeStream(
        makeScriptedSSRRequest("absolute-timeout"),
      ).getReader();
      const first = await reader.read();
      assertEquals(first.done, false);
      assertEquals(first.value, new Uint8Array([1]));

      let received = 1;
      const error = await (async () => {
        try {
          while (!(await reader.read()).done) received++;
          return undefined;
        } catch (cause) {
          return cause;
        }
      })();
      assert(received > 1);
      assert(error instanceof Error);
      assertEquals(error.message, "Worker stream timed out after 250ms");
      assertEquals(
        (error as Error & { slug?: string }).slug,
        "timeout-error",
      );
      assertEquals(worker.status, "terminated");
      assertEquals(worker.hasPendingRequests, false);
      reader.releaseLock();
    } finally {
      worker.terminate();
    }
  });
});
