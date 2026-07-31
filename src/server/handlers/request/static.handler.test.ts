import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import type { FileSystemRepository } from "#veryfront/repositories/types.ts";
import {
  StaticAssetUnavailableError,
  type StaticAssetUnavailableReason,
  StaticFileService,
} from "../../services/static/static-file.service.ts";
import { StaticHandler } from "./static.handler.ts";

type StaticHandlerTestAccess = {
  staticService: {
    resolveFile: (
      pathname: string,
      options: { manifestCacheIdentity?: string },
    ) => Promise<null>;
    isAssetRequest: (pathname: string) => boolean;
  };
};

type StaticHandlerConcreteServiceAccess = {
  staticService: StaticFileService;
};

type StaticHandlerServicePortAccess = {
  staticService: Pick<StaticFileService, "resolveFile" | "isAssetRequest">;
};

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: {
      name: "test",
      env: { get: () => undefined },
      fs: {},
    },
    securityConfig: {},
    cspUserHeader: null,
    isLocalProject: false,
    requestContext: {
      mode: "production",
    } as HandlerContext["requestContext"],
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/static.handler", () => {
  it("uses collision-free manifest identities for adversarial release and branch delimiters", async () => {
    const handler = new StaticHandler();
    const identities: string[] = [];
    (handler as unknown as StaticHandlerTestAccess).staticService = {
      resolveFile: (_pathname: string, options: { manifestCacheIdentity?: string }) => {
        identities.push(options.manifestCacheIdentity ?? "");
        return Promise.resolve(null);
      },
      isAssetRequest: () => true,
    };

    await handler.handle(
      new Request("http://localhost/_veryfront/chunks/app.js"),
      makeCtx({
        projectId: "project",
        releaseId: "release:segment",
        resolvedEnvironment: "production",
        requestContext: {
          mode: "production",
          branch: "branch",
        } as HandlerContext["requestContext"],
      }),
    );
    await handler.handle(
      new Request("http://localhost/_veryfront/chunks/app.js"),
      makeCtx({
        projectId: "project",
        releaseId: "release",
        resolvedEnvironment: "production",
        requestContext: {
          mode: "production",
          branch: "segment:branch",
        } as HandlerContext["requestContext"],
      }),
    );

    assertEquals(identities.length, 2);
    assertEquals(identities[0] === identities[1], false);
  });

  it("never claims dotted project API routes as static assets", async () => {
    const handler = new StaticHandler();
    let staticLookupCount = 0;
    (handler as any).staticService = {
      resolveFile: async () => {
        staticLookupCount++;
        return null;
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/api/reports/latest.json"),
      makeCtx(),
    );

    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
    assertEquals(staticLookupCount, 0);
    assertEquals(
      handler.metadata.patterns?.some((pattern) =>
        pattern.pattern instanceof RegExp &&
        pattern.pattern.test("/api/reports/latest.json")
      ),
      false,
    );
  });

  it("still serves similarly prefixed non-API assets", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return {
          path: "/tmp/test-project/public/apix/static.json",
          data: new TextEncoder().encode('{"ok":true}'),
          etag: '"asset-etag"',
          contentType: "application/json; charset=utf-8",
          cacheStrategy: "medium",
          source: "public",
        };
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/apix/static.json"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(resolvedPath, "/apix/static.json");
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.text(), '{"ok":true}');
  });

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

  it("does not explicitly duplicate non-HTML asset bytes for GET responses", async () => {
    const handler = new StaticHandler();
    const data = new TextEncoder().encode("export const bounded = true;");
    let sliceCalls = 0;
    Object.defineProperty(data, "slice", {
      configurable: true,
      value: () => {
        sliceCalls++;
        throw new Error("static handler must not duplicate asset bytes");
      },
    });
    (handler as unknown as StaticHandlerServicePortAccess).staticService = {
      resolveFile: () =>
        Promise.resolve({
          path: "/tmp/test-project/public/asset.js",
          data,
          size: data.byteLength,
          etag: '"asset-etag"',
          contentType: "application/javascript; charset=utf-8",
          cacheStrategy: "medium",
          source: "public",
        }),
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/asset.js"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(await result.response.text(), "export const bounded = true;");
    assertEquals(sliceCalls, 0);
  });

  it("serves HEAD from metadata without reading asset content", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    let boundedLimit = 0;
    let wholeReads = 0;
    const repo = {
      readFile: () => Promise.resolve(""),
      readFileBytes: () => {
        wholeReads++;
        return Promise.resolve(data);
      },
      readFileBytesBounded: (_path: string, byteLimit: number) => {
        boundedLimit = byteLimit;
        return Promise.resolve(data);
      },
      stat: (path: string) => {
        if (path === "public/asset.bin") {
          return Promise.resolve({
            isFile: true,
            isDirectory: false,
            mtime: new Date(1),
            size: data.byteLength,
          });
        }
        return Promise.reject(Object.assign(new Error("not found"), { code: "ENOENT" }));
      },
    } as unknown as FileSystemRepository;
    const handler = new StaticHandler();
    (handler as unknown as StaticHandlerConcreteServiceAccess).staticService =
      new StaticFileService(repo, { maxAssetBytes: data.byteLength });

    const result = await handler.handle(
      new Request("http://localhost/asset.bin", { method: "HEAD" }),
      makeCtx({ isLocalProject: true }),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals((await result.response.arrayBuffer()).byteLength, 0);
    assertEquals(result.response.headers.get("content-length"), String(data.byteLength));
    assertEquals(boundedLimit, 0);
    assertEquals(wholeReads, 0);
  });

  it("omits HEAD content-length when the provider has no declared size", async () => {
    const handler = new StaticHandler();
    let bodyReads = 0;
    (handler as any).staticService = {
      resolveFile: () => {
        bodyReads++;
        return Promise.reject(new Error("HEAD must not resolve a body"));
      },
      resolveFileMetadata: () =>
        Promise.resolve({
          path: "/tmp/test-project/public/asset.bin",
          size: null,
          contentType: "application/octet-stream",
          cacheStrategy: "medium",
          source: "public",
        }),
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/asset.bin", { method: "HEAD" }),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(result.response.headers.get("content-length"), null);
    assertEquals((await result.response.arrayBuffer()).byteLength, 0);
    assertEquals(bodyReads, 0);
  });

  it("omits raw HTML size and ETag on metadata-only HEAD", async () => {
    const handler = new StaticHandler();
    let bodyReads = 0;
    (handler as any).staticService = {
      resolveFile: () => {
        bodyReads++;
        return Promise.reject(new Error("HEAD must not generate transformed HTML"));
      },
      resolveFileMetadata: () =>
        Promise.resolve({
          path: "/tmp/test-project/dist/index.html",
          size: 42,
          contentType: "text/html; charset=utf-8",
          cacheStrategy: "no-cache",
          source: "dist",
        }),
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/index.html", { method: "HEAD" }),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(result.response.headers.get("content-length"), null);
    assertEquals(result.response.headers.get("etag"), null);
    assertEquals((await result.response.arrayBuffer()).byteLength, 0);
    assertEquals(bodyReads, 0);
  });

  it("maps unavailable bounded static reads to a sanitized 503", async () => {
    let wholeReads = 0;
    const repo = {
      readFile: () => Promise.resolve(""),
      readFileBytes: () => {
        wholeReads++;
        return Promise.resolve(new Uint8Array([1, 2, 3, 4]));
      },
      stat: (path: string) => {
        if (path === "public/asset.bin") {
          return Promise.resolve({
            isFile: true,
            isDirectory: false,
            mtime: new Date(1),
            size: 4,
          });
        }
        return Promise.reject(Object.assign(new Error("not found"), { code: "ENOENT" }));
      },
    } as unknown as FileSystemRepository;
    const handler = new StaticHandler();
    (handler as unknown as StaticHandlerConcreteServiceAccess).staticService =
      new StaticFileService(repo, { maxAssetBytes: 4 });

    const result = await handler.handle(
      new Request("http://localhost/asset.bin"),
      makeCtx({ isLocalProject: true }),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 503);
    assertEquals(await result.response.text(), "Static asset unavailable");
    assertEquals(result.response.headers.get("cache-control"), "no-store");
    assertEquals(wholeReads, 0);
  });

  it("maps every typed admission reason to sanitized 503 semantics", async () => {
    const reasons: StaticAssetUnavailableReason[] = [
      "read-capability-unavailable",
      "byte-limit",
      "invalid-metadata",
      "invalid-reader-result",
    ];

    for (const reason of reasons) {
      for (const method of ["GET", "HEAD"] as const) {
        const handler = new StaticHandler();
        const reject = () =>
          Promise.reject(
            new StaticAssetUnavailableError(reason, `sensitive detail for ${reason}`),
          );
        (handler as any).staticService = {
          resolveFile: reject,
          resolveFileMetadata: reject,
          isAssetRequest: () => true,
        };

        const result = await handler.handle(
          new Request("http://localhost/asset.bin", { method }),
          makeCtx(),
        );

        assertExists(result.response);
        assertEquals(result.response.status, 503, `${method} ${reason}`);
        assertEquals(result.response.headers.get("cache-control"), "no-store");
        assertEquals(
          await result.response.text(),
          method === "HEAD" ? "" : "Static asset unavailable",
        );
      }
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

  it("adds matching nonces to static HTML responses before applying CSP", async () => {
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
    const csp = response.headers.get("content-security-policy") ?? "";
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
