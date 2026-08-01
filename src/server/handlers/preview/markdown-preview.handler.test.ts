import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { NotSupportedError } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { MarkdownPreviewHandler } from "./markdown-preview.handler.ts";
import type { HandlerContext } from "../types.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    ...overrides,
  } as HandlerContext;
}

describe("MarkdownPreviewHandler.metadata.enabled", () => {
  it("is enabled for a local project", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({ isLocalProject: true });
    assertEquals(handler.metadata.enabled?.(ctx), true);
  });

  it("is enabled for host-derived preview (mode: preview)", () => {
    // After VULN-SRV-1/2 fix, requestContext.mode === 'preview' only happens
    // when the Host / X-Forwarded-Host is server-trusted preview. The
    // x-environment client header is ignored — see request-context.test.ts.
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({
      isLocalProject: false,
      requestContext: { mode: "preview" } as HandlerContext["requestContext"],
    });
    assertEquals(handler.metadata.enabled?.(ctx), true);
  });

  it("is NOT enabled for a non-local production request", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({
      isLocalProject: false,
      requestContext: { mode: "production" } as HandlerContext["requestContext"],
    });
    assertEquals(handler.metadata.enabled?.(ctx), false);
  });

  it("is NOT enabled when no request context and not a local project", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({ isLocalProject: false });
    assertEquals(handler.metadata.enabled?.(ctx), false);
  });
});

describe("MarkdownPreviewHandler path admission", () => {
  it("reads the canonical project path when the project root differs from cwd", async () => {
    const adapter = createMockAdapter();
    let readPath: string | undefined;
    adapter.fs.readFile = (path: string) => {
      readPath = path;
      return Promise.resolve("---\nprose: false\n---\n# Not rendered");
    };

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/docs/readme.md"),
      makeCtx({
        projectDir: "/workspace/project",
        adapter,
        isLocalProject: true,
      }),
    );

    assertEquals(readPath, "/workspace/project/docs/readme.md");
    assertEquals(result.continue, true);
  });

  it("rejects an adapter-resolved path outside the project before reading", async () => {
    const adapter = createMockAdapter();
    const readPaths: string[] = [];
    adapter.fs.resolveFile = () => Promise.resolve("/outside/secret.md");
    adapter.fs.readFile = (path: string) => {
      readPaths.push(path);
      return Promise.resolve("secret");
    };

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/docs/readme.md"),
      makeCtx({
        projectDir: "/workspace/project",
        adapter,
        isLocalProject: true,
      }),
    );

    assertEquals(readPaths, []);
    assertEquals(result.continue, true);
  });
});

describe("MarkdownPreviewHandler filesystem and rendering failures", () => {
  function previewRequest(): Request {
    return new Request("http://localhost/docs/readme.md");
  }

  function previewContext(): HandlerContext {
    return makeCtx({
      adapter: createMockAdapter(),
      isLocalProject: true,
      securityConfig: {},
      cspUserHeader: null,
    });
  }

  it("returns the fallback response when resolution reports canonical absence", async () => {
    const ctx = previewContext();
    ctx.adapter.fs.resolveFile = () => Promise.reject(new Deno.errors.NotFound("missing markdown"));
    const handler = new MarkdownPreviewHandler(
      undefined,
      undefined,
      () =>
        Promise.resolve(
          new Response("resolve fallback", {
            status: 404,
            headers: { "x-preview-fallback": "resolve" },
          }),
        ),
    );

    const result = await handler.handle(previewRequest(), ctx);

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    assertEquals(result.response.headers.get("x-preview-fallback"), "resolve");
    assertEquals(await result.response.text(), "resolve fallback");
  });

  it("returns the fallback response when reading reports canonical absence", async () => {
    const ctx = previewContext();
    ctx.adapter.fs.readFile = () => Promise.reject(new Deno.errors.NotFound("missing markdown"));
    const handler = new MarkdownPreviewHandler(
      undefined,
      undefined,
      () =>
        Promise.resolve(
          new Response("read fallback", {
            status: 404,
            headers: { "x-preview-fallback": "read" },
          }),
        ),
    );

    const result = await handler.handle(previewRequest(), ctx);

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    assertEquals(result.response.headers.get("x-preview-fallback"), "read");
    assertEquals(await result.response.text(), "read fallback");
  });

  it("continues when readFile reports canonical absence and the fallback returns null", async () => {
    const ctx = previewContext();
    ctx.adapter.fs.readFile = () => Promise.reject(new Deno.errors.NotFound("missing markdown"));
    let fallbackCalls = 0;
    const handler = new MarkdownPreviewHandler(
      undefined,
      undefined,
      () => {
        fallbackCalls++;
        return Promise.resolve(null);
      },
    );

    const result = await handler.handle(previewRequest(), ctx);

    assertEquals(fallbackCalls, 1);
    assertEquals(result.continue, true);
  });

  for (const operation of ["resolveFile", "readFile"] as const) {
    for (
      const [label, failure] of [
        ["an EACCES failure", Object.assign(new Error("access denied"), { code: "EACCES" })],
        ["an EIO failure", Object.assign(new Error("I/O failure"), { code: "EIO" })],
        ["an arbitrary failure", new Error("unexpected filesystem failure")],
        ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
      ] as const
    ) {
      it(`propagates ${label} from ${operation} unchanged`, async () => {
        const ctx = previewContext();
        if (operation === "resolveFile") {
          ctx.adapter.fs.resolveFile = () => Promise.reject(failure);
        } else {
          ctx.adapter.fs.readFile = () => Promise.reject(failure);
        }

        const actual = await assertRejects(() =>
          new MarkdownPreviewHandler().handle(previewRequest(), ctx)
        );

        assertStrictEquals(actual, failure);
      });
    }

    it(`propagates a hostile rejection from ${operation} unchanged`, async () => {
      const failure = new Proxy({}, {
        get() {
          throw new Error("filesystem rejection must not be inspected");
        },
      });
      const ctx = previewContext();
      if (operation === "resolveFile") {
        ctx.adapter.fs.resolveFile = () => Promise.reject(failure);
      } else {
        ctx.adapter.fs.readFile = () => Promise.reject(failure);
      }

      let actual: unknown;
      try {
        await new MarkdownPreviewHandler().handle(previewRequest(), ctx);
      } catch (error) {
        actual = error;
      }

      assertEquals(Object.is(actual, failure), true);
    });
  }

  it("propagates the markdown compiler failure unchanged", async () => {
    const ctx = previewContext();
    ctx.adapter.fs.readFile = () => Promise.resolve("# Preview");
    const failure = new Error("markdown compiler failed");
    const handler = new MarkdownPreviewHandler(async () => {
      throw failure;
    });

    const actual = await assertRejects(() => handler.handle(previewRequest(), ctx));

    assertStrictEquals(actual, failure);
  });

  it("propagates the markdown HTML generator failure unchanged", async () => {
    const ctx = previewContext();
    ctx.adapter.fs.readFile = () => Promise.resolve("# Preview");
    const failure = new Error("markdown HTML generator failed");
    const handler = new MarkdownPreviewHandler(
      async () => ({
        compiledCode: "",
        frontmatter: {},
        globals: {},
        rawHtml: "<h1>Preview</h1>",
      }),
      () => {
        throw failure;
      },
    );

    const actual = await assertRejects(() => handler.handle(previewRequest(), ctx));

    assertStrictEquals(actual, failure);
  });
});

