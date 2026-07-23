import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import {
  type ActionGuardLoader,
  handleActionRequest,
  handleActionRequestWithGuardLoader,
} from "./action-handler.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

function createMockAdapter(
  overrides: {
    stat?: (
      path: string,
    ) => Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: null }>;
    readFile?: (path: string) => Promise<string>;
  } = {},
): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: overrides.readFile ?? (() => Promise.resolve("")),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: overrides.stat ?? (() => Promise.reject(new Deno.errors.NotFound("not found"))),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function createActionRequest(id = "my-action"): Request {
  return new Request("http://localhost/_veryfront/rsc/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, args: [] }),
  });
}

async function assertRejectedBeforeActionResolution(
  req: Request,
  expectedStatus: number,
): Promise<void> {
  let guardLoads = 0;
  let actionStatCalls = 0;
  const response = await handleActionRequestWithGuardLoader(
    {
      req,
      projectDir: "/tmp/test",
      adapter: createMockAdapter({
        stat: () => {
          actionStatCalls++;
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
      }),
    },
    () => {
      guardLoads++;
      return Promise.resolve({});
    },
  );

  assertEquals(response.status, expectedStatus);
  assertEquals(guardLoads, 0);
  assertEquals(actionStatCalls, 0);
}

describe(
  "server/services/rsc/endpoints/action-handler",
  () => {
    afterEach(() => {
      __resetLogRecordEmitterForTests();
    });

    afterAll(async () => {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await delay(50);
    });
    describe("handleActionRequest", () => {
      it("rejects non-JSON requests before loading the guard or action", async () => {
        await assertRejectedBeforeActionResolution(
          new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: JSON.stringify({ id: "my-action", args: [] }),
          }),
          400,
        );
      });

      it("rejects a foreign Origin before loading the guard or action", async () => {
        await assertRejectedBeforeActionResolution(
          new Request("https://project.example/_veryfront/rsc/action", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "https://attacker.example",
            },
            body: JSON.stringify({ id: "my-action", args: [] }),
          }),
          403,
        );
      });

      it("rejects cross-site Fetch Metadata before loading the guard or action", async () => {
        await assertRejectedBeforeActionResolution(
          new Request("https://project.example/_veryfront/rsc/action", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "sec-fetch-site": "cross-site",
            },
            body: JSON.stringify({ id: "my-action", args: [] }),
          }),
          403,
        );
      });

      it("allows a same-origin JSON request to reach the optional guard", async () => {
        let guardLoads = 0;
        const response = await handleActionRequestWithGuardLoader(
          {
            req: new Request("https://project.example/_veryfront/rsc/action", {
              method: "POST",
              headers: {
                "content-type": "application/json; charset=utf-8",
                origin: "https://project.example",
                "sec-fetch-site": "same-origin",
              },
              body: JSON.stringify({ id: "my-action", args: [] }),
            }),
            projectDir: "/tmp/test",
            adapter: createMockAdapter(),
          },
          () => {
            guardLoads++;
            return Promise.resolve({});
          },
        );

        assertEquals(response.status, 404);
        assertEquals(guardLoads, 1);
      });

      it("allows a missing optional action guard module", async () => {
        const missingGuardError = Object.assign(
          new TypeError('Module not found "file:///project/server-action-guard.ts".'),
          { code: "ERR_MODULE_NOT_FOUND" },
        );
        const response = await handleActionRequestWithGuardLoader(
          {
            req: createActionRequest(),
            projectDir: "/tmp/test",
            adapter: createMockAdapter(),
          },
          () => Promise.reject(missingGuardError),
        );

        assertEquals(response.status, 404);
      });

      it("allows an action guard module with no guard export", async () => {
        const response = await handleActionRequestWithGuardLoader(
          {
            req: createActionRequest(),
            projectDir: "/tmp/test",
            adapter: createMockAdapter(),
          },
          () => Promise.resolve({}),
        );

        assertEquals(response.status, 404);
      });

      it("returns 403 without resolving the action when the guard rejects it", async () => {
        let actionStatCalls = 0;
        const response = await handleActionRequestWithGuardLoader(
          {
            req: createActionRequest(),
            projectDir: "/tmp/test",
            adapter: createMockAdapter({
              stat: () => {
                actionStatCalls++;
                return Promise.reject(new Error("not found"));
              },
            }),
          },
          () =>
            Promise.resolve({
              rscActionGuard: () => false,
            }),
        );

        assertEquals(response.status, 403);
        assertEquals(await response.json(), { ok: false, error: "unauthorized" });
        assertEquals(actionStatCalls, 0);
      });

      it("returns 500 without resolving the action when the guard module fails to load", async () => {
        let actionStatCalls = 0;
        const actionGuardLoader: ActionGuardLoader = () =>
          Promise.reject(new Error("guard initialization failed"));

        const response = await handleActionRequestWithGuardLoader(
          {
            req: createActionRequest(),
            projectDir: "/tmp/test",
            adapter: createMockAdapter({
              stat: () => {
                actionStatCalls++;
                return Promise.reject(new Error("not found"));
              },
            }),
          },
          actionGuardLoader,
        );

        assertEquals(response.status, 500);
        assertEquals(await response.json(), { ok: false, error: "action guard failed" });
        assertEquals(actionStatCalls, 0);
      });

      it("returns 500 when the guard module has a missing dependency", async () => {
        let actionStatCalls = 0;
        const dependencyError = Object.assign(
          new TypeError(
            'Cannot find module "/project/missing-dependency.ts" imported from "/project/server-action-guard.ts"',
          ),
          { code: "ERR_MODULE_NOT_FOUND" },
        );

        const response = await handleActionRequestWithGuardLoader(
          {
            req: createActionRequest(),
            projectDir: "/tmp/test",
            adapter: createMockAdapter({
              stat: () => {
                actionStatCalls++;
                return Promise.reject(new Error("not found"));
              },
            }),
          },
          () => Promise.reject(dependencyError),
        );

        assertEquals(response.status, 500);
        assertEquals(await response.json(), { ok: false, error: "action guard failed" });
        assertEquals(actionStatCalls, 0);
      });

      it("returns 500 without resolving the action when the guard throws", async () => {
        const entries: LogEntry[] = [];
        __registerLogRecordEmitter((entry) => entries.push(entry));
        let actionStatCalls = 0;
        const response = await handleActionRequestWithGuardLoader(
          {
            req: createActionRequest(),
            projectDir: "/tmp/test",
            adapter: createMockAdapter({
              stat: () => {
                actionStatCalls++;
                return Promise.reject(new Error("not found"));
              },
            }),
          },
          () =>
            Promise.resolve({
              rscActionGuard: () => {
                throw new Error("private guard failure marker");
              },
            }),
        );

        assertEquals(response.status, 500);
        assertEquals(await response.json(), { ok: false, error: "action guard failed" });
        assertEquals(actionStatCalls, 0);
        assertEquals(JSON.stringify(entries).includes("private guard failure marker"), false);
      });

      it("returns 400 when body has no id", async () => {
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ args: [] }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter: createMockAdapter(),
        });

        assertEquals(response.status, 400);
        const body = await response.json();
        assertStringIncludes(JSON.stringify(body), "missing id");
      });

      it("returns 400 when body is invalid JSON", async () => {
        const entries: LogEntry[] = [];
        __registerLogRecordEmitter((entry) => entries.push(entry));
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "BODYMARK",
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter: createMockAdapter(),
        });

        assertEquals(response.status, 400);
        assertEquals(JSON.stringify(entries).includes("BODYMARK"), false);
      });

      it("returns 413 when the request body exceeds the limit", async () => {
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ padding: "x".repeat(DEFAULT_MAX_BODY_SIZE_BYTES) }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter: createMockAdapter(),
        });

        assertEquals(response.status, 413);
      });

      it("returns 400 when id contains path traversal", async () => {
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "../etc/passwd", args: [] }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter: createMockAdapter(),
        });

        assertEquals(response.status, 400);
        const body = await response.json();
        assertStringIncludes(JSON.stringify(body), "invalid id");
      });

      it("returns 400 when id starts with slash", async () => {
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "/admin/secret", args: [] }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter: createMockAdapter(),
        });

        assertEquals(response.status, 400);
      });

      it("returns 404 when action file does not exist", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.reject(new Deno.errors.NotFound("not found")),
        });

        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "my-action", args: [] }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter,
        });

        assertEquals(response.status, 404);
      });

      it("propagates action lookup failures instead of reporting a false 404", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.reject(new Error("action storage unavailable")),
        });

        await assertRejects(
          () =>
            handleActionRequest({
              req: createActionRequest(),
              projectDir: "/tmp/test",
              adapter,
            }),
          Error,
          "action storage unavailable",
        );
      });

      it("returns 404 when action path exists but is not a file", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.resolve({ isFile: false, isDirectory: true, size: 0, mtime: null }),
        });

        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "my-action", args: [] }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter,
        });

        assertEquals(response.status, 404);
      });

      it("loads actions from configured app roots through the request adapter", async () => {
        const expectedPath = "/virtual/project/src/app/actions/add.ts";
        const adapter = createMockAdapter({
          stat: (path) =>
            path === expectedPath
              ? Promise.resolve({ isFile: true, isDirectory: false, size: 1, mtime: null })
              : Promise.reject(new Error("not found")),
          readFile: (path) =>
            path === expectedPath
              ? Promise.resolve(
                "export default async function add(a: number, b: number) { return a + b; }",
              )
              : Promise.reject(new Error("not found")),
        });
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "add", args: [2, 3] }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/virtual/project",
          projectId: "virtual-project",
          contentSourceId: "preview-main",
          adapter,
          config: { directories: { app: "src/app" } },
          mode: "development",
        });

        assertEquals(response.status, 200);
        assertEquals(await response.json(), { ok: true, result: 5 });
      });

      it("returns 400 for empty id string", async () => {
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "", args: [] }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter: createMockAdapter(),
        });

        assertEquals(response.status, 400);
      });

      it("returns 400 when id ends with slash", async () => {
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "my-action/", args: [] }),
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter: createMockAdapter(),
        });

        assertEquals(response.status, 400);
      });
    });
  },
);
