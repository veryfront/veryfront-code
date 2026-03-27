import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
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
    options?: { requireToken?: boolean },
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
});
