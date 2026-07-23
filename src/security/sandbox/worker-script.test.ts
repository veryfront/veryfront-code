import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "node:path";
import {
  clearModuleCache,
  handleExecuteProjectRun,
  handleGenerateOpenAPI,
  loadModule,
  makeProjectPathGuard,
  resolveWorkerRouteMethod,
  serializeError,
  serializeResponse,
  withProjectEnv,
} from "./worker-script.ts";
import { MAX_WORKER_RESPONSE_BODY_BYTES } from "./worker-types.ts";
import { snapshotProjectRunWorkerResult } from "./project-run-worker-contract.ts";
import { API_ERROR } from "#veryfront/errors";

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
  it("serializes a standard Error without exposing its stack", () => {
    const err = new Error("boom");
    const serialized = serializeError(err);

    assertEquals(serialized.message, "boom");
    assertEquals(serialized.name, "Error");
    assertEquals(serialized.stack, undefined);
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

  it("preserves RFC 9457 fields from VFError-like errors", () => {
    const err = Object.assign(new Error("not found"), {
      type: "https://veryfront.dev/errors/not-found",
      status: 404,
      detail: "Resource was not located",
    });
    const serialized = serializeError(err);

    assertEquals(serialized.message, "not found");
    assertEquals(serialized.type, "https://veryfront.dev/errors/not-found");
    assertEquals(serialized.status, 404);
    assertEquals(serialized.detail, "Resource was not located");
  });

  it("preserves the stable slug and status of a VeryfrontError", () => {
    const serialized = serializeError(
      API_ERROR.create({ detail: "Sensitive provider failure" }),
    );

    assertEquals(serialized.slug, "api-error");
    assertEquals(serialized.status, 500);
    assertEquals(serialized.detail, "Sensitive provider failure");
  });

  it("ignores RFC 9457 fields of the wrong type", () => {
    const err = Object.assign(new Error("oops"), {
      type: 123, // not a string
      status: "500", // not a number
      detail: { nested: true }, // not a string
    });
    const serialized = serializeError(err);

    assertEquals(serialized.type, undefined);
    assertEquals(serialized.status, undefined);
    assertEquals(serialized.detail, undefined);
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

  it("fails safely when a thrown value cannot be stringified", () => {
    const hostile = {
      toString: () => {
        throw new Error("string conversion failed");
      },
    };

    assertEquals(serializeError(hostile), {
      message: "Unknown worker error",
      name: "Error",
    });
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
});

describe("worker-script serializeResponse", () => {
  it("serializes a bounded response body", async () => {
    const serialized = await serializeResponse(
      new Response("ok", { status: 201, headers: { "x-test": "yes" } }),
    );

    assertEquals(serialized.status, 201);
    assertEquals(
      serialized.headers.some(([name, value]) => name === "x-test" && value === "yes"),
      true,
    );
    assertEquals(new TextDecoder().decode(serialized.body ?? undefined), "ok");
  });

  it("cancels a response whose declared body exceeds the transfer limit", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-length": String(MAX_WORKER_RESPONSE_BODY_BYTES + 1) } },
    );

    await assertRejects(() => serializeResponse(response), RangeError, "transfer limit");
    assertEquals(cancelled, true);
  });

  it("cancels an undeclared streaming body once it exceeds the transfer limit", async () => {
    let chunks = 0;
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
          chunks++;
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await assertRejects(() => serializeResponse(response), RangeError, "transfer limit");
    assertEquals(chunks, MAX_WORKER_RESPONSE_BODY_BYTES / (1024 * 1024) + 1);
    assertEquals(cancelled, true);
  });
});

describe("worker-script loadModule", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    clearModuleCache();
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

  it("imports paths containing URL-significant characters", async () => {
    const path = await Deno.makeTempFile({ prefix: "module#%", suffix: ".mjs" });
    tempFiles.push(path);
    await Deno.writeTextFile(path, "export const value = 11;\n");

    const mod = await loadModule(path);
    assertEquals(mod.value, 11);
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

describe("worker-script route method resolution", () => {
  it("uses GET for HEAD only when HEAD is not explicitly exported", () => {
    const get = () => "get";
    const head = () => "head";

    assertEquals(resolveWorkerRouteMethod({ GET: get }, "HEAD"), get);
    assertEquals(resolveWorkerRouteMethod({ GET: get, HEAD: head }, "HEAD"), head);
  });
});

describe("worker-script project env overlay", () => {
  it("restores values when applying a later env entry fails", async () => {
    const key = `VERYFRONT_WORKER_ENV_TEST_${crypto.randomUUID().replaceAll("-", "_")}`;
    Deno.env.set(key, "before");
    try {
      await assertRejects(() =>
        withProjectEnv(
          { [key]: "during", "INVALID=ENV=KEY": "value" },
          () => Promise.resolve(),
        )
      );
      assertEquals(Deno.env.get(key), "before");
    } finally {
      Deno.env.delete(key);
    }
  });
});

describe("worker-script OpenAPI generation", () => {
  it("evaluates method metadata and builds the spec inside the worker operation", async () => {
    const spec = await handleGenerateOpenAPI({
      type: "generate-openapi-spec",
      id: crypto.randomUUID(),
      projectDir: "/project",
      routes: [{
        pattern: "/api/users/[id]",
        moduleCode: `
          const metadata = Symbol.for("veryfront.openapi.metadata");
          function getUser() { return new Response(); }
          Object.defineProperty(getUser, metadata, {
            value: {
              summary: "Read user",
              tags: ["Users"],
              params: { type: "object", properties: { id: { type: "string" } } },
            },
          });
          export { getUser as GET };
        `,
      }],
      info: {
        title: "Worker API",
        version: "2.0.0",
        servers: [{ url: "https://example.com", description: "Current server" }],
      },
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    });

    assertEquals(spec.info.title, "Worker API");
    assertEquals(spec.paths["/api/users/{id}"]?.get?.summary, "Read user");
    assertEquals(spec.paths["/api/users/{id}"]?.get?.parameters?.[0]?.name, "id");
    assertEquals(spec.paths["/api/users/{id}"]?.post, undefined);
    assertEquals(spec.tags, [{ name: "Users" }]);
  });

  it("keeps explicit methods and fills only missing methods from the default export", async () => {
    const spec = await handleGenerateOpenAPI({
      type: "generate-openapi-spec",
      id: crypto.randomUUID(),
      projectDir: "/project",
      routes: [{
        pattern: "/api/items",
        moduleCode: `
          const metadata = Symbol.for("veryfront.openapi.metadata");
          function getItems() { return new Response(); }
          function fallback() { return new Response(); }
          Object.defineProperty(getItems, metadata, { value: { summary: "List items" } });
          Object.defineProperty(fallback, metadata, { value: { summary: "Fallback item operation" } });
          export { getItems as GET };
          export default fallback;
        `,
      }],
      info: {
        title: "Worker API",
        version: "2.0.0",
        servers: [{ url: "https://example.com" }],
      },
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    });

    const path = spec.paths["/api/items"];
    assertEquals(path?.get?.summary, "List items");
    assertEquals(path?.post?.summary, "Fallback item operation");
    assertEquals(path?.head?.summary, "Fallback item operation");
    assertEquals(path?.options?.summary, "Fallback item operation");
  });
});

describe("worker-script project run execution", () => {
  it("validates the complete request before evaluating a project module", async () => {
    const canary = "__veryfront_invalid_project_run_canary";
    const hostGlobal = globalThis as Record<string, unknown>;
    delete hostGlobal[canary];
    try {
      await assertRejects(
        () =>
          handleExecuteProjectRun({
            type: "execute-project-run",
            id: crypto.randomUUID(),
            projectDir: "/project",
            kind: "task",
            targetId: "invalid-request",
            modules: [{
              file: "file://tasks/invalid-request.ts",
              dir: "tasks",
              moduleCode: `globalThis[${JSON.stringify(canary)}] = true; export default {};`,
            }],
            config: {},
            projectId: "project-1",
            debug: false,
            sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
            projectEnv: { "invalid-key": "value" },
            datasetFiles: [],
          }),
        TypeError,
        "invalid entry",
      );
      assertEquals(hostGlobal[canary], undefined);
    } finally {
      delete hostGlobal[canary];
    }
  });

  it("discovers and executes a task module inside the worker operation", async () => {
    const envKey = `PROJECT_TASK_WORKER_${crypto.randomUUID().replaceAll("-", "_")}`;
    const result = await handleExecuteProjectRun({
      type: "execute-project-run",
      id: crypto.randomUUID(),
      projectDir: "/project",
      kind: "task",
      targetId: "sync-calendar",
      modules: [{
        file: "file://tasks/sync-calendar.ts",
        dir: "tasks",
        moduleCode: `
          export default {
            name: "Sync calendar",
            run: async (ctx) => ({
              projectId: ctx.projectId,
              configured: ctx.config.enabled,
              secret: ctx.env[${JSON.stringify(envKey)}],
            }),
          };
        `,
      }],
      config: { enabled: true },
      projectId: "project-1",
      environmentId: "environment-1",
      debug: false,
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
      projectEnv: { [envKey]: "project-value" },
      datasetFiles: [],
    });

    assertEquals(result.success, true);
    assertEquals(result.result, {
      projectId: "project-1",
      configured: true,
      secret: "project-value",
    });
    assertEquals(typeof result.durationMs, "number");
  });

  it("discovers an eval by its declared id without evaluating it in the host", async () => {
    const result = await handleExecuteProjectRun({
      type: "execute-project-run",
      id: crypto.randomUUID(),
      projectDir: "/project",
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
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
      projectEnv: {},
      datasetFiles: [],
    });

    assertEquals(result.success, true);
    assertEquals((result.result as { kind?: string }).kind, "eval-report");
    assertEquals((result.result as { runId?: string }).runId, "run_worker_eval");
    assertEquals((result.result as { definitionId?: string }).definitionId, "eval:worker-smoke");
  });
});

describe("project run worker result contract", () => {
  it("strips unknown fields and bounds error text", () => {
    const result = snapshotProjectRunWorkerResult({
      success: false,
      durationMs: 12,
      error: "x".repeat(20_000),
      internal: "must-not-cross",
    });

    assertEquals(result.success, false);
    assertEquals(result.durationMs, 12);
    assertEquals(result.error?.length, 16_384);
    assertEquals(Object.hasOwn(result, "internal"), false);
  });

  it("rejects non-serializable result values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    assertThrows(
      () =>
        snapshotProjectRunWorkerResult({
          success: true,
          durationMs: 0,
          result: cyclic,
        }),
      TypeError,
      "JSON-serializable",
    );
  });
});
