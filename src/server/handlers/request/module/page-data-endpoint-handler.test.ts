import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { FakeTime } from "#std/testing/time";
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
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { FILE_NOT_FOUND, RENDER_ERROR } from "#veryfront/errors";
import { notFound, redirect } from "#veryfront/data/helpers.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";

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
    clearReactVersionCache();
    await destroyRendererAdapter();
    setRendererInitializer(undefined);
  });

  it("caches anonymous page-data responses across query parameter order", async () => {
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

  it("does not share anonymous page-data responses across projects", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );
    const url = "http://localhost/_veryfront/page-data/index.json";

    const first = await callPageDataEndpoint(
      new Request(url),
      makeCtx({ projectId: "proj-a" }),
    );
    const second = await callPageDataEndpoint(
      new Request(url),
      makeCtx({ projectId: "proj-b" }),
    );

    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(calls, 2, "page data must not be shared across projects");
    assertEquals((await first.json()).frontmatter.sequence, 1);
    assertEquals(
      (await second.json()).frontmatter.sequence,
      2,
      "the second project must receive its own render, not the first project's payload",
    );
  });

  it("does not share anonymous page-data responses across releases", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );
    const url = "http://localhost/_veryfront/page-data/index.json";

    const first = await callPageDataEndpoint(
      new Request(url),
      makeCtx({ releaseId: "rel-a" }),
    );
    const second = await callPageDataEndpoint(
      new Request(url),
      makeCtx({ releaseId: "rel-b" }),
    );

    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(calls, 2, "page data must not be shared across releases");
    assertEquals(
      (await second.json()).frontmatter.sequence,
      2,
      "a new release must receive its own render, not the previous release's payload",
    );
  });

  it("does not share anonymous page-data responses across slugs", async () => {
    let calls = 0;
    setRendererInitializer(
      createInitializer((slug) => Promise.resolve(createPageData(slug, ++calls))),
    );
    const ctx = makeCtx();

    const first = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json"),
      ctx,
    );
    const second = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/about.json"),
      ctx,
    );

    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(calls, 2, "page data must not be shared across slugs");
    assertEquals((await first.json()).slug, "index", "index.json must serve the index page");
    assertEquals((await second.json()).slug, "about", "about.json must serve the about page");
  });

  it("renders a historical requested dependency snapshot without exposing pins to page data", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-page-data-pins-" });
    const packageJsonPath = `${projectDir}/package.json`;
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { react: "18.3.1", example: "1.0.0" } }),
      );
      const snapshotA = await getDependencyPinningSnapshot(projectDir);

      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { react: "19.1.0", example: "2.0.0" } }),
      );
      const future = new Date(Date.now() + 2_000);
      await Deno.utime(packageJsonPath, future, future);
      const snapshotB = await getDependencyPinningSnapshot(projectDir);
      assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);

      let observed:
        | {
          cacheKey?: string;
          dependencies?: Readonly<Record<string, string>>;
          requestUrl?: string;
          requestPinHeader?: string | null;
          requestAuthEmailHeader?: string | null;
          requestAuthSubjectHeader?: string | null;
          requestForwardedHostHeader?: string | null;
          requestUnrelatedHeader?: string | null;
          url?: string;
        }
        | undefined;
      setRendererInitializer(
        createInitializer((slug, _ctx, options) => {
          observed = {
            cacheKey: options?.dependencyPinningCacheKey,
            dependencies: options?.dependencyPinningDependencies,
            requestUrl: options?.request?.url,
            requestPinHeader: options?.request?.headers.get(
              "x-veryfront-dependency-pins",
            ),
            requestAuthEmailHeader: options?.request?.headers.get("x-auth-email"),
            requestAuthSubjectHeader: options?.request?.headers.get("x-auth-subject"),
            requestForwardedHostHeader: options?.request?.headers.get("x-forwarded-host"),
            requestUnrelatedHeader: options?.request?.headers.get("x-unrelated"),
            url: options?.url?.href,
          };
          return Promise.resolve(createPageData(slug, 1));
        }),
      );

      const response = await callPageDataEndpoint(
        new Request(
          "http://localhost/_veryfront/page-data/index.json?visible=yes&pins=customer-value",
          {
            headers: {
              "x-veryfront-dependency-pins": snapshotA.cacheKey,
              "X-Auth-Email": "forged-email@example.test",
              "x-auth-subject": "forged-user",
              "x-forwarded-host": "internal-proxy.example",
              "x-unrelated": "kept",
            },
          },
        ),
        makeCtx({
          projectDir,
          applicationIdentityHeaderNames: ["x-auth-subject", "X-Auth-Email"],
        }),
      );
      const body = await response.json();

      assertEquals(response.status, 200);
      assertEquals(body.dependencyPinningCacheKey, snapshotA.cacheKey);
      assertEquals(observed?.cacheKey, snapshotA.cacheKey);
      assertEquals(observed?.dependencies?.example, "1.0.0");
      assertEquals(observed?.requestPinHeader, null);
      assertEquals(observed?.requestAuthEmailHeader, null);
      assertEquals(observed?.requestAuthSubjectHeader, null);
      assertEquals(observed?.requestForwardedHostHeader, null);
      assertEquals(observed?.requestUnrelatedHeader, "kept");
      assertEquals(
        response.headers.get("x-veryfront-dependency-pins"),
        snapshotA.cacheKey,
      );
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes(
          "x-veryfront-dependency-pins",
        ),
        true,
      );
      assertEquals(
        observed?.requestUrl,
        "http://localhost/_veryfront/page-data/index.json?visible=yes&pins=customer-value",
      );
      assertEquals(
        observed?.url,
        "http://localhost/_veryfront/page-data/index.json?visible=yes&pins=customer-value",
      );
    } finally {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not pass the original host Request to page data when no snapshot is requested", async () => {
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedRequest: Request | undefined;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      clearReactVersionCache();
      setRendererInitializer(
        createInitializer((slug, _ctx, options) => {
          observedRequest = options?.request;
          return Promise.resolve(createPageData(slug, 1));
        }),
      );
      const hostRequest = new Request(
        "http://localhost/_veryfront/page-data/index.json?visible=yes",
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

      const response = await callPageDataEndpoint(
        hostRequest,
        makeCtx({
          applicationIdentityHeaderNames: ["x-auth-subject", "X-Auth-Email"],
        }),
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
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      clearReactVersionCache();
    }
  });

  it("recovers a requested current snapshot after an in-process cache reset", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-page-data-cold-pins-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "19.1.0" } }),
      );
      clearReactVersionCache();
      const snapshot = await getDependencyPinningSnapshot(projectDir);
      clearReactVersionCache();

      setRendererInitializer(
        createInitializer((slug) => Promise.resolve(createPageData(slug, 1))),
      );
      const response = await callPageDataEndpoint(
        new Request(
          "http://localhost/_veryfront/page-data/index.json",
          {
            headers: {
              "x-veryfront-dependency-pins": snapshot.cacheKey,
            },
          },
        ),
        makeCtx({ projectDir }),
      );

      assertEquals(response.status, 200);
      assertEquals((await response.json()).dependencyPinningCacheKey, snapshot.cacheKey);
    } finally {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("fails closed for missing, malformed, duplicate, and unknown snapshot tokens", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-page-data-invalid-pins-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let calls = 0;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "19.1.0" } }),
      );
      clearReactVersionCache();
      setRendererInitializer(
        createInitializer((slug) => {
          calls++;
          return Promise.resolve(createPageData(slug, calls));
        }),
      );

      const requests = [
        new Request("http://localhost/_veryfront/page-data/index.json?pins=customer-value"),
        new Request("http://localhost/_veryfront/page-data/index.json", {
          headers: { "x-veryfront-dependency-pins": "off" },
        }),
        new Request("http://localhost/_veryfront/page-data/index.json", {
          headers: { "x-veryfront-dependency-pins": "on:first, on:second" },
        }),
        new Request("http://localhost/_veryfront/page-data/index.json", {
          headers: { "x-veryfront-dependency-pins": "on:unknown" },
        }),
      ];
      for (const request of requests) {
        const response = await callPageDataEndpoint(
          request,
          makeCtx({ projectDir }),
        );
        assertEquals(response.status, 409);
        assertEquals(response.headers.get("cache-control"), "no-store");
        // The body the client recovery matches on; see
        // src/server/handlers/utils/dependency-snapshot-protocol.ts.
        assertEquals(await response.text(), "Unknown dependency snapshot");
        assertEquals(
          response.headers.get("vary")?.toLowerCase().includes(
            "x-veryfront-dependency-pins",
          ),
          true,
        );
      }
      assertEquals(calls, 0);
    } finally {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves the legacy unpinned payload when dependency pinning is disabled", async () => {
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedUrl: string | undefined;
    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      clearReactVersionCache();
      setRendererInitializer(
        createInitializer((slug, _ctx, options) => {
          observedUrl = options?.request?.url;
          return Promise.resolve(createPageData(slug, 1));
        }),
      );

      const response = await callPageDataEndpoint(
        new Request(
          "http://localhost/_veryfront/page-data/index.json?pins=customer-value",
        ),
        makeCtx(),
      );
      assertEquals(response.status, 200);
      assertEquals((await response.json()).dependencyPinningCacheKey, undefined);
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes(
          "x-veryfront-dependency-pins",
        ),
        true,
      );
      assertEquals(
        observedUrl,
        "http://localhost/_veryfront/page-data/index.json?pins=customer-value",
      );
    } finally {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      clearReactVersionCache();
    }
  });

  it("encodes a getServerData redirect() as a 200 payload instead of a 500", async () => {
    // A redirect() from getServerData reaches the page-data endpoint as the
    // render-error the data pipeline raises for it, carrying context.redirect.
    // It must be encoded as a 200 { redirect } payload so the SPA client can
    // follow it — not misclassified as an internal error (500), which aborts
    // client-side navigation.
    setRendererInitializer(
      createInitializer(() =>
        Promise.reject(
          RENDER_ERROR.create({
            detail: "Redirect to /target",
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

  it("applies the redirect origin policy to returned and thrown SPA redirects", async () => {
    const failures = [
      RENDER_ERROR.create({
        detail: "Redirect blocked by policy",
        context: {
          redirect: {
            destination: "https://untrusted.example/login",
            permanent: false,
          },
        },
      }),
      redirect("https://untrusted.example/login"),
    ];

    for (const failure of failures) {
      setRendererInitializer(
        createInitializer(() => Promise.reject(failure)),
      );

      const res = await callPageDataEndpoint(
        new Request("http://runtime.internal/_veryfront/page-data/redirecting.json"),
        makeCtx({
          requestOrigin: "https://app.example.com",
          securityConfig: { redirects: { allowedOrigins: [] } },
        }),
      );

      assertEquals(res.status, 500);
      assertEquals((await res.json()).redirect, undefined);
      __clearPageDataEndpointCacheForTests();
    }
  });

  it("allows SPA redirects to the browser-visible request origin", async () => {
    setRendererInitializer(
      createInitializer(() => Promise.reject(redirect("https://app.example.com/login"))),
    );

    const res = await callPageDataEndpoint(
      new Request("http://runtime.internal/_veryfront/page-data/redirecting.json"),
      makeCtx({
        requestOrigin: "https://app.example.com",
        securityConfig: { redirects: { allowedOrigins: [] } },
      }),
    );

    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      redirect: { destination: "https://app.example.com/login", permanent: false },
    });
  });

  it("encodes path-, query-, and fragment-relative redirects for SPA navigation", async () => {
    for (const destination of ["login", "../login", "?next=1", "#details"]) {
      setRendererInitializer(
        createInitializer(() => Promise.reject(redirect(destination))),
      );

      const res = await callPageDataEndpoint(
        new Request("http://runtime.internal/_veryfront/page-data/account.json"),
        makeCtx({
          requestOrigin: "https://app.example.com",
          securityConfig: { redirects: { allowedOrigins: [] } },
        }),
      );

      assertEquals(res.status, 200);
      assertEquals(await res.json(), {
        redirect: { destination, permanent: false },
      });
      __clearPageDataEndpointCacheForTests();
    }
  });

  it("does not encode a non-http(s) redirect destination for the client to follow", async () => {
    // The client follows the destination with window.location.href, which would
    // EXECUTE a javascript:/data: URL. Such destinations must NOT be emitted as a
    // 200 redirect payload — they fall through to normal error handling instead.
    for (
      const destination of [
        "javascript:alert(1)",
        "data:text/html,x",
        "https:evil.example",
        "//evil.example",
      ]
    ) {
      setRendererInitializer(
        createInitializer(() =>
          Promise.reject(
            RENDER_ERROR.create({
              detail: `Redirect to ${destination}`,
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

  it("does not encode root-relative redirects that URL parsing normalizes across origins", async () => {
    for (const destination of ["/\\evil.example", "/\t//evil.example"]) {
      const parsedOrigin = parseOrigin(destination, "https://app.example");
      assertEquals(parsedOrigin === null || parsedOrigin !== "https://app.example", true);

      setRendererInitializer(
        createInitializer(() =>
          Promise.reject(
            RENDER_ERROR.create({
              detail: `Redirect to ${destination}`,
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
        assertEquals(options?.request?.headers.get("x-veryfront-prefetch"), null);
        const producer = producers.length === 0 ? "prefetch" : "foreground";
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

  it("aborts underlying page-data work when the request deadline expires", async () => {
    using time = new FakeTime();
    let observedSignal: AbortSignal | undefined;
    const started = Promise.withResolvers<void>();

    setRendererInitializer(
      createInitializer((_slug, _ctx, options) => {
        observedSignal = options?.abortSignal;
        started.resolve();
        return new Promise<PageDataResponse>((_, reject) => {
          options?.abortSignal?.addEventListener(
            "abort",
            () => reject(options.abortSignal?.reason),
            { once: true },
          );
        });
      }),
    );

    const responsePromise = callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json"),
      makeCtx(),
    );
    await started.promise;

    await time.tickAsync(25_000);

    const response = await responsePromise;
    assertEquals(response.status, 504);
    assertEquals(observedSignal?.aborted, true);
  });

  it("propagates caller cancellation into page-data work", async () => {
    using time = new FakeTime();
    const caller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const started = Promise.withResolvers<void>();

    setRendererInitializer(
      createInitializer((_slug, _ctx, options) => {
        observedSignal = options?.abortSignal;
        started.resolve();
        return new Promise<PageDataResponse>((_, reject) => {
          options?.abortSignal?.addEventListener(
            "abort",
            () => reject(options.abortSignal?.reason),
            { once: true },
          );
        });
      }),
    );

    const responsePromise = callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/index.json", {
        headers: { cookie: "session=caller" },
        signal: caller.signal,
      }),
      makeCtx(),
    );
    await started.promise;

    const reason = new Error("client disconnected");
    caller.abort(reason);
    await time.tickAsync(0);

    const response = await responsePromise;
    assertEquals(response.status, 500);
    assertEquals(observedSignal?.aborted, true);
    assertEquals(observedSignal?.reason, reason);
  });

  it("detaches a cancelled request without aborting a shared page-data fill", async () => {
    const caller = new AbortController();
    const resolveStarted = Promise.withResolvers<void>();
    const resolveGate = Promise.withResolvers<void>();
    let calls = 0;
    let observedSignal: AbortSignal | undefined;
    let observedRequestSignal: AbortSignal | undefined;

    setRendererInitializer(
      createInitializer((slug, _ctx, options) => {
        calls++;
        observedSignal = options?.abortSignal;
        observedRequestSignal = options?.request?.signal;
        resolveStarted.resolve();
        return new Promise<PageDataResponse>((resolve, reject) => {
          const onAbort = () => reject(options?.abortSignal?.reason);
          options?.abortSignal?.addEventListener("abort", onAbort, { once: true });
          resolveGate.promise.then(() => {
            options?.abortSignal?.removeEventListener("abort", onAbort);
            resolve(createPageData(slug, calls));
          });
        });
      }),
    );

    const ctx = makeCtx();
    const url = "http://localhost/_veryfront/page-data/index.json";
    const cancelledResponse = callPageDataEndpoint(
      new Request(url, { signal: caller.signal }),
      ctx,
    );
    await resolveStarted.promise;

    const followerResponse = callPageDataEndpoint(new Request(url), ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    caller.abort(new Error("client disconnected"));
    assertEquals((await cancelledResponse).status, 500);
    assertEquals(observedSignal?.aborted, false);
    assertEquals(observedRequestSignal?.aborted, false);

    resolveGate.resolve();
    const response = await followerResponse;
    assertEquals(response.status, 200);
    assertEquals(calls, 1);

    const cached = await callPageDataEndpoint(new Request(url), ctx);
    assertEquals(cached.status, 200);
    assertEquals(calls, 1);
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

  describe("404-vs-500 classification", () => {
    async function statusForRejection(error: unknown): Promise<number> {
      setRendererInitializer(createInitializer(() => Promise.reject(error)));
      const res = await callPageDataEndpoint(
        new Request("http://localhost/_veryfront/page-data/missing.json"),
        makeCtx(),
      );
      await res.body?.cancel();
      __clearPageDataEndpointCacheForTests();
      return res.status;
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

  it("encodes a redirect() thrown from a loader as a 200 payload", async () => {
    setRendererInitializer(
      createInitializer(() => Promise.reject(redirect("/target", true))),
    );

    const res = await callPageDataEndpoint(
      new Request("http://localhost/_veryfront/page-data/redirecting.json"),
      makeCtx(),
    );

    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      redirect: { destination: "/target", permanent: true },
    });
  });
});

function parseOrigin(destination: string, base: string): string | null {
  try {
    return new URL(destination, base).origin;
  } catch {
    return null;
  }
}
