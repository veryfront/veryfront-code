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

async function callPageDataEndpoint(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  const result = await handlePageDataEndpoint(
    req,
    new URL(req.url).pathname,
    ctx,
    () => new ResponseBuilder(),
    (response): HandlerResult => ({ response, continue: false }),
    (error) => error instanceof Error ? error.message : String(error),
  );

  return result.response!;
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
});
