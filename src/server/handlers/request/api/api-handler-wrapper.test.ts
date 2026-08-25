import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { ApiHandlerWrapper } from "./api-handler-wrapper.ts";
import { __injectDepsForTests as injectMemoryPressureDeps } from "#veryfront/server/shared/renderer/memory/pressure.ts";

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
    assertEquals(events.slice(0, 2), ["full-refresh", "resolve-page"]);
    assertEquals(events.includes("source-fresh"), false);
  });

  it("does not refresh a page document that SSR will shed for memory pressure", async () => {
    const ctx = createCtx({});
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    ctx.config = { router: "pages" };
    let refreshes = 0;
    let pageClassifications = 0;
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
      resolveFile: (path: string) => Promise<string | null>;
      symlinkSemantics: "none";
      readFile: (path: string) => Promise<string>;
      readFileBytesWithinLimit: (path: string, byteLimit: number) => Promise<Uint8Array>;
      refreshSourceSnapshot: () => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    fs.exists = () => Promise.resolve(false);
    fs.readDir = async function* () {};
    fs.resolveFile = (path) => {
      pageClassifications++;
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
    fs.readFileBytesWithinLimit = (path) => {
      if (path === "pages/review.tsx" || path === "/tmp/project/pages/review.tsx") {
        return Promise.resolve(
          new TextEncoder().encode("export default function Review() { return null; }"),
        );
      }
      return Promise.reject(new Error("File not found"));
    };
    fs.refreshSourceSnapshot = () => {
      refreshes++;
      return Promise.resolve();
    };
    injectMemoryPressureDeps({ getHeapStats: () => ({ heapUsedPercent: 99 }) });

    try {
      const result = await new ApiHandlerWrapper("/tmp/project", ctx.adapter).handle(
        new Request("http://localhost/review"),
        ctx,
      );
      assertEquals(result, { continue: true });
      assertEquals(refreshes, 0);
      assertEquals(
        pageClassifications > 0,
        true,
        "the shed shortcut must rest on real page ownership, not on the path shape alone",
      );
    } finally {
      injectMemoryPressureDeps(null);
    }
  });

  it("still classifies and serves an API-owned path under critical memory pressure", async () => {
    // An extensionless GET path can be owned by an API route
    // (app/webhook/route.ts). SSR's shed response only ever covers pages, so
    // deferring such a request to SSR would turn renderer overload into an
    // outage for API routes that never render anything.
    let refreshes = 0;
    const ctx = createCtx({});
    ctx.projectSlug = "pressured-api-project";
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
      refreshes++;
      return Promise.resolve();
    };
    injectMemoryPressureDeps({ getHeapStats: () => ({ heapUsedPercent: 99 }) });

    try {
      const result = await new ApiHandlerWrapper("/tmp/project", ctx.adapter).handle(
        new Request("http://localhost/new-webhook"),
        ctx,
      );

      // The wrapper must keep ownership of the request instead of deferring
      // to SSR's shed response: this shared runtime answers with its own
      // typed execution guard, proving the API flow ran.
      assertEquals(result.response?.status, 503);
      assertEquals(result.response?.headers.get("content-type"), "application/problem+json");
      const problem = await result.response!.json();
      assertEquals(
        problem.type,
        "https://veryfront.com/docs/code/guides/errors#project-execution-unavailable",
      );
      assertEquals(refreshes, 1, "an API-owned path keeps its leased freshness under pressure");
    } finally {
      injectMemoryPressureDeps(null);
    }
  });

  it("still refreshes a markdown preview document under critical memory pressure", async () => {
    // SSR never renders or sheds GET /file.md: MarkdownPreviewHandler serves
    // it even during overload, so the SSR shedding shortcut must not leave it
    // without a current source snapshot.
    const ctx = createCtx({});
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    let refreshes = 0;
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      refreshSourceSnapshot: () => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    fs.refreshSourceSnapshot = () => {
      refreshes++;
      return Promise.resolve();
    };
    injectMemoryPressureDeps({ getHeapStats: () => ({ heapUsedPercent: 99 }) });

    try {
      await new ApiHandlerWrapper("/tmp/project", ctx.adapter).handle(
        new Request("http://localhost/notes.md"),
        ctx,
      );
      assertEquals(
        refreshes,
        1,
        "a markdown document is served regardless of pressure, so it must be refreshed",
      );
    } finally {
      injectMemoryPressureDeps(null);
    }
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

  it("enters the requested branch before preview freshness and page classification", async () => {
    // A non-multi-project contextual adapter is reused across requests and
    // still points at the previous request's branch. Both the strict refresh
    // and the page/API ownership classification must run in the branch this
    // request addresses — the same context SSR later renders from.
    const events: string[] = [];
    let adapterBranch: string | null = "main"; // left over from the previous request
    const ctx = createCtx({});
    ctx.requestContext!.mode = "preview";
    ctx.requestContext!.branch = "feature";
    ctx.releaseId = undefined;
    ctx.config = { router: "pages" };
    ctx.parsedDomain = { branch: "feature" } as unknown as HandlerContext["parsedDomain"];
    const fs = ctx.adapter.fs as unknown as {
      isMultiProjectMode: () => boolean;
      isContextualMode: () => boolean;
      setRequestToken: (token: string) => void;
      setRequestBranch: (branch: string | null) => void;
      setProductionMode: (enabled: boolean, releaseId?: string | null) => void;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
      resolveFile: (path: string) => Promise<string | null>;
      symlinkSemantics: "none";
      readFile: (path: string) => Promise<string>;
      readFileBytesWithinLimit: (path: string, byteLimit: number) => Promise<Uint8Array>;
      refreshSourceSnapshot: () => Promise<void>;
    };
    fs.isMultiProjectMode = () => false;
    fs.isContextualMode = () => true;
    fs.setRequestToken = () => {};
    fs.setRequestBranch = (branch) => {
      adapterBranch = branch;
      events.push(`branch:${branch}`);
    };
    fs.setProductionMode = () => {};
    fs.exists = () => Promise.resolve(false);
    fs.readDir = async function* () {};
    fs.resolveFile = (path) => {
      events.push(`resolve:${adapterBranch}`);
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
    fs.readFileBytesWithinLimit = (path) => {
      if (path === "pages/review.tsx" || path === "/tmp/project/pages/review.tsx") {
        return Promise.resolve(
          new TextEncoder().encode("export default function Review() { return null; }"),
        );
      }
      return Promise.reject(new Error("File not found"));
    };
    fs.refreshSourceSnapshot = () => {
      events.push(`refresh:${adapterBranch}`);
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/review"), ctx);

    assertEquals(result, { continue: true });
    assertEquals(events[0], "branch:feature", "the adapter context must be entered first");
    assertEquals(events.includes("refresh:feature"), true);
    assertEquals(events.includes("resolve:feature"), true);
    assertEquals(
      events.some((event) => event.endsWith(":main")),
      false,
      "freshness and classification must see the requested branch, not the leftover one",
    );
  });

  it("forwards environmentName into multi-project request context", async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const handler = new ApiHandlerWrapper("/tmp/project", createCtx(captured).adapter);

    await handler.handle(new Request("http://localhost/api/test"), createCtx(captured));

    assertEquals(captured.options?.environmentName, "Staging");
    assertEquals(
      captured.options?.productionMode,
      true,
      "production requests must enter production context",
    );
    assertEquals(
      captured.options?.branch,
      null,
      "production must not carry a preview branch into the project context",
    );
  });

  it("forwards preview branch into multi-project request context", async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const ctx = createCtx(captured);
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    await handler.handle(new Request("http://localhost/api/test"), ctx);

    assertEquals(captured.options?.branch, "feature-branch");
    assertEquals(
      captured.options?.productionMode,
      false,
      "preview requests must not enter production context",
    );
  });
});
