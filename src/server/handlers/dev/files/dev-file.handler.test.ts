import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";
import type { HandlerContext } from "../../types.ts";
import { DevFileHandler } from "./dev-file.handler.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  } as HandlerContext;
}

function createProxyPreviewAdapter() {
  const base = createMockAdapter();
  const calls: string[] = [];
  let inContext = false;

  const fs = {
    ...base.fs,
    stat: async (path: string) => {
      calls.push(`stat:${path}`);
      if (!inContext) throw new Error("missing proxy context");
      return await base.fs.stat(path);
    },
    readFile: async (path: string) => {
      calls.push(`readFile:${path}`);
      if (!inContext) throw new Error("missing proxy context");
      return await base.fs.readFile(path);
    },
    isVeryfrontAdapter: () => true,
    getUnderlyingAdapter: () => ({}),
    getAdapterType: () => "VeryfrontFSAdapter",
    isMultiProjectMode: () => true,
    isContextualMode: () => true,
    runWithContext: async (
      _slug: string,
      _token: string,
      fn: () => Promise<unknown>,
      _projectId?: string,
      _options?: Record<string, unknown>,
    ) => {
      calls.push("runWithContext");
      inContext = true;
      try {
        return await fn();
      } finally {
        inContext = false;
      }
    },
    setRequestToken: (_token: string) => {
      calls.push("setRequestToken");
    },
    setRequestBranch: (_branch: string | null) => {
      calls.push("setRequestBranch");
    },
    setProductionMode: (_enabled: boolean, _releaseId?: string | null) => {
      calls.push("setProductionMode");
    },
  };

  return {
    adapter: {
      ...base,
      fs,
    },
    calls,
  };
}

describe(
  "server/handlers/dev/files/dev-file.handler",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    afterEach(async () => {
      const esbuild = await import("esbuild");
      esbuild.stop();
    });

    it("serves preview file modules for remote preview mode", async () => {
      const handler = new DevFileHandler();
      const adapter = createMockAdapter();
      const modulePath = "/project/app/page.tsx";
      adapter.fs.files.set(
        modulePath,
        "export default function Page() { return 'preview'; }",
      );

      const encodedPath = base64urlEncode("app/page.tsx");
      const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
      const ctx = makeCtx({
        adapter,
        isLocalProject: false,
        requestContext: { mode: "preview" } as HandlerContext["requestContext"],
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 200);
      const body = await result.response!.text();
      assertEquals(body.includes("preview"), true);
    });

    it("uses proxy fs context for remote preview modules", async () => {
      const handler = new DevFileHandler();
      const { adapter, calls } = createProxyPreviewAdapter();
      const modulePath = "/project/app/page.tsx";
      adapter.fs.files.set(
        modulePath,
        "export default function Page() { return 'preview-proxy'; }",
      );

      const encodedPath = base64urlEncode("app/page.tsx");
      const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
      const ctx = makeCtx({
        adapter: adapter as HandlerContext["adapter"],
        isLocalProject: false,
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: "test-token",
        releaseId: "rel-1",
        environmentName: "staging",
        parsedDomain: { branch: "feature-x" } as HandlerContext["parsedDomain"],
        requestContext: { mode: "preview" } as HandlerContext["requestContext"],
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 200);
      assertEquals(calls.includes("runWithContext"), true);
      const body = await result.response!.text();
      assertEquals(body.includes("preview-proxy"), true);
    });

    it("continues for non-local production requests", async () => {
      const handler = new DevFileHandler();
      const encodedPath = base64urlEncode("app/page.tsx");
      const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as HandlerContext["requestContext"],
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
    });
  },
);
