import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  _resetShimForTests,
  type MetricsAPI,
  setGlobalMetricsAPI,
} from "#veryfront/observability/tracing/api-shim.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { metrics } from "#veryfront/metrics";
import { BaseHandler } from "./base-handler.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "#veryfront/types";

class TestHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "TestHandler",
    priority: 50 as HandlerPriority,
    patterns: [],
  };

  async handle(_req: Request, _ctx: HandlerContext): Promise<HandlerResult> {
    return this.continue();
  }

  // Expose withProxyContext for testing
  testWithProxyContext<T>(
    ctx: HandlerContext,
    fn: () => Promise<T>,
    options?: {
      requireToken?: boolean;
    },
  ): Promise<T> {
    return this.withProxyContext(ctx, fn, options);
  }
}

function createMinimalCtx(
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    url: new URL("http://localhost/_vf_modules/test"),
    adapter: {
      fs: {},
    },
    ...overrides,
  } as unknown as HandlerContext;
}

describe("BaseHandler.withProxyContext", () => {
  afterEach(() => {
    try {
      deleteEnv("VERYFRONT_API_TOKEN");
    } catch {
      // expected
    }
    _resetShimForTests();
    metrics.__resetForTests();
  });

  it("runs fn() in local dev mode (no projectSlug)", async () => {
    const handler = new TestHandler();
    let called = false;

    await handler.testWithProxyContext(
      createMinimalCtx({ projectSlug: undefined }),
      async () => {
        called = true;
        return { continue: true };
      },
      { requireToken: true },
    );

    assertEquals(called, true, "fn should run in local dev mode");
  });

  it("runs fn() without proxy context when requireToken is true but no token", async () => {
    const handler = new TestHandler();
    let called = false;

    await handler.testWithProxyContext(
      createMinimalCtx({ projectSlug: "my-project" }),
      async () => {
        called = true;
        return { continue: true } as HandlerResult;
      },
      { requireToken: true },
    );

    // fn() should still run so embedded framework modules can be served,
    // but without project-scoped credentials (no setRequestToken call)
    assertEquals(
      called,
      true,
      "fn should run without proxy context so embedded modules work",
    );
  });

  it("runs fn() when requireToken is true and token is present", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_token");
    const handler = new TestHandler();
    let called = false;

    await handler.testWithProxyContext(
      createMinimalCtx({ projectSlug: "my-project" }),
      async () => {
        called = true;
        return { continue: true };
      },
      { requireToken: true },
    );

    assertEquals(called, true, "fn should run with valid token");
  });

  it("runs fn() when requireToken is false even without token", async () => {
    const handler = new TestHandler();
    let called = false;

    await handler.testWithProxyContext(
      createMinimalCtx({ projectSlug: "my-project" }),
      async () => {
        called = true;
        return { continue: true };
      },
      { requireToken: false },
    );

    assertEquals(called, true, "fn should run when token not required");
  });

  it("runs fn() when requireToken is not specified (defaults to false)", async () => {
    const handler = new TestHandler();
    let called = false;

    await handler.testWithProxyContext(
      createMinimalCtx({ projectSlug: "my-project" }),
      async () => {
        called = true;
        return { continue: true };
      },
    );

    assertEquals(called, true, "fn should run with default requireToken");
  });

  it("accepts proxyToken from context as valid token", async () => {
    const handler = new TestHandler();
    let called = false;

    await handler.testWithProxyContext(
      createMinimalCtx({
        projectSlug: "my-project",
        proxyToken: "vf_proxy_token",
      }),
      async () => {
        called = true;
        return { continue: true };
      },
      { requireToken: true },
    );

    assertEquals(called, true, "fn should run with proxyToken");
  });

  it("emits metrics with project and environment labels in multi-project request context", async () => {
    const handler = new TestHandler();
    const counterCalls: unknown[] = [];

    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter(name: string) {
            return {
              add(value: number, attributes?: Record<string, unknown>) {
                counterCalls.push({ name, value, attributes });
              },
            };
          },
          createHistogram() {
            return { record() {} };
          },
          createUpDownCounter() {
            return { add() {} };
          },
          createObservableGauge() {
            return { addCallback() {} };
          },
        };
      },
    } as MetricsAPI);

    const ctx = createMinimalCtx({
      projectSlug: "my-project",
      projectId: "project-123",
      proxyToken: "vf_proxy_token",
      releaseId: "release-123",
      resolvedEnvironment: "production",
      environmentName: "Staging",
      adapter: {
        fs: {
          setRequestBranch() {},
          isMultiProjectMode: () => true,
          runWithContext: async (
            _slug: string,
            _token: string,
            fn: () => Promise<unknown>,
            _projectId?: string,
            options?: Record<string, unknown>,
          ) => {
            return await runWithRequestContext(
              {
                projectSlug: "my-project",
                token: "vf_proxy_token",
                projectId: "project-123",
                productionMode: options?.productionMode === true,
                releaseId: options?.releaseId as string | undefined,
                branch: options?.branch as string | undefined,
                environmentName: options?.environmentName as string | undefined,
              },
              fn,
            );
          },
        },
      } as unknown as HandlerContext["adapter"],
    });

    await handler.testWithProxyContext(ctx, async () => {
      metrics.counter("vf_proxy_context_total", 1, {
        project_id: "spoofed-project",
        source: "test",
      });
      return { continue: true };
    });

    assertEquals(counterCalls, [
      {
        name: "vf_proxy_context_total",
        value: 1,
        attributes: {
          project_id: "project-123",
          project_slug: "my-project",
          environment: "Staging",
          source: "test",
        },
      },
    ]);
  });
});
