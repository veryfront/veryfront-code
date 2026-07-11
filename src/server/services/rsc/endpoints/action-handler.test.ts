import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import {
  type ActionGuardLoader,
  handleActionRequest,
  handleActionRequestWithGuardLoader,
} from "./action-handler.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

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

describe(
  "server/services/rsc/endpoints/action-handler",
  () => {
    afterAll(async () => {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await delay(50);
    });
    describe("handleActionRequest", () => {
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
                throw new Error("guard runtime failed");
              },
            }),
        );

        assertEquals(response.status, 500);
        assertEquals(await response.json(), { ok: false, error: "action guard failed" });
        assertEquals(actionStatCalls, 0);
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

      it("returns 400 when body is invalid JSON (falls back to empty object)", async () => {
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not valid json",
        });

        const response = await handleActionRequest({
          req,
          projectDir: "/tmp/test",
          adapter: createMockAdapter(),
        });

        // Invalid JSON -> req.json() fails -> body = {} -> missing id
        assertEquals(response.status, 400);
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
