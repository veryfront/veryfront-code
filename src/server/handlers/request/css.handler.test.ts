import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { CSSHandler } from "./css.handler.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  cacheCSSAsync,
  clearCSSCache,
  hashCSS,
} from "#veryfront/html/styles-builder/css-compiler.ts";

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
      readFileBytesWithinLimit: (path: string, byteLimit: number) => {
        const content = files[path];
        if (content === undefined) {
          return Promise.reject(Object.assign(new Error("Not found"), { code: "ENOENT" }));
        }
        const bytes = new TextEncoder().encode(content);
        if (bytes.byteLength > byteLimit) {
          return Promise.reject(new RangeError(`File exceeds byte limit of ${byteLimit} bytes`));
        }
        return Promise.resolve(bytes);
      },
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: (path: string) => {
        const content = files[path];
        if (content === undefined) {
          return Promise.reject(Object.assign(new Error("Not found"), { code: "ENOENT" }));
        }
        return Promise.resolve({
          isFile: true,
          isDirectory: false,
          size: new TextEncoder().encode(content).byteLength,
          mtime: null,
        });
      },
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

  it("loads built CSS through the exact reader without a stat or unbounded read", async () => {
    const css = ".grid{display:grid}";
    const cssHash = hashCSS(css);
    const builtPath = `/project/dist/_vf/css/${cssHash}.css`;
    const ctx = makeCtx({ [builtPath]: css });
    const exactReader = ctx.adapter.fs.readFileBytesWithinLimit!.bind(ctx.adapter.fs);
    let receivedLimit = 0;
    ctx.adapter.fs.readFileBytesWithinLimit = (path, byteLimit) => {
      receivedLimit = byteLimit;
      return exactReader(path, byteLimit);
    };
    ctx.adapter.fs.stat = () => Promise.reject(new Error("built CSS stat must not run"));
    ctx.adapter.fs.readFile = () =>
      Promise.reject(new Error("unbounded built CSS read must not run"));

    const result = await new CSSHandler().handle(
      new Request(`http://localhost/_vf/css/${cssHash}.css`),
      ctx,
    );

    assertEquals(result.response?.status, 200);
    assertEquals(receivedLimit, 32 * 1024 * 1024);
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

  it("serves built CSS at the 32 MiB UTF-8 response boundary", async () => {
    const css = "x".repeat(32 * 1024 * 1024);
    const cssHash = hashCSS(css);

    const result = await new CSSHandler().handle(
      new Request(`http://localhost/_vf/css/${cssHash}.css`),
      makeCtx({ [`/project/dist/_vf/css/${cssHash}.css`]: css }),
    );

    assertEquals(result.response?.status, 200);
    assertEquals((await result.response!.text()).length, css.length);
  });

  it("rejects built CSS above the 32 MiB UTF-8 response limit", async () => {
    const css = "x".repeat(32 * 1024 * 1024 + 1);
    const cssHash = hashCSS(css);

    await assertRejects(
      () =>
        new CSSHandler().handle(
          new Request(`http://localhost/_vf/css/${cssHash}.css`),
          makeCtx({ [`/project/dist/_vf/css/${cssHash}.css`]: css }),
        ),
      TypeError,
      "33554432 bytes",
    );
  });

  it("rejects oversized CSS before it can enter the handler cache", async () => {
    const css = "x".repeat(32 * 1024 * 1024 + 1);

    await assertRejects(
      () => cacheCSSAsync(css),
      TypeError,
      "33554432 bytes",
    );
  });

  it("propagates operational exact built-CSS reads instead of returning absence", async () => {
    const css = ".expected{color:green}";
    const cssHash = hashCSS(css);
    const ctx = makeCtx({ [`/project/dist/_vf/css/${cssHash}.css`]: css });
    const readFile = ctx.adapter.fs.readFileBytesWithinLimit!.bind(ctx.adapter.fs);
    ctx.adapter.fs.readFileBytesWithinLimit = (path: string, byteLimit: number) =>
      path.endsWith(`${cssHash}.css`)
        ? Promise.reject(
          Object.assign(new Error("built CSS permission denied"), { code: "EACCES" }),
        )
        : readFile(path, byteLimit);

    await assertRejects(
      () =>
        new CSSHandler().handle(
          new Request(`http://localhost/_vf/css/${cssHash}.css`),
          ctx,
        ),
      Error,
      "built CSS permission denied",
    );
  });
});
