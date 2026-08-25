import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import type { HandlerContext, HandlerResult } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { RenderOptions } from "#veryfront/rendering/orchestrator/types.ts";
import type { Renderer } from "#veryfront/rendering/renderer.ts";
import {
  destroyRendererAdapter,
  type RendererInitializer,
  setRendererInitializer,
} from "../../../shared/renderer/index.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { handleDataEndpoint } from "./data-endpoint-handler.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors";
import { notFound } from "#veryfront/data/helpers.ts";

const DEPENDENCY_PINNING_HEADER = "x-veryfront-dependency-pins";

function createMockAdapter(): RuntimeAdapter {
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
      readFile: () => Promise.resolve(""),
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
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as never),
  } as unknown as RuntimeAdapter;
}

function makeCtx(projectDir: string): HandlerContext {
  return {
    projectDir,
    adapter: createMockAdapter(),
    securityConfig: null,
  };
}

function createInitializer(renderPage: Renderer["renderPage"]): RendererInitializer {
  const renderer = { renderPage } as Partial<Renderer>;
  return {
    initialize: () => Promise.resolve(renderer as Renderer),
    isInitialized: () => true,
    get: () => renderer as Renderer,
    destroy: () => Promise.resolve(),
  };
}

async function callDataEndpoint(req: Request, ctx: HandlerContext): Promise<Response> {
  const result = await handleDataEndpoint(
    req,
    new URL(req.url).pathname,
    ctx,
    () => new ResponseBuilder(),
    (response): HandlerResult => ({ response, continue: false }),
    (error) => error instanceof Error ? error.message : String(error),
  );
  return result.response!;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

describe("server/handlers/request/module/data-endpoint-handler", () => {
  afterEach(async () => {
    clearReactVersionCache();
    await destroyRendererAdapter();
    setRendererInitializer(undefined);
  });

  it("renders a remembered snapshot A after B becomes current", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-data-pins-history-" });
    const packageJsonPath = `${projectDir}/package.json`;
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedOptions: RenderOptions | undefined;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { react: "18.3.1" } }),
      );
      const snapshotA = await getDependencyPinningSnapshot(projectDir);

      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      const future = new Date(Date.now() + 2_000);
      await Deno.utime(packageJsonPath, future, future);
      const snapshotB = await getDependencyPinningSnapshot(projectDir);
      assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);

      setRendererInitializer(
        createInitializer((_slug, _ctx, options) => {
          observedOptions = options;
          return Promise.resolve({
            html: "<main>snapshot A</main>",
            frontmatter: { title: "Snapshot A" },
          });
        }),
      );

      const response = await callDataEndpoint(
        new Request(
          "http://localhost/_veryfront/data/docs.json?view=full&pins=app-value",
          {
            headers: {
              [DEPENDENCY_PINNING_HEADER]: snapshotA.cacheKey,
            },
          },
        ),
        makeCtx(projectDir),
      );
      const payload = await response.json();

      assertEquals(response.status, 200);
      assertEquals(payload.dependencyPinningCacheKey, snapshotA.cacheKey);
      assertEquals(observedOptions?.dependencyPinningCacheKey, snapshotA.cacheKey);
      assertEquals(observedOptions?.dependencyPinningDependencies?.react, "18.3.1");
      assertEquals(
        observedOptions?.url?.href,
        "http://localhost/docs?view=full&pins=app-value",
      );
      assertEquals(
        observedOptions?.request?.url,
        "http://localhost/docs?view=full&pins=app-value",
      );
      assertEquals(
        observedOptions?.request?.headers.get(DEPENDENCY_PINNING_HEADER),
        null,
      );
      assertEquals(
        response.headers.get(DEPENDENCY_PINNING_HEADER),
        snapshotA.cacheKey,
      );
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes(
          DEPENDENCY_PINNING_HEADER,
        ),
        true,
      );
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("accepts the current snapshot token in a cold process", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-data-pins-current-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedOptions: RenderOptions | undefined;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      const currentSnapshot = await getDependencyPinningSnapshot(projectDir);

      // Simulate a load-balanced worker that only has the URL token and files.
      clearReactVersionCache();
      setRendererInitializer(
        createInitializer((_slug, _ctx, options) => {
          observedOptions = options;
          return Promise.resolve({ html: "<main>current</main>", frontmatter: {} });
        }),
      );

      const response = await callDataEndpoint(
        new Request(
          "http://localhost/_veryfront/data/index.json?pins=app-value",
          {
            headers: {
              [DEPENDENCY_PINNING_HEADER]: currentSnapshot.cacheKey,
            },
          },
        ),
        makeCtx(projectDir),
      );
      const payload = await response.json();

      assertEquals(response.status, 200);
      assertEquals(payload.dependencyPinningCacheKey, currentSnapshot.cacheKey);
      assertEquals(observedOptions?.dependencyPinningCacheKey, currentSnapshot.cacheKey);
      assertEquals(observedOptions?.dependencyPinningDependencies?.react, "19.2.4");
      assertEquals(observedOptions?.url?.href, "http://localhost/?pins=app-value");
      assertEquals(observedOptions?.request?.url, "http://localhost/?pins=app-value");
      assertEquals(
        observedOptions?.request?.headers.get(DEPENDENCY_PINNING_HEADER),
        null,
      );
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("returns a non-cacheable conflict for an unknown snapshot", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-data-pins-unknown-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let renderCalls = 0;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      setRendererInitializer(
        createInitializer(() => {
          renderCalls++;
          return Promise.resolve({ html: "<main>unexpected</main>", frontmatter: {} });
        }),
      );

      const response = await callDataEndpoint(
        new Request(
          "http://localhost/_veryfront/data/index.json?pins=app-value",
          {
            headers: {
              [DEPENDENCY_PINNING_HEADER]: "on:unknown",
            },
          },
        ),
        makeCtx(projectDir),
      );
      // The conflict body is the one the client recovery matches on; see
      // src/server/handlers/utils/dependency-snapshot-protocol.ts.
      const payload = await response.text();

      assertEquals(response.status, 409);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes(
          DEPENDENCY_PINNING_HEADER,
        ),
        true,
      );
      assertEquals(payload, "Unknown dependency snapshot");
      assertEquals(renderCalls, 0);
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects an unpinned request while dependency pinning is enabled", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-data-pins-missing-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let renderCalls = 0;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      setRendererInitializer(
        createInitializer(() => {
          renderCalls++;
          return Promise.resolve({ html: "<main>unexpected</main>", frontmatter: {} });
        }),
      );

      const response = await callDataEndpoint(
        new Request("http://localhost/_veryfront/data/index.json"),
        makeCtx(projectDir),
      );

      assertEquals(response.status, 409);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(renderCalls, 0);
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves the flag-off response shape and render behavior", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-data-pins-off-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedOptions: RenderOptions | undefined;

    try {
      deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
      clearReactVersionCache();
      setRendererInitializer(
        createInitializer((_slug, _ctx, options) => {
          observedOptions = options;
          return Promise.resolve({
            html: "<main>off</main>",
            frontmatter: { title: "Off" },
          });
        }),
      );

      const response = await callDataEndpoint(
        new Request(
          "http://localhost/_veryfront/data/docs.json?view=full&pins=app-value",
        ),
        makeCtx(projectDir),
      );
      const payload = await response.json();

      assertEquals(response.status, 200);
      assertEquals(payload.dependencyPinningCacheKey, undefined);
      assertEquals(observedOptions?.dependencyPinningCacheKey, "off");
      assertEquals(observedOptions?.dependencyPinningDependencies, undefined);
      assertEquals(
        observedOptions?.url?.href,
        "http://localhost/docs?view=full&pins=app-value",
      );
      assertEquals(response.headers.get(DEPENDENCY_PINNING_HEADER), null);
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes(
          DEPENDENCY_PINNING_HEADER,
        ),
        true,
      );

      const etag = response.headers.get("etag");
      assertExists(etag, "the data endpoint must return a validator");
      const second = await callDataEndpoint(
        new Request(
          "http://localhost/_veryfront/data/docs.json?view=full&pins=app-value",
          { headers: { "if-none-match": etag } },
        ),
        makeCtx(projectDir),
      );
      assertEquals(second.status, 304, "a matching if-none-match must short-circuit");
      assertEquals(await second.text(), "", "304 must carry no body");
      assertEquals(second.headers.get("etag"), etag, "304 must echo the validator");
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("passes only application headers into project data rendering", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-data-headers-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedRequest: Request | undefined;

    try {
      deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
      clearReactVersionCache();
      setRendererInitializer(
        createInitializer((_slug, _ctx, options) => {
          observedRequest = options?.request;
          return Promise.resolve({
            html: "<main>headers</main>",
            frontmatter: {},
          });
        }),
      );
      const hostRequest = new Request(
        "http://localhost/_veryfront/data/docs.json?visible=yes",
        {
          headers: {
            authorization: "Bearer application-token",
            cookie: "session=application-cookie",
            "proxy-authorization": "Basic infrastructure-proxy-token",
            "x-forwarded-host": "internal-proxy.example",
            "X-Auth-Email": "forged-email@example.test",
            "x-auth-subject": "forged-user",
            "x-project-id": "infrastructure-project",
            "x-unrelated": "kept",
            "x-token": "platform-service-token",
          },
        },
      );

      const response = await callDataEndpoint(
        hostRequest,
        {
          ...makeCtx(projectDir),
          applicationIdentityHeaderNames: ["x-auth-subject", "X-Auth-Email"],
        },
      );

      assertEquals(response.status, 200);
      assertEquals(observedRequest === hostRequest, false);
      assertEquals(observedRequest?.headers.get("authorization"), "Bearer application-token");
      assertEquals(observedRequest?.headers.get("cookie"), "session=application-cookie");
      assertEquals(observedRequest?.headers.get("x-unrelated"), "kept");
      assertEquals(observedRequest?.headers.get("proxy-authorization"), null);
      assertEquals(observedRequest?.headers.get("x-forwarded-host"), null);
      assertEquals(observedRequest?.headers.get("x-auth-email"), null);
      assertEquals(observedRequest?.headers.get("x-auth-subject"), null);
      assertEquals(observedRequest?.headers.get("x-project-id"), null);
      assertEquals(observedRequest?.headers.get("x-token"), null);
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("varies error responses on the snapshot header while pinning is disabled", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-data-pins-error-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

    try {
      deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
      clearReactVersionCache();
      setRendererInitializer(
        createInitializer(() => Promise.reject(new Error("render failed"))),
      );

      const response = await callDataEndpoint(
        new Request("http://localhost/_veryfront/data/index.json"),
        makeCtx(projectDir),
      );

      assertEquals(response.status, 500);
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes(
          DEPENDENCY_PINNING_HEADER,
        ),
        true,
      );
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  describe("404-vs-500 classification", () => {
    async function statusForRejection(error: unknown): Promise<number> {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-data-classify-" });
      try {
        setRendererInitializer(createInitializer(() => Promise.reject(error)));
        const response = await callDataEndpoint(
          new Request("http://localhost/_veryfront/data/missing.json"),
          makeCtx(projectDir),
        );
        await response.body?.cancel();
        return response.status;
      } finally {
        await destroyRendererAdapter();
        setRendererInitializer(undefined);
        await Deno.remove(projectDir, { recursive: true });
      }
    }

    it("answers 404 for the file-not-found the page resolver raises", async () => {
      assertEquals(
        await statusForRejection(
          FILE_NOT_FOUND.create({ detail: "Page not found: missing" }),
        ),
        404,
      );
    });

    it("answers 404 for a notFound() thrown from a loader, however wrapped", async () => {
      assertEquals(await statusForRejection(notFound()), 404);
      assertEquals(
        await statusForRejection(new Error("wrapped", { cause: notFound() })),
        404,
      );
    });

    it("answers 500 for an unbranded error whose message merely says not found", async () => {
      // Message text is not an interface. An error that reads "not found"
      // without carrying a routing brand is a failure, and serving it as a 404
      // would hide the failure behind the project's 404 page.
      assertEquals(await statusForRejection(new Error("Page not found")), 500);
      assertEquals(await statusForRejection(new Error("upstream said 404")), 500);
      assertEquals(await statusForRejection(new Error("no page matched")), 500);
    });

    it("answers 500 for a generic failure", async () => {
      assertEquals(await statusForRejection(new Error("render blew up")), 500);
    });
  });

  describe("slug derivation", () => {
    async function slugFor(
      pathname: string,
      ctx: HandlerContext,
    ): Promise<{ slug: string | undefined; status: number }> {
      let slug: string | undefined;
      setRendererInitializer(
        createInitializer(
          ((observed: string) => {
            slug = observed;
            return Promise.resolve({ frontmatter: {}, headings: [], html: "" });
          }) as unknown as Renderer["renderPage"],
        ),
      );

      const response = await callDataEndpoint(
        new Request(`http://localhost${pathname}`),
        ctx,
      );
      return { slug, status: response.status };
    }

    it("maps index.json to the root slug and a nested path to its slug", async () => {
      const ctx = makeCtx("/project");
      assertEquals((await slugFor("/_veryfront/data/index.json", ctx)).slug, "");
      assertEquals((await slugFor("/_veryfront/data/docs/intro.json", ctx)).slug, "docs/intro");
    });

    it("strips only the leading namespace, not a later repeat of it", async () => {
      const ctx = makeCtx("/project");
      assertEquals(
        (await slugFor("/_veryfront/data/a/_veryfront/data/b.json", ctx)).slug,
        "a/_veryfront/data/b",
      );
    });

    it("refuses a dot-segment slug in production instead of rendering it", async () => {
      const ctx = { ...makeCtx("/project"), resolvedEnvironment: "production" } as HandlerContext;
      const result = await slugFor("/_veryfront/data/.veryfront/secrets.json", ctx);

      assertEquals(result.slug, undefined);
      assertEquals(result.status, 404);
    });

    it("still renders a dot-segment slug outside production", async () => {
      const ctx: HandlerContext = { ...makeCtx("/project"), resolvedEnvironment: "preview" };
      assertEquals(
        (await slugFor("/_veryfront/data/.veryfront/secrets.json", ctx)).slug,
        ".veryfront/secrets",
      );
    });
  });
});
