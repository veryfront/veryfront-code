import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { ApiHandlerWrapper } from "./api-handler-wrapper.ts";

function createCtx(captured: { options?: Record<string, unknown> }): HandlerContext {
  return {
    projectDir: "/tmp/project",
    adapter: {
      fs: {
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        runWithContext: async (
          _slug: string,
          _token: string,
          _fn: () => Promise<unknown>,
          _projectId?: string,
          options?: Record<string, unknown>,
        ) => {
          captured.options = options;
          return { continue: true };
        },
      },
      env: { get: () => undefined },
    },
    securityConfig: null,
    projectSlug: "my-project",
    projectId: "project-123",
    proxyToken: "vf_proxy_token",
    releaseId: "release-123",
    environmentName: "Staging",
    requestContext: {
      token: "vf_proxy_token",
      branch: "feature-branch",
      mode: "production",
    },
  } as unknown as HandlerContext;
}

describe("ApiHandlerWrapper", () => {
  it("propagates request cancellation instead of continuing handler discovery", async () => {
    const ctx = createCtx({});
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);
    const controller = new AbortController();
    const request = new Request("http://localhost/review", { signal: controller.signal });
    // Bun's synthetic Request follower can lose a custom reason after other
    // network tests, so keep the fixture's cancellation source explicit.
    Object.defineProperty(request, "signal", { value: controller.signal });
    controller.abort(new Error("request cancelled"));

    await assertRejects(
      () => handler.handle(request, ctx),
      Error,
      "request cancelled",
    );
  });

  it("routes known pages without remote stat misses or full API discovery", async () => {
    let enteredProjectContext = false;
    let remoteStatMisses = 0;
    let primitiveDiscoveryChecks = 0;
    let apiRouteChecks = 0;
    let sourceSnapshotRefreshes = 0;
    let pageReads = 0;
    const ctx = createCtx({});
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      stat: (path: string) => Promise<unknown>;
      readDir: (path: string) => AsyncIterable<{
        name: string;
        isFile: boolean;
        isDirectory: boolean;
        isSymlink: boolean;
      }>;
      resolveFile: (path: string) => Promise<string | null>;
      symlinkSemantics: "none";
      readFile: (path: string) => Promise<string>;
      readFileBytesWithinLimit: (path: string, byteLimit: number) => Promise<Uint8Array>;
      refreshSourceSnapshot: (reason?: string) => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => {
      enteredProjectContext = true;
      return await fn();
    };
    fs.exists = (path) => {
      if (path.endsWith("/pages/api") || path.endsWith("/app")) {
        apiRouteChecks++;
      } else {
        primitiveDiscoveryChecks++;
      }
      return Promise.resolve(false);
    };
    fs.stat = () => {
      remoteStatMisses++;
      return Promise.reject(new Error("File not found"));
    };
    fs.readDir = async function* (path) {
      if (path === "/tmp/project") {
        yield { name: "pages", isFile: false, isDirectory: true, isSymlink: false };
      } else if (path === "/tmp/project/pages") {
        yield { name: "index.tsx", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "review.tsx", isFile: true, isDirectory: false, isSymlink: false };
      }
    };
    fs.resolveFile = (path) =>
      Promise.resolve(
        path === "/tmp/project/pages/review" ? "/tmp/project/pages/review.tsx" : null,
      );
    fs.symlinkSemantics = "none";
    fs.readFile = (path) => {
      if (path === "/tmp/project/pages/review.tsx" || path === "pages/review.tsx") {
        return Promise.resolve("export default function Review() { return null; }");
      }
      return Promise.reject(new Error("File not found"));
    };
    fs.readFileBytesWithinLimit = (path, byteLimit) => {
      if (path === "/tmp/project/pages/review.tsx" || path === "pages/review.tsx") {
        pageReads++;
        const source = new TextEncoder().encode(
          "export default function Review() { return null; }",
        );
        if (source.byteLength > byteLimit) {
          return Promise.reject(new Error("File exceeds byte limit"));
        }
        return Promise.resolve(source);
      }
      return Promise.reject(new Error("File not found"));
    };
    fs.refreshSourceSnapshot = () => {
      sourceSnapshotRefreshes++;
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/review"), ctx);

    assertEquals(result, { continue: true });
    assertEquals(enteredProjectContext, true);
    assertEquals(remoteStatMisses, 0);
    assertEquals(pageReads, 1);
    assertEquals(primitiveDiscoveryChecks, 0);
    assertEquals(apiRouteChecks, 0);
    assertEquals(sourceSnapshotRefreshes, 0);
  });

  it("checks preview source freshness before resolving page ownership", async () => {
    const events: string[] = [];
    const ctx = createCtx({});
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    ctx.config = { router: "pages" };
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      ensureSourceSnapshotFresh: (reason?: string) => Promise<void>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
      resolveFile: (path: string) => Promise<string | null>;
      symlinkSemantics: "none";
      readFile: (path: string) => Promise<string>;
      readFileBytesWithinLimit: (path: string, byteLimit: number) => Promise<Uint8Array>;
      refreshSourceSnapshot: (reason?: string) => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    fs.ensureSourceSnapshotFresh = () => {
      events.push("source-fresh");
      return Promise.resolve();
    };
    fs.exists = () => Promise.resolve(false);
    fs.readDir = async function* () {};
    fs.resolveFile = (path) => {
      events.push("resolve-page");
      return Promise.resolve(
        path === "/tmp/project/pages/review" ? "/tmp/project/pages/review.tsx" : null,
      );
    };
    fs.symlinkSemantics = "none";
    fs.readFile = (path) => {
      if (path === "pages/review.tsx" || path === "/tmp/project/pages/review.tsx") {
        return Promise.resolve("export default function Review() { return null; }");
      }
      return Promise.reject(new Error("File not found"));
    };
    fs.readFileBytesWithinLimit = (path, byteLimit) => {
      if (path === "pages/review.tsx" || path === "/tmp/project/pages/review.tsx") {
        const source = new TextEncoder().encode(
          "export default function Review() { return null; }",
        );
        if (source.byteLength > byteLimit) {
          return Promise.reject(new Error("File exceeds byte limit"));
        }
        return Promise.resolve(source);
      }
      return Promise.reject(new Error("File not found"));
    };
    fs.refreshSourceSnapshot = () => {
      events.push("full-refresh");
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/review"), ctx);

    assertEquals(result, { continue: true });
    assertEquals(events.slice(0, 2), ["source-fresh", "resolve-page"]);
    assertEquals(events.includes("full-refresh"), false);
  });

  it("preserves fresh API discovery when no page owns a non-API path", async () => {
    let sourceSnapshotRefreshes = 0;
    const ctx = createCtx({});
    ctx.projectSlug = "unmatched-preview-project";
    ctx.config = { router: "pages" };
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
      resolveFile: (path: string) => Promise<string | null>;
      readFile: (path: string) => Promise<string>;
      refreshSourceSnapshot: (reason?: string) => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    fs.exists = () => Promise.resolve(false);
    fs.readDir = async function* () {};
    fs.resolveFile = () => Promise.resolve(null);
    fs.readFile = () => Promise.reject(new Error("File not found"));
    fs.refreshSourceSnapshot = () => {
      sourceSnapshotRefreshes++;
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/new-webhook"), ctx);

    assertEquals(result.response?.status, 503);
    assertEquals(result.response?.headers.get("content-type"), "application/problem+json");
    assertEquals(sourceSnapshotRefreshes, 1);
  });

  it("keeps the exact /api path in the API handler flow", async () => {
    let sourceSnapshotRefreshes = 0;
    const ctx = createCtx({});
    ctx.projectSlug = "exact-api-preview-project";
    ctx.config = { router: "pages" };
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
      readFile: (path: string) => Promise<string>;
      refreshSourceSnapshot: (reason?: string) => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    fs.exists = () => Promise.resolve(false);
    fs.readDir = async function* () {};
    fs.readFile = () => Promise.reject(new Error("File not found"));
    fs.refreshSourceSnapshot = () => {
      sourceSnapshotRefreshes++;
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/api"), ctx);

    assertEquals(result.response?.status, 503);
    assertEquals(sourceSnapshotRefreshes, 0);
  });

  it("never starts shared-runtime API discovery or a same-process Worker", async () => {
    let projectContextEntries = 0;
    let filesystemReads = 0;
    const ctx = createCtx({});
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
    };
    fs.runWithContext = async (_slug, _token, fn) => {
      projectContextEntries++;
      return await fn();
    };
    fs.exists = () => {
      filesystemReads++;
      return Promise.resolve(true);
    };
    fs.readDir = async function* () {
      filesystemReads++;
      yield* [];
    };

    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);
    const result = await handler.handle(
      new Request("http://localhost/api/private"),
      ctx,
    );

    assertEquals(result.response?.status, 503);
    assertEquals(projectContextEntries, 1);
    assertEquals(filesystemReads, 0);
    const problem = await result.response!.json();
    assertEquals(
      problem.type,
      "https://veryfront.com/docs/code/guides/errors#project-execution-unavailable",
    );
  });

  it("starts shared-runtime API discovery once the host grants execution", async () => {
    // The granted counterpart of the fail-closed case above. Without this,
    // nothing pins that the operator grant actually reaches this surface.
    let projectContextEntries = 0;
    let filesystemReads = 0;
    const ctx = createCtx({});
    ctx.allowHostProjectCodeExecution = true;
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
    };
    fs.runWithContext = async (_slug, _token, fn) => {
      projectContextEntries++;
      return await fn();
    };
    fs.exists = () => {
      filesystemReads++;
      return Promise.resolve(false);
    };
    fs.readDir = async function* () {
      filesystemReads++;
      yield* [];
    };

    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);
    const result = await handler.handle(
      new Request("http://localhost/api/private"),
      ctx,
    );

    assertNotEquals(
      result.response?.status,
      503,
      "a granted shared executor must not return project-execution-unavailable",
    );
    assertEquals(projectContextEntries, 1);
    assertEquals(
      filesystemReads > 0,
      true,
      "the request must reach source resolution instead of failing at the guard",
    );
  });

  it("forwards environmentName into multi-project request context", async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const handler = new ApiHandlerWrapper("/tmp/project", createCtx(captured).adapter);

    await handler.handle(new Request("http://localhost/api/test"), createCtx(captured));

    assertEquals(captured.options?.environmentName, "Staging");
  });

  it("forwards preview branch into multi-project request context", async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const ctx = createCtx(captured);
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    await handler.handle(new Request("http://localhost/api/test"), ctx);

    assertEquals(captured.options?.branch, "feature-branch");
  });
});
