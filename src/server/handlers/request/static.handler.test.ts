import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { StaticHandler } from "./static.handler.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import {
  makeTempDir,
  mkdir,
  remove,
  symlink,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: {
      name: "test",
      env: { get: () => undefined },
      fs: {},
    },
    securityConfig: {},
    isLocalProject: false,
    requestContext: {
      mode: "production",
    } as HandlerContext["requestContext"],
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/static.handler", () => {
  it("serves generated production build assets under /_veryfront", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return {
          path: "/tmp/test-project/dist/_veryfront/chunks/index.js",
          data: new TextEncoder().encode("export const page = true;"),
          etag: '"asset-etag"',
          contentType: "application/javascript; charset=utf-8",
          cacheStrategy: "immutable",
          source: "dist",
        };
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/chunks/index.js"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(resolvedPath, "/_veryfront/chunks/index.js");
    assertEquals(result.response.status, 200);
    assertEquals(
      result.response.headers.get("content-type"),
      "application/javascript; charset=utf-8",
    );
    assertEquals(await result.response.text(), "export const page = true;");
  });

  it("answers a matching If-None-Match with 304 and serves a stale validator in full", async () => {
    const handler = new StaticHandler();
    (handler as any).staticService = {
      resolveFile: async () => ({
        path: "/tmp/test-project/dist/_veryfront/chunks/index.js",
        data: new TextEncoder().encode("export const page = true;"),
        etag: '"asset-etag"',
        contentType: "application/javascript; charset=utf-8",
        cacheStrategy: "immutable",
        source: "dist",
      }),
      isAssetRequest: () => true,
    };
    const url = "http://localhost/_veryfront/chunks/index.js";

    const first = await handler.handle(new Request(url), makeCtx());
    assertExists(first.response);
    const etag = first.response.headers.get("etag");
    assertExists(etag, "a served static asset must carry a validator");
    await first.response.text();

    const revalidated = await handler.handle(
      new Request(url, { headers: { "if-none-match": etag } }),
      makeCtx(),
    );
    assertExists(revalidated.response);
    assertEquals(revalidated.response.status, 304, "a matching validator must answer 304");
    assertEquals(await revalidated.response.text(), "", "a 304 must not carry a body");

    const stale = await handler.handle(
      new Request(url, { headers: { "if-none-match": '"other"' } }),
      makeCtx(),
    );
    assertExists(stale.response);
    assertEquals(stale.response.status, 200, "a foreign validator must not be treated as a match");
    assertEquals(
      await stale.response.text(),
      "export const page = true;",
      "a stale validator must receive the full asset",
    );
  });

  it("suppresses the body for HEAD requests while keeping the headers", async () => {
    const handler = new StaticHandler();
    (handler as any).staticService = {
      resolveFile: async () => ({
        path: "/tmp/test-project/dist/_veryfront/chunks/index.js",
        data: new TextEncoder().encode("export const page = true;"),
        etag: '"asset-etag"',
        contentType: "application/javascript; charset=utf-8",
        cacheStrategy: "immutable",
        source: "dist",
      }),
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/chunks/index.js", { method: "HEAD" }),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(
      result.response.headers.get("content-type"),
      "application/javascript; charset=utf-8",
    );
    assertEquals(await result.response.text(), "", "HEAD responses must not carry a body");
  });

  it("forwards the configured build output directory to static resolution", async () => {
    const handler = new StaticHandler();
    let resolvedBuildOutDir: string | undefined;
    (handler as any).staticService = {
      resolveFile: async (_pathname: string, options: { buildOutDir?: string }) => {
        resolvedBuildOutDir = options.buildOutDir;
        return null;
      },
      isAssetRequest: () => true,
    };

    await handler.handle(
      new Request("http://localhost/_veryfront/hydration-runtime.2b3c4d5e.js"),
      makeCtx({ config: { build: { outDir: "custom-output" } } }),
    );

    assertEquals(resolvedBuildOutDir, "custom-output");
  });

  it("does not serve a release runtime from an absolute build output directory", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-static-project-" });
    const buildOutDir = await makeTempDir({ prefix: "vf-static-output-" });
    const runtimePath = "/_veryfront/hydration-runtime.2b3c4d5e.js";

    try {
      await mkdir(`${buildOutDir}/_veryfront`, { recursive: true });
      await writeTextFile(
        `${buildOutDir}${runtimePath}`,
        "export const releaseRuntime = true;",
      );
      const handler = new StaticHandler();
      const adapter = await getAdapter();
      await assertRejects(
        () =>
          handler.handle(
            new Request(`http://localhost${runtimePath}`),
            makeCtx({
              projectDir,
              adapter,
              config: { build: { outDir: buildOutDir } },
            }),
          ),
        Error,
        "inside the project",
      );
    } finally {
      await remove(projectDir, { recursive: true });
      await remove(buildOutDir, { recursive: true });
    }
  });

  it("does not trust a configured build output symlink as a static root", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-static-project-" });
    const externalDir = await makeTempDir({ prefix: "vf-static-external-" });
    const runtimePath = "/_veryfront/hydration-runtime.2b3c4d5e.js";

    try {
      await mkdir(`${externalDir}/_veryfront`, { recursive: true });
      await writeTextFile(`${externalDir}${runtimePath}`, "export const hostFile = true;");
      await symlink(externalDir, `${projectDir}/output`);

      const handler = new StaticHandler();
      const adapter = await getAdapter();
      const result = await handler.handle(
        new Request(`http://localhost${runtimePath}`),
        makeCtx({
          projectDir,
          adapter,
          config: { build: { outDir: "output" } },
        }),
      );
      assertEquals(result.response?.status, 404);
      assertEquals(await result.response?.text(), "Not Found");
    } finally {
      await remove(projectDir, { recursive: true });
      await remove(externalDir, { recursive: true });
    }
  });

  it("serves generated hydration runtime under /_veryfront", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return {
          path: "/tmp/test-project/dist/_veryfront/hydration-runtime.js",
          data: new TextEncoder().encode("export const hydrate = true;"),
          etag: '"asset-etag"',
          contentType: "application/javascript; charset=utf-8",
          cacheStrategy: "immutable",
          source: "dist",
        };
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/hydration-runtime.js"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(resolvedPath, "/_veryfront/hydration-runtime.js");
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.text(), "export const hydrate = true;");
  });

  it("serves local release assets under /_vf/assets", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return {
          path: "/tmp/test-project/dist/_vf/assets/hash.js",
          data: new TextEncoder().encode("export const react = true;"),
          etag: '"asset-etag"',
          contentType: "application/javascript; charset=utf-8",
          cacheStrategy: "immutable",
          source: "dist",
        };
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_vf/assets/hash.js"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(resolvedPath, "/_vf/assets/hash.js");
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.text(), "export const react = true;");
  });

  it("lets missing generated page modules fall through to ModuleHandler", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return null;
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/pages/index.js"),
      makeCtx(),
    );

    assertEquals(resolvedPath, "/_veryfront/pages/index.js");
    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("lets missing generated data endpoints fall through to ModuleHandler", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return null;
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/data/index.json"),
      makeCtx(),
    );

    assertEquals(resolvedPath, "/_veryfront/data/index.json");
    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("redirects a missing favicon.ico to an existing favicon.svg", async () => {
    const handler = new StaticHandler();
    const resolvedPaths: string[] = [];
    (handler as any).staticService = {
      resolveFile: (pathname: string) => {
        resolvedPaths.push(pathname);
        if (pathname === "/favicon.ico") return Promise.resolve(null);
        return Promise.resolve({
          path: "/tmp/test-project/public/favicon.svg",
          data: new TextEncoder().encode("<svg></svg>"),
          etag: '"favicon-etag"',
          contentType: "image/svg+xml",
          cacheStrategy: "medium",
          source: "public",
        });
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/favicon.ico"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(resolvedPaths, ["/favicon.ico", "/favicon.svg"]);
    assertEquals(result.response.status, 307);
    assertEquals(result.response.headers.get("location"), "http://localhost/favicon.svg");
  });

  it("adds matching nonces to source-authored static HTML before applying CSP", async () => {
    const handler = new StaticHandler();
    (handler as any).staticService = {
      resolveFile: async () => ({
        path: "/tmp/test-project/dist/index.html",
        data: new TextEncoder().encode(
          [
            "<!doctype html>",
            "<html><head>",
            '<script type="importmap" nonce="build-nonce">{"imports":{"react":"https://esm.sh/react"}}</script>',
            '<style nonce="build-nonce">.chat{color:red}</style>',
            "</head><body>",
            '<script id="veryfront-hydration-data" type="application/json">{"page":"index"}</script>',
            `<script type="module">window.tpl="<script>alert(1)";</script>`,
            "</body></html>",
          ].join(""),
        ),
        etag: '"stale-etag"',
        contentType: "text/html; charset=utf-8",
        cacheStrategy: "medium",
        source: "dist",
      }),
      isAssetRequest: () => true,
    };

    const result = await handler.handle(new Request("http://localhost/"), makeCtx());
    assertExists(result.response);

    const response = result.response;
    const body = await response.text();
    // Either header carries the policy: the floor is served report-only
    // until a project opts in, and this asserts nonce alignment either way.
    const csp = // Reported first: the enforced header carries only the directives that
      // bind, and the nonce lives in the reported `script-src`.
      response.headers.get("content-security-policy-report-only") ??
        response.headers.get("content-security-policy") ?? "";
    const nonceMatch = csp.match(/nonce-([^' ;]+)/);

    assertEquals(Boolean(nonceMatch), true);
    const nonce = nonceMatch![1]!;

    assertEquals(body.includes(`<script type="importmap" nonce="${nonce}">`), true);
    assertEquals(body.includes(`<style nonce="${nonce}">.chat{color:red}</style>`), true);
    assertEquals(body.includes('nonce="build-nonce"'), false);
    assertEquals(
      body.includes(
        `<script id="veryfront-hydration-data" type="application/json" nonce="${nonce}">{"page":"index"}</script>`,
      ),
      true,
    );
    assertEquals(
      body.includes(`window.tpl="<script>alert(1)";</script>`),
      true,
    );
    assertEquals(body.includes(`<script nonce="${nonce}">alert(1)`), false);
    assertEquals(response.headers.get("etag") === '"stale-etag"', false);
  });
});
