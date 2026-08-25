import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import {
  type ActionModuleLoader,
  handleActionRequest,
  handleActionRequestWithAuthorizationProvider,
} from "./action-handler.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";
import type { RscActionAuthorizationProvider } from "#veryfront/extensions/auth/index.ts";

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

const allowActionAuthorization = Object.freeze({ authorize: () => true });

describe(
  "server/services/rsc/endpoints/action-handler",
  () => {
    afterAll(async () => {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await delay(50);
    });
    describe("handleActionRequest", () => {
      it("fails closed when the action authorization provider is missing", async () => {
        let actionStatCalls = 0;
        const response = await handleActionRequestWithAuthorizationProvider(
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
          undefined,
        );

        assertEquals(response.status, 503);
        assertEquals(response.headers.get("cache-control"), "no-store");
        assertEquals(await response.json(), {
          ok: false,
          error: "action authorization unavailable",
        });
        assertEquals(actionStatCalls, 0);
      });

      it("fails closed when the action authorization provider is malformed", async () => {
        let actionStatCalls = 0;
        const response = await handleActionRequestWithAuthorizationProvider(
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
          {},
        );

        assertEquals(response.status, 503);
        assertEquals(response.headers.get("cache-control"), "no-store");
        assertEquals(actionStatCalls, 0);
      });

      it("returns 403 without resolving the action when authorization rejects it", async () => {
        let actionStatCalls = 0;
        const response = await handleActionRequestWithAuthorizationProvider(
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
          { authorize: () => false },
        );

        assertEquals(response.status, 403);
        assertEquals(await response.json(), { ok: false, error: "unauthorized" });
        assertEquals(actionStatCalls, 0);
      });

      it("leaves application pins unchanged for authorization when pinning is off", async () => {
        let observedPins: string[] = [];
        const req = new Request(
          "http://localhost/_veryfront/rsc/action?pins=user-a&pins=user-b",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "my-action", args: [] }),
          },
        );
        const response = await handleActionRequestWithAuthorizationProvider(
          {
            req,
            projectDir: "/tmp/test",
            adapter: createMockAdapter(),
          },
          {
            authorize: (authorizationRequest) => {
              observedPins = new URL(authorizationRequest.url).searchParams.getAll("pins");
              return false;
            },
          } satisfies RscActionAuthorizationProvider,
        );

        assertEquals(response.status, 403);
        assertEquals(observedPins, ["user-a", "user-b"]);
        assertEquals(response.headers.get("vary"), RSC_DEPENDENCY_PINNING_HEADER);
      });

      it("returns 503 without resolving the action when authorization rejects", async () => {
        let actionStatCalls = 0;
        const response = await handleActionRequestWithAuthorizationProvider(
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
          { authorize: () => Promise.reject(new Error("authorization unavailable")) },
        );

        assertEquals(response.status, 503);
        assertEquals(response.headers.get("cache-control"), "no-store");
        assertEquals(await response.json(), {
          ok: false,
          error: "action authorization unavailable",
        });
        assertEquals(actionStatCalls, 0);
      });

      it("returns 503 when authorization reports an unavailable dependency", async () => {
        let actionStatCalls = 0;
        const dependencyError = Object.assign(
          new TypeError(
            'Cannot find module "/project/missing-dependency.ts" imported from "/extension/rsc-action-authorization-provider.ts"',
          ),
          { code: "ERR_MODULE_NOT_FOUND" },
        );

        const response = await handleActionRequestWithAuthorizationProvider(
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
          { authorize: () => Promise.reject(dependencyError) },
        );

        assertEquals(response.status, 503);
        assertEquals(response.headers.get("cache-control"), "no-store");
        assertEquals(await response.json(), {
          ok: false,
          error: "action authorization unavailable",
        });
        assertEquals(actionStatCalls, 0);
      });

      it("returns 503 without resolving the action when authorization throws", async () => {
        let actionStatCalls = 0;
        const response = await handleActionRequestWithAuthorizationProvider(
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
          {
            authorize: () => {
              throw new Error("authorization runtime failed");
            },
          },
        );

        assertEquals(response.status, 503);
        assertEquals(response.headers.get("cache-control"), "no-store");
        assertEquals(await response.json(), {
          ok: false,
          error: "action authorization unavailable",
        });
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

      it("returns 400 when the body is invalid JSON", async () => {
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

        const response = await handleActionRequestWithAuthorizationProvider(
          {
            req,
            projectDir: "/tmp/test",
            adapter,
          },
          allowActionAuthorization,
        );

        assertEquals(response.status, 404);
      });

      it("propagates action lookup failures instead of reporting a false 404", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.reject(new Error("action storage unavailable")),
        });

        await assertRejects(
          () =>
            handleActionRequestWithAuthorizationProvider(
              {
                req: createActionRequest(),
                projectDir: "/tmp/test",
                adapter,
              },
              allowActionAuthorization,
            ),
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

        const response = await handleActionRequestWithAuthorizationProvider(
          {
            req,
            projectDir: "/tmp/test",
            adapter,
          },
          allowActionAuthorization,
        );

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
              : Promise.reject(new Deno.errors.NotFound(`File not found: ${path}`)),
        });
        const req = new Request("http://localhost/_veryfront/rsc/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "add", args: [2, 3] }),
        });

        const response = await handleActionRequestWithAuthorizationProvider(
          {
            req,
            projectDir: "/virtual/project",
            projectId: "virtual-project",
            contentSourceId: "preview-main",
            adapter,
            config: { directories: { app: "src/app" } },
            mode: "development",
          },
          allowActionAuthorization,
        );

        assertEquals(response.status, 200);
        assertEquals(await response.json(), { ok: true, result: 5 });
      });

      for (
        const appDirectory of ["../../etc", "src/app/../../.."]
      ) {
        it(`rejects an app directory that escapes the project tree (${appDirectory})`, async () => {
          const calls: string[] = [];
          const adapter = createMockAdapter({
            stat: (path) => {
              calls.push(path);
              return Promise.reject(new Error("not found"));
            },
            readFile: (path) => {
              calls.push(path);
              return Promise.reject(new Error("not found"));
            },
          });
          const req = new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "add", args: [] }),
          });

          const response = await handleActionRequestWithAuthorizationProvider(
            {
              req,
              projectDir: "/virtual/project",
              projectId: "virtual-project",
              contentSourceId: "preview-main",
              adapter,
              config: { directories: { app: appDirectory } },
              mode: "development",
            },
            allowActionAuthorization,
          );

          assertEquals(response.status, 400, "an app root outside the project must be refused");
          assertEquals(
            await response.json(),
            { ok: false, error: "invalid action root" },
            "the refusal names the invalid action root",
          );
          assertEquals(
            calls,
            [],
            "no filesystem access may happen once the action root escapes projectDir",
          );
        });
      }

      it("keeps a snapshot-A action on A after package state advances to B", async () => {
        const projectDir = await Deno.makeTempDir({
          prefix: "vf-rsc-action-historical-pins-",
        });
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const actionPath = `${projectDir}/app/actions/version.ts`;
        const capturedOptions: Array<Parameters<ActionModuleLoader>[4]> = [];
        const moduleLoader: ActionModuleLoader = (
          _source,
          _file,
          _projectDir,
          _adapter,
          options,
        ) => {
          capturedOptions.push(options);
          return Promise.resolve({
            default: async () => options,
          });
        };
        const adapter = createMockAdapter({
          stat: (path) =>
            path === actionPath
              ? Promise.resolve({
                isFile: true,
                isDirectory: false,
                size: 1,
                mtime: null,
              })
              : Promise.reject(new Deno.errors.NotFound("not found")),
          readFile: (path) =>
            path === actionPath
              ? Promise.resolve("export default async function action() {}")
              : Promise.reject(new Deno.errors.NotFound(`File not found: ${path}`)),
        });

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          const packageJsonPath = `${projectDir}/package.json`;
          await Deno.writeTextFile(
            packageJsonPath,
            JSON.stringify({
              dependencies: {
                react: "^18.3.1",
                "snapshot-marker": "1.0.0",
              },
            }),
          );
          const snapshotA = await getDependencyPinningSnapshot(projectDir);

          await Deno.writeTextFile(
            packageJsonPath,
            JSON.stringify({
              dependencies: {
                react: "^19.2.4",
                "snapshot-marker": "2.0.0",
              },
            }),
          );
          const future = new Date(Date.now() + 2_000);
          await Deno.utime(packageJsonPath, future, future);
          const snapshotB = await getDependencyPinningSnapshot(projectDir);
          assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);

          const historical = await handleActionRequestWithAuthorizationProvider(
            {
              req: new Request(
                "https://preview-a.example/_veryfront/rsc/action?pins=application-value",
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    [RSC_DEPENDENCY_PINNING_HEADER]: snapshotA.cacheKey,
                  },
                  body: JSON.stringify({ id: "version", args: [] }),
                },
              ),
              projectDir,
              adapter,
            },
            allowActionAuthorization,
            moduleLoader,
          );
          const current = await handleActionRequestWithAuthorizationProvider(
            {
              req: new Request("https://preview-b.example/_veryfront/rsc/action", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  [RSC_DEPENDENCY_PINNING_HEADER]: snapshotB.cacheKey,
                },
                body: JSON.stringify({ id: "version", args: [] }),
              }),
              projectDir,
              adapter,
            },
            allowActionAuthorization,
            moduleLoader,
          );
          const configured = await handleActionRequestWithAuthorizationProvider(
            {
              req: new Request(
                "https://preview-a.example/_veryfront/rsc/action?pins=application-value",
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    [RSC_DEPENDENCY_PINNING_HEADER]: snapshotA.cacheKey,
                  },
                  body: JSON.stringify({ id: "version", args: [] }),
                },
              ),
              projectDir,
              adapter,
              config: { react: { version: "^19.1.1" } },
            },
            allowActionAuthorization,
            moduleLoader,
          );

          assertEquals(historical.status, 200);
          assertEquals(
            historical.headers.get("vary"),
            RSC_DEPENDENCY_PINNING_HEADER,
          );
          assertEquals(current.status, 200);
          assertEquals(configured.status, 200);
          assertEquals(capturedOptions[0]?.dependencyPinningCacheKey, snapshotA.cacheKey);
          assertEquals(capturedOptions[0]?.dependencyPinningDependencies, {
            react: "^18.3.1",
            "snapshot-marker": "1.0.0",
          });
          assertEquals(capturedOptions[0]?.reactVersion, "18.3.1");
          assertEquals(capturedOptions[0]?.moduleServerOrigin, "https://preview-a.example");
          assertEquals(capturedOptions[1]?.dependencyPinningCacheKey, snapshotB.cacheKey);
          assertEquals(capturedOptions[1]?.dependencyPinningDependencies, {
            react: "^19.2.4",
            "snapshot-marker": "2.0.0",
          });
          assertEquals(capturedOptions[1]?.reactVersion, "19.2.4");
          assertEquals(capturedOptions[1]?.moduleServerOrigin, "https://preview-b.example");
          assertEquals(capturedOptions[2]?.dependencyPinningCacheKey, snapshotA.cacheKey);
          assertEquals(capturedOptions[2]?.dependencyPinningDependencies, {
            react: "^18.3.1",
            "snapshot-marker": "1.0.0",
          });
          assertEquals(capturedOptions[2]?.reactVersion, "18.3.1");
          assertEquals(capturedOptions[2]?.moduleServerOrigin, "https://preview-a.example");
        } finally {
          if (originalFlag === undefined) {
            deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
          } else {
            setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          }
          clearReactVersionCache();
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("rejects malformed and unavailable action snapshot tokens without caching", async () => {
        for (const token of ["", "off", "on:unknown", "on:first, on:second"]) {
          const response = await handleActionRequestWithAuthorizationProvider(
            {
              req: new Request(
                "http://localhost/_veryfront/rsc/action?pins=application-value",
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    [RSC_DEPENDENCY_PINNING_HEADER]: token,
                  },
                  body: JSON.stringify({ id: "version", args: [] }),
                },
              ),
              projectDir: "/tmp/test",
              adapter: createMockAdapter(),
            },
            allowActionAuthorization,
          );

          assertEquals(response.status, 409);
          assertEquals(response.headers.get("cache-control"), "no-store");
          assertEquals(response.headers.get("vary"), RSC_DEPENDENCY_PINNING_HEADER);
        }
      });

      it("fails closed when an enabled snapshot action omits its request header", async () => {
        const projectDir = await Deno.makeTempDir({
          prefix: "vf-rsc-action-missing-pins-",
        });
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          await Deno.writeTextFile(
            `${projectDir}/package.json`,
            JSON.stringify({ dependencies: { react: "18.3.1" } }),
          );

          const response = await handleActionRequestWithAuthorizationProvider(
            {
              req: new Request(
                "http://localhost/_veryfront/rsc/action?pins=application-value",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ id: "version", args: [] }),
                },
              ),
              projectDir,
              isLocalProject: true,
              adapter: createMockAdapter(),
            },
            allowActionAuthorization,
          );

          assertEquals(response.status, 409);
          assertEquals(response.headers.get("cache-control"), "no-store");
          assertEquals(response.headers.get("vary"), RSC_DEPENDENCY_PINNING_HEADER);
        } finally {
          if (originalFlag === undefined) {
            deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
          } else {
            setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          }
          clearReactVersionCache();
          await Deno.remove(projectDir, { recursive: true });
        }
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
