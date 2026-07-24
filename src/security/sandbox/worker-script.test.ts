import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "node:path";
import { API_ROUTE_ERROR } from "#veryfront/errors";
import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "#veryfront/errors/safe-diagnostics.ts";
import {
  MAX_WORKER_MODULE_SOURCE_BYTES,
  MAX_WORKER_RETAINED_MODULE_SOURCE_BYTES,
  type PreparedWorkerModule,
} from "./worker-types.ts";
import {
  getPreparedModuleRetentionStats,
  loadModule,
  loadPreparedModule,
  makeProjectPathGuard,
  serializeError,
  snapshotWorkerRequest,
} from "./worker-script.ts";

const TEST_SOURCE_INTEGRATION_POLICY = {
  schemaVersion: 1,
  mode: "unrestricted",
} as const;

async function prepareWorkerModule(
  source: string,
): Promise<PreparedWorkerModule> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return {
    source,
    sha256: new Uint8Array(digest).toHex(),
  };
}

function waitForPortMessage(
  port: MessagePort,
  predicate: (message: unknown) => boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      port.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for worker control message"));
    }, 5_000);
    const onMessage = (event: MessageEvent) => {
      if (!predicate(event.data)) return;
      clearTimeout(timeout);
      port.removeEventListener("message", onMessage);
      resolve(event.data);
    };
    port.addEventListener("message", onMessage);
  });
}

function hasMessageIdentity(message: unknown, id: string): boolean {
  return typeof message === "object" &&
    message !== null &&
    (message as { id?: unknown }).id === id;
}

