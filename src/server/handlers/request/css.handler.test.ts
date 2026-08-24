import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CSSHandler } from "./css.handler.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { hashCSS } from "#veryfront/html/styles-builder/css-identity.ts";

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
    config: {} as HandlerContext["config"],
    parsedDomain: { allowIframeEmbed: false } as HandlerContext["parsedDomain"],
  } as HandlerContext;
}

describe("server/handlers/request/css", () => {
  it("serves built CSS files from local dist when the JIT cache misses", async () => {
    const handler = new CSSHandler();
    const css = ".flex{display:flex}";
    const hash = hashCSS(css);

    const result = await handler.handle(
      new Request(`http://localhost/_vf/css/${hash}.css`),
      makeCtx({
        [`/project/dist/_vf/css/${hash}.css`]: css,
      }),
    );

    const response = result.response!;
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/css; charset=utf-8");
    assertEquals(await response.text(), css);
    assertStringIncludes(
      response.headers.get("cache-control") ?? "",
      "immutable",
      "content-addressed CSS is served immutable, so identity must be verified first",
    );
  });

  it("refuses dist CSS whose content does not match its identity hash", async () => {
    const handler = new CSSHandler();
    const hash = hashCSS(".flex{display:flex}");

    const result = await handler.handle(
      new Request(`http://localhost/_vf/css/${hash}.css`),
      makeCtx({
        [`/project/dist/_vf/css/${hash}.css`]: "body{display:none}",
      }),
    );

    const response = result.response!;
    assertEquals(
      response.status,
      404,
      "CSS whose content does not match its identity hash must not be served",
    );
    assertEquals(
      (await response.text()).includes("display:none"),
      false,
      "forged dist CSS must never reach the client",
    );
  });
});
