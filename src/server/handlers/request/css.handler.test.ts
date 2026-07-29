import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { CSSHandler } from "./css.handler.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  cacheCSSAsync,
  clearCSSCache,
  hashCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";

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
  beforeEach(() => {
    clearCSSCache();
  });

  afterEach(() => {
    clearCSSCache();
  });

  it("serves built CSS files from local dist when the JIT cache misses", async () => {
    const handler = new CSSHandler();
    const css = ".flex{display:flex}";
    const cssHash = hashCSS(css);

    const result = await handler.handle(
      new Request(`http://localhost/_vf/css/${cssHash}.css`),
      makeCtx({
        [`/project/dist/_vf/css/${cssHash}.css`]: css,
      }),
    );

    const response = result.response!;
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/css; charset=utf-8");
    assertEquals(await response.text(), css);
  });

  it("serves empty built CSS when its content identity matches", async () => {
    const css = "";
    const cssHash = hashCSS(css);

    const result = await new CSSHandler().handle(
      new Request(`http://localhost/_vf/css/${cssHash}.css`),
      makeCtx({
        [`/project/dist/_vf/css/${cssHash}.css`]: css,
      }),
    );

    const response = result.response!;
    assertEquals(response.status, 200);
    assertEquals(await response.text(), css);
  });

  it("serves empty cached CSS without falling through to regeneration", async () => {
    const css = "";
    const cssHash = await cacheCSSAsync(css);

    const result = await new CSSHandler().handle(
      new Request(`http://localhost/_vf/css/${cssHash}.css`),
      makeCtx(),
    );

    const response = result.response!;
    assertEquals(response.status, 200);
    assertEquals(await response.text(), css);
  });

  it("does not claim legacy short-hash URLs", async () => {
    const result = await new CSSHandler().handle(
      new Request("http://localhost/_vf/css/jecaqb.css"),
      makeCtx({ "/project/dist/_vf/css/jecaqb.css": ".legacy{}" }),
    );

    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("fails closed when a built file does not match its content identity", async () => {
    const requestedHash = hashCSS(".expected{color:green}");
    const result = await new CSSHandler().handle(
      new Request(`http://localhost/_vf/css/${requestedHash}.css`),
      makeCtx({
        [`/project/dist/_vf/css/${requestedHash}.css`]: ".substituted{color:red}",
      }),
    );

    assertEquals(result.response?.status, 404);
  });
});
