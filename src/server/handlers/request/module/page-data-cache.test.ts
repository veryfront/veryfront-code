import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { PageDataResponse } from "#veryfront/rendering/orchestrator/types.ts";
import type { HandlerContext } from "../../types.ts";
import { PageDataEndpointCache } from "./page-data-cache.ts";

const context = {
  projectDir: ".",
  projectId: "project-page-data-cache",
  projectSlug: "page-data-cache",
  releaseId: "release-page-data-cache",
  resolvedEnvironment: "production",
  config: {},
} as HandlerContext;

function pageData(value: string): PageDataResponse {
  return {
    slug: "index",
    pagePath: "pages/index.tsx",
    pageType: "tsx",
    layouts: [],
    providers: [],
    frontmatter: {},
    props: { value },
    params: {},
    layoutProps: {},
    buildVersion: { framework: "test", serverStart: 1 },
  };
}

function configuration(maxBytes: number) {
  return { ttlMs: 60_000, staleMs: 0, maxEntries: 10, maxBytes };
}

describe("PageDataEndpointCache", () => {
  it("serves but does not retain an entry larger than the memory budget", async () => {
    const cache = new PageDataEndpointCache(configuration(128));
    const req = new Request("http://localhost/_veryfront/page-data/index.json");
    let calls = 0;
    const resolve = () => {
      calls++;
      return Promise.resolve(pageData("x".repeat(512)));
    };

    const first = await cache.resolve(req, context, "index", new URL(req.url), resolve);
    const second = await cache.resolve(req, context, "index", new URL(req.url), resolve);

    assertEquals(first.cacheStrategy, { maxAge: 60, public: true });
    assertEquals(second.cacheStrategy, { maxAge: 60, public: true });
    assertEquals(calls, 2);
  });

  it("evicts least-recently-used entries to keep the total byte budget bounded", async () => {
    const data = pageData("bounded payload");
    const body = JSON.stringify(data);
    const estimatedBytes = Math.max(new TextEncoder().encode(body).byteLength, body.length * 2);
    const cache = new PageDataEndpointCache(configuration(estimatedBytes + 1));
    let calls = 0;

    const resolve = () => {
      calls++;
      return Promise.resolve(data);
    };
    for (const slug of ["first", "second", "first"]) {
      const req = new Request(`http://localhost/_veryfront/page-data/${slug}.json`);
      await cache.resolve(req, context, slug, new URL(req.url), resolve);
    }

    assertEquals(calls, 3);
  });
});
