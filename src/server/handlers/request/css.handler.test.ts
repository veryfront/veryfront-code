import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CSSHandler } from "./css.handler.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(files: Record<string, string> = {}): RuntimeAdapter {
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
      exists: (path: string) => Promise.resolve(Object.hasOwn(files, path)),
      readFile: (path: string) => {
        const content = files[path];
        if (content === undefined) return Promise.reject(new Error("Not found"));
        return Promise.resolve(content);
      },
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null }),
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

function makeCtx(files: Record<string, string> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: createMockAdapter(files),
    securityConfig: {},
    cspUserHeader: null,
    config: {} as HandlerContext["config"],
    parsedDomain: { allowIframeEmbed: false } as HandlerContext["parsedDomain"],
  } as HandlerContext;
}

describe("server/handlers/request/css", () => {
  it("serves built CSS files from local dist when the JIT cache misses", async () => {
    const handler = new CSSHandler();

    const result = await handler.handle(
      new Request("http://localhost/_vf/css/jecaqb.css"),
      makeCtx({
        "/project/dist/_vf/css/jecaqb.css": ".flex{display:flex}",
      }),
    );

    const response = result.response!;
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/css; charset=utf-8");
    assertEquals(await response.text(), ".flex{display:flex}");
  });
});