describe("MarkdownPreviewHandler contextual filesystem setup", () => {
  type ContextSetter = "setRequestToken" | "setRequestBranch" | "setProductionMode";

  const contextSetters = [
    "setRequestToken",
    "setRequestBranch",
    "setProductionMode",
  ] as const satisfies readonly ContextSetter[];

  const callsThroughFailure: Record<ContextSetter, ContextSetter[]> = {
    setRequestToken: ["setRequestToken"],
    setRequestBranch: ["setRequestToken", "setRequestBranch"],
    setProductionMode: ["setRequestToken", "setRequestBranch", "setProductionMode"],
  };

  function contextualPreviewContext(
    failingSetter: ContextSetter,
    failure: unknown,
  ): { ctx: HandlerContext; calls: string[] } {
    const calls: string[] = [];
    const adapter = createMockAdapter();
    const invokeSetter = (setter: ContextSetter): void => {
      calls.push(setter);
      if (setter === failingSetter) throw failure;
    };
    const fs = {
      ...adapter.fs,
      symlinkSemantics: "none" as const,
      readFile: () => {
        calls.push("readFile");
        return Promise.resolve("# Preview");
      },
      isVeryfrontAdapter: () => true,
      getUnderlyingAdapter: () => ({}),
      isMultiProjectMode: () => false,
      isContextualMode: () => true,
      setRequestToken: () => {
        invokeSetter("setRequestToken");
      },
      setRequestBranch: () => {
        invokeSetter("setRequestBranch");
      },
      setProductionMode: () => {
        invokeSetter("setProductionMode");
      },
    };

    return {
      ctx: makeCtx({
        adapter: { ...adapter, fs },
        isLocalProject: true,
        proxyToken: "preview-token",
        securityConfig: {},
        cspUserHeader: null,
      }),
      calls,
    };
  }

  function previewHandler(): MarkdownPreviewHandler {
    return new MarkdownPreviewHandler(async () => ({
      compiledCode: "",
      frontmatter: {},
      globals: {},
      rawHtml: "<h1>Preview</h1>",
    }));
  }

  for (const setter of contextSetters) {
    it(`tolerates canonical NotSupportedError from ${setter} and continues in order`, async () => {
      const { ctx, calls } = contextualPreviewContext(
        setter,
        new NotSupportedError(setter, "test adapter"),
      );

      const result = await previewHandler().handle(
        new Request("http://localhost/docs/readme.md"),
        ctx,
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertStringIncludes(await result.response.text(), "<h1>Preview</h1>");
      assertEquals(calls, [
        "setRequestToken",
        "setRequestBranch",
        "setProductionMode",
        "readFile",
      ]);
    });
  }

  const noncanonicalFailures = [
    {
      label: "a NotSupportedError-named Error",
      create: () =>
        Object.assign(new Error("Operation is not supported"), {
          name: "NotSupportedError",
        }),
    },
    {
      label: "a hostile Proxy",
      create: () =>
        new Proxy({}, {
          get() {
            throw new Error("context failure must not be inspected");
          },
          getPrototypeOf() {
            throw new Error("context failure prototype must not escape");
          },
        }),
    },
  ] as const;

  for (const setter of contextSetters) {
    for (const testCase of noncanonicalFailures) {
      it(`propagates ${testCase.label} from ${setter} unchanged and stops setup`, async () => {
        const failure = testCase.create();
        const { ctx, calls } = contextualPreviewContext(setter, failure);

        let actual: unknown;
        try {
          await previewHandler().handle(
            new Request("http://localhost/docs/readme.md"),
            ctx,
          );
        } catch (error) {
          actual = error;
        }

        assertEquals(Object.is(actual, failure), true);
        assertEquals(calls, callsThroughFailure[setter]);
      });
    }
  }
});
