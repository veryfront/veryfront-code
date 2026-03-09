import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleActionRequest } from "./action-handler.ts";
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
      stat: overrides.stat ?? (() => Promise.reject(new Error("not found"))),
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

describe("server/services/rsc/endpoints/action-handler", () => {
  describe("handleActionRequest", () => {
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
        stat: () => Promise.reject(new Error("ENOENT")),
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
});
