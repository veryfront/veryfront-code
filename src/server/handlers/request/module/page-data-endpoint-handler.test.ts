import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import type { HandlerContext, HandlerResult } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { PageDataResponse } from "#veryfront/rendering/orchestrator/types.ts";
import type { Renderer } from "#veryfront/rendering/renderer.ts";
import {
  destroyRendererAdapter,
  type RendererInitializer,
  setRendererInitializer,
} from "../../../shared/renderer/index.ts";
import {
  __clearPageDataEndpointCacheForTests,
  handlePageDataEndpoint,
} from "./page-data-endpoint-handler.ts";

type PageDataEndpointHandler = typeof handlePageDataEndpoint;

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
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function createMultiProjectMockAdapter(
  onRunWithContext: (
    projectSlug: string,
    token: string,
    projectId: string | undefined,
    options: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    } | undefined,
  ) => void,
): RuntimeAdapter {
  const adapter = createMockAdapter() as RuntimeAdapter & {
    fs: RuntimeAdapter["fs"] & {
      getUnderlyingAdapter: () => RuntimeAdapter["fs"];
      isVeryfrontAdapter: () => boolean;
      isMultiProjectMode: () => boolean;
      isContextualMode: () => boolean;
      runWithContext: <T>(
        projectSlug: string,
        token: string,
        fn: () => Promise<T>,
        projectId?: string,
        options?: {
          productionMode?: boolean;
          releaseId?: string | null;
          branch?: string | null;
          environmentName?: string | null;
        },
      ) => Promise<T>;
    };
  };

  adapter.fs.getUnderlyingAdapter = () => adapter.fs;
  adapter.fs.isVeryfrontAdapter = () => true;
  adapter.fs.isMultiProjectMode = () => true;
  adapter.fs.isContextualMode = () => true;
  adapter.fs.runWithContext = async (projectSlug, token, fn, projectId, options) => {
    onRunWithContext(projectSlug, token, projectId, options);
    return await fn();
  };

  return adapter;
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    projectSlug: "test-project",
    projectId: "proj-page-data",
    releaseId: "rel-page-data",
    resolvedEnvironment: "production",
    requestContext: { mode: "production", branch: null } as HandlerContext["requestContext"],
    config: {} as HandlerContext["config"],
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

function createPageData(slug: string, sequence: number): PageDataResponse {
  return {
    slug,
    pagePath: "pages/index.mdx",
    pageType: "mdx",
    layouts: [],
    providers: [],
    frontmatter: { sequence },
    props: {},
    params: {},
    layoutProps: {},
    buildVersion: { framework: "test", serverStart: 1 },
  };
}

function createInitializer(resolvePageData: Renderer["resolvePageData"]): RendererInitializer {
  const renderer = {
    resolvePageData,
  } as Partial<Renderer>;

  return {
    initialize: () => Promise.resolve(renderer as Renderer),
    isInitialized: () => true,
    get: () => renderer as Renderer,
    destroy: () => Promise.resolve(),
  };
}

async function withMockedNow<T>(
  initialNow: number,
  fn: (clock: { advance: (ms: number) => void }) => Promise<T>,
): Promise<T> {
  const originalNow = Date.now;
  let now = initialNow;
  Date.now = () => now;

  try {
    return await fn({
      advance(ms: number) {
        now += ms;
      },
    });
  } finally {
    Date.now = originalNow;
  }
}

async function callPageDataEndpoint(
  req: Request,
  ctx: HandlerContext,
  handler: PageDataEndpointHandler = handlePageDataEndpoint,
): Promise<Response> {
  const result = await handler(
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
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
}

describe("server/handlers/request/module/page-data-endpoint-handler", () => {
  afterEach(async () => {
    __clearPageDataEndpointCacheForTests();
    await destroyRendererAdapter();
    setRendererInitializer(undefined);
  });

  it("caches anonymous page-data responses by project, release, slug, and query", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );

    const ctx = makeCtx();
    const req = new Request("http://localhost/_veryfront/page-data/index.json?b=2&a=1");

    const first = await callPageDataEndpoint(req, ctx);
    const second = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json?a=1&b=2"),
      ctx,
    );

    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(calls, 1);
    assertEquals(await first.text(), await second.text());
  });

  it("encodes a getServerData redirect() as a 200 payload instead of a 500", async () => {
    // A redirect() from getServerData reaches the page-data endpoint as a thrown
    // VeryfrontError carrying context.redirect. It must be encoded as a 200
    // { redirect } payload so the SPA client can follow it — not misclassified as
    // an internal error (500), which aborts client-side navigation.
    setRendererInitializer(
      createInitializer(() =>
        Promise.reject(
          Object.assign(new Error("Redirect to /target"), {
            slug: "render-error",
            context: { redirect: { destination: "/target", permanent: false } },
          }),
        )
      ),
    );

    const ctx = makeCtx();
    const res = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/redirecting.json"),
      ctx,
    );

    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      redirect: { destination: "/target", permanent: false },
    });
  });

  it("does not encode a non-http(s) redirect destination for the client to follow", async () => {
    // The client follows the destination with window.location.href, which would
    // EXECUTE a javascript:/data: URL. Such destinations must NOT be emitted as a
    // 200 redirect payload — they fall through to normal error handling instead.
    for (const destination of ["javascript:alert(1)", "data:text/html,x", "//evil.example"]) {
      setRendererInitializer(
        createInitializer(() =>
          Promise.reject(
            Object.assign(new Error(`Redirect to ${destination}`), {
              slug: "render-error",
              context: { redirect: { destination, permanent: false } },
            }),
          )
        ),
      );

      const res = await callPageDataEndpoint(
        new Request("http://localhost/_veryfront/page-data/redirecting.json"),
        makeCtx(),
      );

      assertEquals(res.status, 500);
      const body = await res.json();
      assertEquals(body.redirect, undefined);
      __clearPageDataEndpointCacheForTests();
    }
  });

  it("keeps speculative prefetch work and cache state out of foreground page data", async () => {
    const producers: string[] = [];
    const prefetchGate = Promise.withResolvers<void>();
    const prefetchStarted = Promise.withResolvers<void>();

    setRendererInitializer(
      createInitializer(async (slug, _ctx, options) => {
        const producer = options?.request?.headers.get("x-veryfront-prefetch") === "1"
          ? "prefetch"
          : "foreground";
        producers.push(producer);
        if (producers.length === 1) {
          prefetchStarted.resolve();
          await prefetchGate.promise;
        }

        return {
          ...createPageData(slug, producers.length),
          frontmatter: { producer },
        };
      }),
    );

    const ctx = makeCtx({
      projectDir: "/tmp/prefetch-page-data",
      projectSlug: "prefetch-page-data",
      projectId: "proj-prefetch-page-data",
      releaseId: "rel-prefetch-page-data",
    });
    const url = "http://localhost/_veryfront/page-data/index.json";
    const prefetchResponsePromise = callPageDataEndpoint(
      new Request(url, { headers: { "x-veryfront-prefetch": "1" } }),
      ctx,
    );
    await prefetchStarted.promise;

    const foregroundResponsePromise = callPageDataEndpoint(new Request(url), ctx);
    prefetchGate.resolve();

    const [prefetchResponse, foregroundResponse] = await Promise.all([
      prefetchResponsePromise,
      foregroundResponsePromise,
    ]);
    const cachedForegroundResponse = await callPageDataEndpoint(new Request(url), ctx);

    assertEquals(producers, ["prefetch", "foreground"]);
    assertEquals(JSON.parse(await prefetchResponse.text()).frontmatter.producer, "prefetch");
    assertEquals(JSON.parse(await foregroundResponse.text()).frontmatter.producer, "foreground");
    assertEquals(
      JSON.parse(await cachedForegroundResponse.text()).frontmatter.producer,
      "foreground",
    );
    assertEquals(
      prefetchResponse.headers.get("cache-control"),
      "no-cache, no-store, must-revalidate",
    );
  });

  it("shares page-data cache entries across tracking and cache-busting query params", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );

    const ctx = makeCtx();
    const first = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json?page=1"),
      ctx,
    );
    const second = await callPageDataEndpoint(
      new Request(
        "http://localhost/_veryfront/page-data/index.json?page=1&utm_source=google&cb=abc",
      ),
      ctx,
    );

    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(calls, 1);
    assertEquals(await first.text(), await second.text());
  });

  it("keeps distinct page-data cache entries for meaningful query params", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );

    const ctx = makeCtx();
    const first = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json?page=1"),
      ctx,
    );
    const second = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json?page=2"),
      ctx,
    );

    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(calls, 2);
    assertEquals(JSON.parse(await first.text()).frontmatter.sequence, 1);
    assertEquals(JSON.parse(await second.text()).frontmatter.sequence, 2);
  });

  it("keeps distinct page-data cache entries for repeated query params in different orders", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );

    const ctx = makeCtx();
    const first = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json?sort=price&sort=rating"),
      ctx,
    );
    const second = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json?sort=rating&sort=price"),
      ctx,
    );

    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(calls, 2);
    assertEquals(JSON.parse(await first.text()).frontmatter.sequence, 1);
    assertEquals(JSON.parse(await second.text()).frontmatter.sequence, 2);
  });

  it("uses cached etags to answer 304 without resolving page data again", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );

    const ctx = makeCtx();
    const first = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json"),
      ctx,
    );
    const etag = first.headers.get("etag");

    const second = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json", {
        headers: etag ? { "if-none-match": etag } : undefined,
      }),
      ctx,
    );

    assertEquals(first.status, 200);
    assertEquals(second.status, 304);
    assertEquals(calls, 1);
  });

  it("does not cache requests with sensitive cookies", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );

    const ctx = makeCtx();
    const init = { headers: { cookie: "session=abc123" } };

    const first = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json", init),
      ctx,
    );
    await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json", init),
      ctx,
    );

    assertEquals(calls, 2);
    assertEquals(first.headers.get("cache-control"), "no-cache, no-store, must-revalidate");
  });

  it("can disable the page-data cache with max entries set to zero", async () => {
    const envName = "VERYFRONT_PAGE_DATA_CACHE_MAX_ENTRIES";
    const originalMaxEntries = Deno.env.get(envName);
    Deno.env.set(envName, "0");

    try {
      const module = await import(
        `./page-data-endpoint-handler.ts?cache-disabled=${Date.now()}`
      );

      let calls = 0;
      setRendererInitializer(
        createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
      );

      const ctx = makeCtx();
      const req = () => new Request("http://localhost/_veryfront/page-data/index.json");

      const first = await callPageDataEndpoint(req(), ctx, module.handlePageDataEndpoint);
      const second = await callPageDataEndpoint(req(), ctx, module.handlePageDataEndpoint);

      assertEquals(first.status, 200);
      assertEquals(second.status, 200);
      assertEquals(calls, 2);
      assertEquals(first.headers.get("cache-control"), "no-cache, no-store, must-revalidate");
      module.__clearPageDataEndpointCacheForTests();
    } finally {
      restoreEnv(envName, originalMaxEntries);
    }
  });

  it("serves stale anonymous page data while refreshing the cache", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );

    await withMockedNow(1_000_000, async (clock) => {
      const ctx = makeCtx();
      const req = () => new Request("http://localhost/_veryfront/page-data/index.json");

      const first = await callPageDataEndpoint(req(), ctx);
      clock.advance(60_001);
      const second = await callPageDataEndpoint(req(), ctx);
      await Promise.resolve();
      const third = await callPageDataEndpoint(req(), ctx);

      assertEquals(JSON.parse(await first.text()).frontmatter.sequence, 1);
      assertEquals(JSON.parse(await second.text()).frontmatter.sequence, 1);
      assertEquals(JSON.parse(await third.text()).frontmatter.sequence, 2);
      assertEquals(calls, 2);
      assertEquals(
        first.headers.get("cache-control"),
        "public, max-age=60, stale-while-revalidate=1800",
      );
    });
  });

  it("does not serve stale page data for preview branch content", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );

    await withMockedNow(1_000_000, async (clock) => {
      const ctx = makeCtx({
        releaseId: undefined,
        resolvedEnvironment: "preview",
        requestContext: { mode: "preview", branch: "main" } as HandlerContext["requestContext"],
      });
      const req = () => new Request("http://localhost/_veryfront/page-data/index.json");

      const first = await callPageDataEndpoint(req(), ctx);
      clock.advance(60_001);
      const second = await callPageDataEndpoint(req(), ctx);

      assertEquals(JSON.parse(await first.text()).frontmatter.sequence, 1);
      assertEquals(JSON.parse(await second.text()).frontmatter.sequence, 2);
      assertEquals(calls, 2);
      assertEquals(first.headers.get("cache-control"), "public, max-age=60");
    });
  });

  it("resolves page data inside the multi-project production release context", async () => {
    let insideContext = false;
    const calls: Array<{
      projectSlug: string;
      token: string;
      projectId: string | undefined;
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    }> = [];

    const adapter = createMultiProjectMockAdapter(
      (projectSlug, token, projectId, options) => {
        calls.push({
          projectSlug,
          token,
          projectId,
          productionMode: options?.productionMode,
          releaseId: options?.releaseId,
          branch: options?.branch,
          environmentName: options?.environmentName,
        });
        insideContext = true;
      },
    );

    setRendererInitializer(
      createInitializer((slug) => {
        assertEquals(insideContext, true);
        insideContext = false;
        return Promise.resolve(createPageData(slug, 1));
      }),
    );

    const ctx = makeCtx({
      adapter,
      proxyToken: "tok-page-data",
      environmentName: "production",
    });

    const response = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json"),
      ctx,
    );

    assertEquals(response.status, 200);
    assertEquals(calls.length > 0, true);
    assertEquals(calls.at(-1), {
      projectSlug: "test-project",
      token: "tok-page-data",
      projectId: "proj-page-data",
      productionMode: true,
      releaseId: "rel-page-data",
      branch: null,
      environmentName: "production",
    });
  });
});