describe("worker-script makeProjectPathGuard", () => {
  it("allows a real file inside the project", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const filePath = join(projectDir, "data.json");
      await Deno.writeTextFile(filePath, "{}");
      const guard = makeProjectPathGuard(projectDir);
      const resolved = await guard("data.json");
      assertEquals(resolved, await Deno.realPath(filePath));
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("allows the canonical project root itself", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const guard = makeProjectPathGuard(projectDir);
      assertEquals(await guard("."), await Deno.realPath(projectDir));
      assertEquals(
        await guard(projectDir),
        await Deno.realPath(projectDir),
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects plain ../ traversal", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const guard = makeProjectPathGuard(projectDir);
      await assertRejects(() => guard("../../etc/passwd"), Error, "escapes project directory");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects a symlink inside the project that points outside it", async () => {
    const projectDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    try {
      const secret = join(outsideDir, "secret.txt");
      await Deno.writeTextFile(secret, "leaked-by-symlink");
      // A symlink that lives inside the project but resolves outside it.
      await Deno.symlink(secret, join(projectDir, "link.txt"));

      const guard = makeProjectPathGuard(projectDir);
      await assertRejects(() => guard("link.txt"), Error, "escapes project directory");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("allows a not-yet-existing path that is lexically contained", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const guard = makeProjectPathGuard(projectDir);
      const resolved = await guard("nested/new-file.txt");
      // The target doesn't exist so it can't be canonicalized; it is still
      // accepted (lexically contained) and points at the nested path.
      assert(resolved.endsWith(join("nested", "new-file.txt")));
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("worker-script serializeError", () => {
  it("serializes a standard Error preserving message, name, and stack", () => {
    const err = new Error("boom");
    const serialized = serializeError(err);

    assertEquals(serialized.message, "boom");
    assertEquals(serialized.name, "Error");
    assertExists(serialized.stack);
    // No RFC 9457 fields on a plain Error
    assertEquals(serialized.type, undefined);
    assertEquals(serialized.status, undefined);
    assertEquals(serialized.detail, undefined);
  });

  it("preserves the subclass name for custom Error types", () => {
    class TypeErrorish extends Error {
      override name = "TypeErrorish";
    }
    const serialized = serializeError(new TypeErrorish("bad type"));
    assertEquals(serialized.name, "TypeErrorish");
    assertEquals(serialized.message, "bad type");
  });

  it("does not trust RFC 9457 fields attached to a plain project error", () => {
    const err = Object.assign(new Error("not found"), {
      type: "https://veryfront.dev/errors/not-found",
      status: 404,
      detail: "Resource was not located",
    });
    const serialized = serializeError(err);

    assertEquals(serialized.message, "not found");
    assertEquals(serialized.problem?.slug, "unknown-error");
    assertEquals(serialized.problem?.status, 500);
    assertEquals(serialized.problem?.detail, "not found");
  });

  it("preserves a detached registered problem snapshot", () => {
    const serialized = serializeError(API_ROUTE_ERROR.create({
      message: "route failed",
      detail: "private route detail",
    }));

    assertEquals(serialized.message, "route failed");
    assertEquals(serialized.problem, {
      slug: "api-route-error",
      category: "ROUTE",
      status: 500,
      title: "API route definition error",
      suggestion: "Review API route configuration",
      detail: "private route detail",
      cause: undefined,
      instance: undefined,
    });
    assertExists(serialized.stack);
  });

  it("fails closed without invoking traps on an Error proxy", () => {
    let trapCalls = 0;
    const hostile = new Proxy(new Error("must not escape"), {
      get() {
        trapCalls++;
        throw new Error("hostile getter");
      },
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        trapCalls++;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        trapCalls++;
        return Reflect.ownKeys(target);
      },
    });

    const serialized = serializeError(hostile);

    assertEquals(trapCalls, 0);
    assertEquals(serialized.message, "Unknown error");
    assertEquals(serialized.problem?.slug, "unknown-error");
    assertEquals(serialized.problem?.status, 500);
    assertEquals(serialized.problem?.detail, "Unknown error");
  });

  it("serializes a non-Error value via String() with name 'Error'", () => {
    const serialized = serializeError("just a string");
    assertEquals(serialized.message, "just a string");
    assertEquals(serialized.name, "Error");
    assertEquals(serialized.stack, undefined);

    const numSerialized = serializeError(42);
    assertEquals(numSerialized.message, "42");
    assertEquals(numSerialized.name, "Error");

    const nullSerialized = serializeError(null);
    assertEquals(nullSerialized.message, "null");
  });

  it("does not invoke project conversion hooks on thrown objects", () => {
    let conversionCount = 0;
    const hostile = {
      [Symbol.toPrimitive]() {
        conversionCount++;
        throw new Error("project conversion hook ran");
      },
      toString() {
        conversionCount++;
        throw new Error("project toString hook ran");
      },
    };

    const serialized = serializeError(hostile);

    assertEquals(conversionCount, 0);
    assertEquals(serialized.message, "Unknown error");
    assertEquals(serialized.problem?.slug, "unknown-error");
  });

  it("serializes the top-level Error even when it has a nested cause", () => {
    const root = new Error("root cause");
    const wrapper = new Error("wrapper failure", { cause: root });
    const serialized = serializeError(wrapper);

    // Only the top-level error is serialized into the transport shape.
    assertEquals(serialized.message, "wrapper failure");
    assertEquals(serialized.name, "Error");
    // The serialized shape does not carry a `cause` field.
    assertEquals((serialized as unknown as Record<string, unknown>).cause, undefined);
  });

  it("bounds worker-owned diagnostic fields before transport", () => {
    const oversized = "x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS * 4);
    const error = new Error(oversized);
    error.name = oversized;

    const serialized = serializeError(error);

    assert(serialized.message.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assert(serialized.name.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assert(
      (serialized.problem?.detail?.length ?? 0) <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
    );
  });
});

describe("worker-script request snapshots", () => {
  it("deeply detaches a prepared API request before it is queued", () => {
    const original = {
      type: "execute-app-route",
      id: "snapshot-app",
      module: {
        source: "export function GET() {}",
        sha256: "a".repeat(64),
      },
      modulePath: "/project/app/api/route.ts",
      method: "GET",
      request: {
        url: "http://localhost/api/test",
        method: "GET",
        headers: [["x-test", "before"]],
        body: new Uint8Array([1, 2, 3]),
      },
      params: { slug: ["before"] },
      projectDir: "/project",
      sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      projectEnv: { TENANT_VALUE: "before" },
    };

    const snapshot = snapshotWorkerRequest(original);
    original.module.source = "export function POST() {}";
    original.request.headers[0]![1] = "after";
    original.request.body[0] = 9;
    original.params.slug[0] = "after";
    original.projectEnv.TENANT_VALUE = "after";

    assertEquals(snapshot.type, "execute-app-route");
    if (snapshot.type !== "execute-app-route") {
      throw new Error("expected app route snapshot");
    }
    assertEquals(snapshot.module.source, "export function GET() {}");
    assertEquals(snapshot.request.headers, [["x-test", "before"]]);
    assertEquals(snapshot.request.body, new Uint8Array([1, 2, 3]));
    assertEquals(snapshot.params, { slug: ["before"] });
    assertEquals(snapshot.projectEnv, { TENANT_VALUE: "before" });
  });

  it("requires a non-empty logical module identity", () => {
    const request = {
      type: "inspect-api-route-methods",
      id: "missing-logical-id",
      module: {
        source: "export function GET() {}",
        sha256: "a".repeat(64),
      },
      projectDir: "/project",
      sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    };

    assertThrows(
      () => snapshotWorkerRequest(request),
      TypeError,
      "Invalid worker request payload",
    );
  });

  it("uses stable typed protocol errors for invalid request contracts", () => {
    const unknownTypeError = assertThrows(
      () =>
        snapshotWorkerRequest({
          type: "unknown-request",
          id: "unknown",
        }),
      TypeError,
      "Invalid worker request type",
    );
    assertEquals(serializeError(unknownTypeError).name, "TypeError");

    const missingPolicyError = assertThrows(
      () =>
        snapshotWorkerRequest({
          type: "inspect-api-route-methods",
          id: "missing-policy",
          module: {
            source: "export function GET() {}",
            sha256: "a".repeat(64),
          },
          modulePath: "/project/app/api/route.ts",
          projectDir: "/project",
        }),
      TypeError,
      "Invalid source integration policy manifest",
    );
    const serialized = serializeError(missingPolicyError);
    assertEquals(serialized.name, "TypeError");
    assertEquals(
      serialized.message,
      "Invalid source integration policy manifest",
    );
  });

  it("rejects oversized aggregate header and parameter collections", () => {
    const request = {
      type: "execute-app-route",
      id: "aggregate-input-bounds",
      module: {
        source: "export function GET() {}",
        sha256: "a".repeat(64),
      },
      modulePath: "/project/app/api/route.ts",
      method: "GET",
      request: {
        url: "http://localhost/api/test",
        method: "GET",
        headers: Array.from(
          { length: 17 },
          (_, index) => [`x-${index}`, "v".repeat(64 * 1024)],
        ),
        body: null,
      },
      params: {},
      projectDir: "/project",
      sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    };

    assertThrows(
      () => snapshotWorkerRequest(request),
      TypeError,
      "Invalid worker request headers",
    );

    request.request.headers = [];
    request.params = Object.fromEntries(
      Array.from(
        { length: 5 },
        (_, index) => [`param-${index}`, Array<string>(4_096).fill("")],
      ),
    );
    assertThrows(
      () => snapshotWorkerRequest(request),
      TypeError,
      "Invalid worker request params",
    );
  });

  it("bounds source-policy segment sizes before canonicalization", () => {
    assertThrows(
      () =>
        snapshotWorkerRequest({
          type: "inspect-api-route-methods",
          id: "policy-bounds",
          module: {
            source: "export function GET() {}",
            sha256: "a".repeat(64),
          },
          modulePath: "/project/app/api/route.ts",
          projectDir: "/project",
          sourceIntegrationPolicy: {
            schemaVersion: 1,
            mode: "allowlist",
            integrations: {
              github: {
                allowedToolIds: ["x".repeat(257)],
              },
            },
          },
        }),
      TypeError,
      "Invalid source integration policy manifest",
    );
  });

  it("preserves the legacy fetch-data protocol through strict snapshotting", () => {
    const snapshot = snapshotWorkerRequest({
      type: "fetch-data",
      id: "fetch-data",
      modulePath: "/project/page.ts",
      context: {
        params: { slug: "one" },
        query: "page=2",
        request: {
          url: "http://localhost/page?page=2",
          method: "GET",
          headers: [],
          body: null,
        },
        url: "http://localhost/page?page=2",
      },
      sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    });

    assertEquals(snapshot.type, "fetch-data");
    if (snapshot.type !== "fetch-data") {
      throw new Error("expected fetch-data snapshot");
    }
    assertEquals(snapshot.context.params, { slug: "one" });
    assertEquals(snapshot.context.query, "page=2");
  });

  it("preserves the legacy render-ssr protocol through strict snapshotting", () => {
    const snapshot = snapshotWorkerRequest({
      type: "render-ssr",
      id: "render-ssr",
      pageModulePath: "/project/page.mjs",
      layoutModulePaths: ["/project/layout.mjs"],
      pageProps: { title: "safe", nested: { count: 1 } },
      layoutProps: [{ theme: "dark" }],
      delivery: "string",
      sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    });

    assertEquals(snapshot.type, "render-ssr");
    if (snapshot.type !== "render-ssr") {
      throw new Error("expected render-ssr snapshot");
    }
    assertEquals(snapshot.pageProps, {
      title: "safe",
      nested: { count: 1 },
    });
    assertEquals(snapshot.layoutProps, [{ theme: "dark" }]);
  });
});

describe("worker-script loadModule", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    for (const f of tempFiles.splice(0)) {
      try {
        await Deno.remove(f);
      } catch {
        // ignore
      }
    }
  });

  it("imports a module from an absolute path and exposes its exports", async () => {
    const path = await Deno.makeTempFile({ suffix: ".mjs" });
    tempFiles.push(path);
    await Deno.writeTextFile(
      path,
      "export const value = 7;\nexport function GET() { return 'ok'; }\nexport default 'def';\n",
    );

    const mod = await loadModule(path);
    assertEquals(mod.value, 7);
    assertEquals(typeof mod.GET, "function");
    assertEquals((mod.GET as () => string)(), "ok");
    assertEquals(mod.default, "def");
  });

  it("caches the module so repeated loads return the same object", async () => {
    const path = await Deno.makeTempFile({ suffix: ".mjs" });
    tempFiles.push(path);
    await Deno.writeTextFile(path, "export const n = 1;\n");

    const first = await loadModule(path);
    const second = await loadModule(path);
    assert(first === second, "cached module should be referentially identical");
  });

  it("rejects when the module path does not exist", async () => {
    const missing = `${await Deno.makeTempDir()}/does-not-exist-${crypto.randomUUID()}.mjs`;
    await assertRejects(() => loadModule(missing));
  });

  it("rejects when the module has invalid syntax", async () => {
    const path = await Deno.makeTempFile({ suffix: ".mjs" });
    tempFiles.push(path);
    await Deno.writeTextFile(path, "export const = ;;; this is not valid js");

    await assertRejects(() => loadModule(path));
  });
});

describe("worker-script prepared modules", () => {
  it("rejects non-lowercase and mismatched SHA-256 identities", async () => {
    const source = "export function GET() {}";
    const prepared = await prepareWorkerModule(source);

    await assertRejects(
      () =>
        loadPreparedModule(
          { source, sha256: prepared.sha256.toUpperCase() },
          { logicalModuleId: "/routes/uppercase.ts" },
        ),
      TypeError,
      "Invalid worker request module",
    );
    await assertRejects(
      () =>
        loadPreparedModule(
          { source, sha256: "0".repeat(64) },
          { logicalModuleId: "/routes/mismatch.ts" },
        ),
      TypeError,
      "digest mismatch",
    );
  });

  it("enforces the prepared source limit in UTF-8 bytes", async () => {
    const oversizedSource = "é".repeat(
      Math.floor(MAX_WORKER_MODULE_SOURCE_BYTES / 2) + 1,
    );

    await assertRejects(
      () =>
        loadPreparedModule(
          { source: oversizedSource, sha256: "0".repeat(64) },
          { logicalModuleId: "/routes/oversized.ts" },
        ),
      TypeError,
      "Invalid worker request module",
    );
  });

  it("rejects modules without a canonical callable route export", async () => {
    const prepared = await prepareWorkerModule(
      "export const GET = 1; export function helper() {}",
    );

    await assertRejects(
      () =>
        loadPreparedModule(prepared, {
          logicalModuleId: "/routes/no-handler.ts",
        }),
      Error,
      "Prepared API route module import failed",
    );
  });

  it("accepts callable default and uppercase custom route exports", async () => {
    const prepared = await prepareWorkerModule(`
      export function PROPFIND() {}
      export default function route() {}
    `);
    const module = await loadPreparedModule(prepared, {
      logicalModuleId: "/routes/custom.ts",
    });

    assertEquals(typeof module.PROPFIND, "function");
    assertEquals(typeof module.default, "function");
  });

  it("caches by logical route and digest while keeping routes distinct", async () => {
    const counterKey = `__vf_prepared_counter_${crypto.randomUUID().replaceAll("-", "_")}`;
    const source = `
      globalThis[${JSON.stringify(counterKey)}] =
        (globalThis[${JSON.stringify(counterKey)}] ?? 0) + 1;
      export const evaluationCount = globalThis[${JSON.stringify(counterKey)}];
      export function GET() {}
    `;
    const prepared = await prepareWorkerModule(source);

    try {
      const first = await loadPreparedModule(prepared, {
        logicalModuleId: "/routes/one.ts",
      });
      const cached = await loadPreparedModule(prepared, {
        logicalModuleId: "/routes/one.ts",
      });
      const distinctRoute = await loadPreparedModule(prepared, {
        logicalModuleId: "/routes/two.ts",
      });

      assert(first === cached);
      assert(first !== distinctRoute);
      assertEquals(first.evaluationCount, 1);
      assertEquals(distinctRoute.evaluationCount, 2);
    } finally {
      delete (globalThis as Record<string, unknown>)[counterKey];
    }
  });

  it("includes env and source-policy semantics in module identity", async () => {
    const counterKey = `__vf_semantic_counter_${crypto.randomUUID().replaceAll("-", "_")}`;
    const source = `
      globalThis[${JSON.stringify(counterKey)}] =
        (globalThis[${JSON.stringify(counterKey)}] ?? 0) + 1;
      export const evaluationCount = globalThis[${JSON.stringify(counterKey)}];
      export function GET() {}
    `;
    const prepared = await prepareWorkerModule(source);

    try {
      const tenantA = await loadPreparedModule(prepared, {
        logicalModuleId: "/routes/semantic.ts",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        projectEnv: { TENANT: "a" },
      });
      const tenantB = await loadPreparedModule(prepared, {
        logicalModuleId: "/routes/semantic.ts",
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        projectEnv: { TENANT: "b" },
      });

      assert(tenantA !== tenantB);
      assertEquals(tenantA.evaluationCount, 1);
      assertEquals(tenantB.evaluationCount, 2);
    } finally {
      delete (globalThis as Record<string, unknown>)[counterKey];
    }
  });

  it("redacts encoded source from data-module stacks", async () => {
    const sentinel = "VF_SENTINEL_SOURCE_MUST_NOT_LEAK_7f3b";
    const prepared = await prepareWorkerModule(`
      export function GET( { /* ${sentinel} */
    `);
    const error = await assertRejects(
      () =>
        loadPreparedModule(prepared, {
          logicalModuleId: "/routes/private-source.ts",
        }),
      Error,
      "Prepared API route module import failed",
    );
    const serialized = serializeError(error, prepared.sha256);
    const serializedText = JSON.stringify(serialized);

    assertExists(serialized.stack);
    assert(!serializedText.includes("data:text/javascript"));
    assert(!serializedText.includes(sentinel));
    assert(
      serializedText.includes(`vf-api:${prepared.sha256}:`),
      serializedText,
    );
  });

  it("keeps requests and responses on the private control port after project poisoning", async () => {
    const projectDir = await Deno.makeTempDir();
    const envKey = `VF_WORKER_PRIVATE_${crypto.randomUUID().replaceAll("-", "_")}`;
    const observedKey = `__vf_observed_${crypto.randomUUID().replaceAll("-", "_")}`;
    const safeEnvGetterKey = `__vf_env_get_${crypto.randomUUID().replaceAll("-", "_")}`;
    const workerOptions = {
      type: "module",
      deno: {
        permissions: {
          read: true,
          write: false,
          net: false,
          env: [envKey],
          run: false,
          ffi: false,
          sys: false,
        },
      },
    } as WorkerOptions & {
      deno: {
        permissions: {
          read: boolean;
          write: boolean;
          net: boolean;
          env: string[];
          run: boolean;
          ffi: boolean;
          sys: boolean;
        };
      };
    };
    const worker = new Worker(
      import.meta.resolve("./worker-script.ts"),
      workerOptions,
    );
    const channel = new MessageChannel();
    channel.port1.start();

    try {
      worker.postMessage(
        {
          type: "initialize-egress",
          options: { allowInternalEgress: false },
          controlPort: channel.port2,
        },
        [channel.port2],
      );

      const pong = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "ready"),
      );
      channel.port1.postMessage({ type: "ping", id: "ready" });
      assertEquals(
        (await pong as { type: string }).type,
        "pong",
      );

      const poisonSource = `
        const safeEnvGet = Deno.env.get.bind(Deno.env);
        globalThis[${JSON.stringify(safeEnvGetterKey)}] = safeEnvGet;
        globalThis[${JSON.stringify(observedKey)}] = 0;
        self.addEventListener("message", () => {
          globalThis[${JSON.stringify(observedKey)}]++;
        });
        self.postMessage = () => {
          throw new Error("global response bus was used");
        };
        Object.entries = () => {
          throw new Error("poisoned Object.entries was used");
        };
        Map.prototype.get = () => {
          throw new Error("poisoned Map.get was used");
        };
        Map.prototype.set = () => {
          throw new Error("poisoned Map.set was used");
        };
        Deno.env.get = () => {
          throw new Error("poisoned Deno.env.get was used");
        };
        export async function GET() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return Response.json({
            observed: globalThis[${JSON.stringify(observedKey)}],
            env: safeEnvGet(${JSON.stringify(envKey)}),
          });
        }
      `;
      const poisonModule = await prepareWorkerModule(poisonSource);
      const firstResponse = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "poison"),
      );
      channel.port1.postMessage({
        type: "execute-app-route",
        id: "poison",
        module: poisonModule,
        modulePath: `${projectDir}/poison.ts`,
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
        projectEnv: { [envKey]: "first-tenant-secret" },
      });
      const first = await firstResponse as {
        type: string;
        response?: { body: Uint8Array | null };
      };
      assertEquals(first.type, "result");
      assertExists(first.response?.body);
      assertEquals(
        JSON.parse(new TextDecoder().decode(first.response.body)),
        { observed: 0, env: "first-tenant-secret" },
      );

      const healthySource = `
        export function GET() {
          const safeEnvGet = globalThis[${JSON.stringify(safeEnvGetterKey)}];
          return Response.json({
            observed: globalThis[${JSON.stringify(observedKey)}],
            envWasScrubbed: safeEnvGet(${JSON.stringify(envKey)}) === undefined,
          });
        }
      `;
      const healthyModule = await prepareWorkerModule(healthySource);
      const secondResponse = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "healthy"),
      );
      channel.port1.postMessage({
        type: "execute-app-route",
        id: "healthy",
        module: healthyModule,
        modulePath: `${projectDir}/healthy.ts`,
        method: "GET",
        request: {
          url: "http://localhost/api/healthy",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      const second = await secondResponse as {
        type: string;
        response?: { body: Uint8Array | null };
      };
      assertEquals(second.type, "result");
      assertExists(second.response?.body);
      assertEquals(
        JSON.parse(new TextDecoder().decode(second.response.body)),
        { observed: 0, envWasScrubbed: true },
      );
    } finally {
      worker.terminate();
      channel.port1.close();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps a restrictive policy deeply frozen after prior primordial poisoning", async () => {
    const projectDir = await Deno.makeTempDir();
    const worker = new Worker(
      import.meta.resolve("./worker-script.ts"),
      {
        type: "module",
        deno: {
          permissions: {
            read: true,
            write: false,
            net: false,
            env: false,
            run: false,
            ffi: false,
            sys: false,
          },
        },
      } as WorkerOptions & {
        deno: {
          permissions: {
            read: boolean;
            write: boolean;
            net: boolean;
            env: boolean;
            run: boolean;
            ffi: boolean;
            sys: boolean;
          };
        };
      },
    );
    const channel = new MessageChannel();
    channel.port1.start();

    try {
      worker.postMessage(
        {
          type: "initialize-egress",
          options: { allowInternalEgress: false },
          controlPort: channel.port2,
        },
        [channel.port2],
      );
      const pong = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "policy-ready"),
      );
      channel.port1.postMessage({ type: "ping", id: "policy-ready" });
      await pong;

      const poisonModule = await prepareWorkerModule(`
        export function GET() {
          Object.freeze = () => {
            throw new Error("poisoned Object.freeze was used");
          };
          Object.create = () => {
            throw new Error("poisoned Object.create was used");
          };
          Array.prototype.sort = () => {
            throw new Error("poisoned Array.prototype.sort was used");
          };
          return new Response("poisoned");
        }
      `);
      const poisonResponse = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "poison-policy-primordials"),
      );
      channel.port1.postMessage({
        type: "execute-app-route",
        id: "poison-policy-primordials",
        module: poisonModule,
        modulePath: `${projectDir}/poison-policy.ts`,
        method: "GET",
        request: {
          url: "http://localhost/api/poison-policy",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });
      assertEquals(
        (await poisonResponse as { type: string }).type,
        "result",
      );

      const sourcePolicyContextUrl = import.meta.resolve(
        "../../integrations/source-policy-context.ts",
      );
      const sourcePolicyUrl = import.meta.resolve(
        "../../integrations/source-policy.ts",
      );
      const mutationModule = await prepareWorkerModule(`
        import {
          getActiveSourceIntegrationPolicy,
        } from ${JSON.stringify(sourcePolicyContextUrl)};
        import {
          isIntegrationToolAllowedBySourcePolicy,
        } from ${JSON.stringify(sourcePolicyUrl)};

        export function GET() {
          const policy = getActiveSourceIntegrationPolicy();
          const integrations = policy.integrations;
          const restriction = integrations.github;
          const toolIds = restriction.allowedToolIds;

          const mutations = {
            root: Reflect.set(policy, "mode", "unrestricted"),
            integrations: Reflect.set(integrations, "slack", {
              allowedToolIds: null,
            }),
            restriction: Reflect.set(restriction, "allowedToolIds", null),
            toolArray: Reflect.set(toolIds, "0", "delete_repo"),
          };

          return Response.json({
            mutations,
            frozen: {
              root: Object.isFrozen(policy),
              integrations: Object.isFrozen(integrations),
              restriction: Object.isFrozen(restriction),
              toolArray: Object.isFrozen(toolIds),
            },
            mode: policy.mode,
            deleteAllowed: isIntegrationToolAllowedBySourcePolicy(
              "github__delete_repo",
              policy,
            ),
            listAllowed: isIntegrationToolAllowedBySourcePolicy(
              "github__list_repos",
              policy,
            ),
          });
        }
      `);
      const mutationResponse = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "mutate-policy"),
      );
      channel.port1.postMessage({
        type: "execute-app-route",
        id: "mutate-policy",
        module: mutationModule,
        modulePath: `${projectDir}/mutate-policy.ts`,
        method: "GET",
        request: {
          url: "http://localhost/api/mutate-policy",
          method: "GET",
          headers: [],
          body: null,
        },
        params: {},
        projectDir,
        sourceIntegrationPolicy: {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: {
            github: {
              allowedToolIds: ["list_repos"],
            },
          },
        },
      });

      const response = await mutationResponse as {
        type: string;
        response?: { body: Uint8Array | null };
      };
      assertEquals(response.type, "result");
      assertExists(response.response?.body);
      assertEquals(
        JSON.parse(new TextDecoder().decode(response.response.body)),
        {
          mutations: {
            root: false,
            integrations: false,
            restriction: false,
            toolArray: false,
          },
          frozen: {
            root: true,
            integrations: true,
            restriction: true,
            toolArray: true,
          },
          mode: "allowlist",
          deleteAllowed: false,
          listAllowed: true,
        },
      );
    } finally {
      worker.terminate();
      channel.port1.close();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps Pages filesystem guards fail-closed after project primordial poisoning", async () => {
    const projectDir = await Deno.makeTempDir();
    const worker = new Worker(
      import.meta.resolve("./worker-script.ts"),
      {
        type: "module",
        deno: {
          permissions: {
            read: true,
            write: false,
            net: false,
            env: false,
            run: false,
            ffi: false,
            sys: false,
          },
        },
      } as WorkerOptions & {
        deno: {
          permissions: {
            read: boolean;
            write: boolean;
            net: boolean;
            env: boolean;
            run: boolean;
            ffi: boolean;
            sys: boolean;
          };
        };
      },
    );
    const channel = new MessageChannel();
    channel.port1.start();

    try {
      worker.postMessage(
        {
          type: "initialize-egress",
          options: { allowInternalEgress: false },
          controlPort: channel.port2,
        },
        [channel.port2],
      );
      const pong = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "ready-fs-poison"),
      );
      channel.port1.postMessage({ type: "ping", id: "ready-fs-poison" });
      await pong;

      const prepared = await prepareWorkerModule(`
        Object.defineProperty(Deno.errors.NotFound, Symbol.hasInstance, {
          configurable: true,
          value() {
            throw new Error("poisoned NotFound Symbol.hasInstance was used");
          },
        });
        String.prototype.startsWith = () => {
          throw new Error("poisoned String.prototype.startsWith was used");
        };
        Promise.prototype.catch = () => {
          throw new Error("poisoned Promise.prototype.catch was used");
        };

        export async function GET(ctx) {
          const missing = await ctx.fs.exists("missing.txt");

          let traversalError = "";
          try {
            await ctx.fs.exists("../outside.txt");
          } catch (error) {
            traversalError = error instanceof Error ? error.message : "non-error";
          }

          let invalidPathError = "";
          try {
            await ctx.fs.exists(String.fromCharCode(0));
          } catch (error) {
            invalidPathError = error instanceof Error ? error.message : "non-error";
          }

          return Response.json({
            missing,
            traversalError,
            invalidPathError,
          });
        }
      `);
      const responseMessage = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "fs-poison"),
      );
      channel.port1.postMessage({
        type: "execute-pages-route",
        id: "fs-poison",
        module: prepared,
        modulePath: `${projectDir}/fs-poison.ts`,
        method: "GET",
        context: {
          url: "http://localhost/api/fs-poison",
          method: "GET",
          headers: [],
          body: null,
          params: {},
          cookies: {},
        },
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      const response = await responseMessage as {
        type: string;
        response?: { body: Uint8Array | null };
      };
      assertEquals(response.type, "result");
      assertExists(response.response?.body);
      const body = JSON.parse(
        new TextDecoder().decode(response.response.body),
      ) as {
        missing: boolean;
        traversalError: string;
        invalidPathError: string;
      };
      assertEquals(body.missing, false);
      assert(body.traversalError.includes("Path escapes project directory"));
      assert(body.invalidPathError.length > 0);
      assert(!body.invalidPathError.includes("poisoned"));
    } finally {
      worker.terminate();
      channel.port1.close();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("reports prepared import failures and then retires the worker", async () => {
    const projectDir = await Deno.makeTempDir();
    const worker = new Worker(
      import.meta.resolve("./worker-script.ts"),
      {
        type: "module",
        deno: {
          permissions: {
            read: true,
            write: false,
            net: false,
            env: false,
            run: false,
            ffi: false,
            sys: false,
          },
        },
      } as WorkerOptions & {
        deno: {
          permissions: {
            read: boolean;
            write: boolean;
            net: boolean;
            env: boolean;
            run: boolean;
            ffi: boolean;
            sys: boolean;
          };
        };
      },
    );
    const channel = new MessageChannel();
    channel.port1.start();

    try {
      worker.postMessage(
        {
          type: "initialize-egress",
          options: { allowInternalEgress: false },
          controlPort: channel.port2,
        },
        [channel.port2],
      );
      const pong = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "ready-failure"),
      );
      channel.port1.postMessage({
        type: "ping",
        id: "ready-failure",
      });
      await pong;

      const sentinel = "VF_FATAL_IMPORT_SENTINEL_92ac";
      const prepared = await prepareWorkerModule(
        `export function GET( { /* ${sentinel} */`,
      );
      const errorMessage = waitForPortMessage(
        channel.port1,
        (message) => hasMessageIdentity(message, "fatal-import"),
      );
      const exitMessage = waitForPortMessage(
        channel.port1,
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === "worker-exit",
      );
      channel.port1.postMessage({
        type: "inspect-api-route-methods",
        id: "fatal-import",
        module: prepared,
        modulePath: `${projectDir}/fatal.ts`,
        projectDir,
        sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
      });

      const response = await errorMessage as {
        type: string;
        error?: unknown;
      };
      assertEquals(response.type, "error");
      const serialized = JSON.stringify(response.error);
      assert(!serialized.includes("data:text/javascript"));
      assert(!serialized.includes(sentinel));
      assert(serialized.includes(`vf-api:${prepared.sha256}:`));
      assertEquals(
        (await exitMessage as { type: string }).type,
        "worker-exit",
      );
    } finally {
      worker.terminate();
      channel.port1.close();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects before import when aggregate retained source reaches its cap", async () => {
    const before = getPreparedModuleRetentionStats();
    let remaining = MAX_WORKER_RETAINED_MODULE_SOURCE_BYTES -
      before.sourceBytes;
    const prefix = "export function GET() {}\n/*";
    const suffix = "*/";
    const minimumSourceBytes = prefix.length + suffix.length;
    let moduleIndex = 0;

    while (remaining >= minimumSourceBytes) {
      const sourceBytes = Math.min(
        MAX_WORKER_MODULE_SOURCE_BYTES,
        remaining,
      );
      const source = prefix +
        "x".repeat(sourceBytes - minimumSourceBytes) +
        suffix;
      await loadPreparedModule(await prepareWorkerModule(source), {
        logicalModuleId: `/routes/capacity-${moduleIndex++}.ts`,
      });
      remaining -= sourceBytes;
    }

    const extra = await prepareWorkerModule("export function GET() {}");
    await assertRejects(
      () =>
        loadPreparedModule(extra, {
          logicalModuleId: "/routes/over-capacity.ts",
        }),
      Error,
      "retention capacity exceeded",
    );
    assertEquals(
      getPreparedModuleRetentionStats().sourceBytes,
      MAX_WORKER_RETAINED_MODULE_SOURCE_BYTES - remaining,
    );
  });
});
