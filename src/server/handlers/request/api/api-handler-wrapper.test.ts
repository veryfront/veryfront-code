import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
    cspUserHeader: null,
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
      readFile: (path: string) => Promise<string>;
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
    fs.readFile = (path) => {
      if (path === "/tmp/project/pages/review.tsx" || path === "pages/review.tsx") {
        pageReads++;
        return Promise.resolve("export default function Review() { return null; }");
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
      readFile: (path: string) => Promise<string>;
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
    fs.readFile = (path) => {
      if (path === "pages/review.tsx" || path === "/tmp/project/pages/review.tsx") {
        return Promise.resolve("export default function Review() { return null; }");
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

    assertEquals(result, { continue: true });
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

    assertEquals(result.response?.status, 404);
    assertEquals(sourceSnapshotRefreshes, 1);
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
