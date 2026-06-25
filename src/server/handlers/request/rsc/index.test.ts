import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RSCHandler } from "./index.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(
  overrides: Partial<RuntimeAdapter["fs"]> = {},
): RuntimeAdapter {
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
      ...overrides,
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
    adapter: createMockAdapter(),
    securityConfig: {},
    cspUserHeader: null,
    config: { experimental: { rsc: true } } as HandlerContext["config"],
    parsedDomain: { allowIframeEmbed: false } as HandlerContext["parsedDomain"],
    ...overrides,
  } as HandlerContext;
}

describe("server/handlers/request/rsc", () => {
  it("keeps the CSP nonce aligned with inline page bootstrap scripts", async () => {
    const handler = new RSCHandler();
    const result = await handler.handle(
      new Request("http://localhost/_veryfront/rsc/page"),
      makeCtx(),
    );

    const response = result.response!;
    const html = await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonceMatch = csp.match(/nonce-([^' ;]+)/);

    assertEquals(Boolean(nonceMatch), true);
    const nonce = nonceMatch![1]!;

    assertEquals(
      html.includes(`<script nonce="${nonce}">window.__VERYFRONT_DEV__ = true;</script>`),
      true,
    );
    assertEquals(html.includes(`<script type="module" nonce="${nonce}">`), true);
  });

  it("passes app router client module requests through without the experimental RSC flag", async () => {
    const handler = new RSCHandler();

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/rsc/module"),
      makeCtx({
        config: {} as HandlerContext["config"],
      }),
    );

    const response = result.response!;
    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Missing rel query parameter");
  });

  it("serves app router client module requests inside the multi-project filesystem context", async () => {
    const handler = new RSCHandler();
    let contextActive = false;
    let runWithContextArgs: unknown[] | undefined;
    const adapter = createMockAdapter({
      exists: () => {
        if (!contextActive) {
          throw new Error("missing multi-project context");
        }
        return Promise.resolve(false);
      },
    });

    adapter.fs = {
      ...adapter.fs,
      isVeryfrontAdapter: () => true,
      getUnderlyingAdapter: () => ({}),
      isMultiProjectMode: () => true,
      isContextualMode: () => false,
      runWithContext: async (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
        projectId?: string,
        options?: unknown,
      ) => {
        runWithContextArgs = [slug, token, projectId, options];
        contextActive = true;
        try {
          return await fn();
        } finally {
          contextActive = false;
        }
      },
    } as RuntimeAdapter["fs"];

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/rsc/module?rel=app%2Fpage.tsx"),
      makeCtx({
        adapter,
        projectSlug: "customer-operations-agent",
        projectId: "proj-123",
        proxyToken: "proxy-token",
        releaseId: "rel-123",
        environmentName: "Preview",
        resolvedEnvironment: "preview",
        requestContext: {
          slug: "customer-operations-agent",
          branch: "main",
          mode: "preview",
          token: "proxy-token",
        },
      }),
    );

    const response = result.response!;
    assertEquals(response.status, 404);
    assertEquals(runWithContextArgs?.[0], "customer-operations-agent");
    assertEquals(runWithContextArgs?.[1], "proxy-token");
    assertEquals(runWithContextArgs?.[2], "proj-123");
    assertEquals(runWithContextArgs?.[3], {
      productionMode: false,
      releaseId: "rel-123",
      branch: "main",
      environmentName: "Preview",
    });
  });
});
