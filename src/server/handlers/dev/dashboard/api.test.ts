import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleDashboardAPI } from "./api.ts";
import type { HandlerContext } from "../../types.ts";

// Minimal mock adapter with fs that tracks readDir/readFile calls
function createMockCtx(): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      fs: {
        readDir: async function* () {},
        readFile: async () => new Uint8Array(),
      },
    },
    securityConfig: null,
    cspUserHeader: null,
    isLocalProject: true,
  } as unknown as HandlerContext;
}

function createMockCtxWithFs(fsOverrides: Record<string, unknown> = {}): HandlerContext {
  return {
    ...createMockCtx(),
    adapter: {
      fs: {
        readDir: async function* () {},
        readFile: async () => "file content",
        ...fsOverrides,
      },
    },
  } as unknown as HandlerContext;
}

describe("Dashboard API - auth", () => {
  it("returns 401 for non-local project", async () => {
    const ctx = { ...createMockCtx(), isLocalProject: false } as unknown as HandlerContext;
    const req = new Request("http://localhost/_dev/api/stats");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 401);
  });
});

describe("Dashboard API - GET endpoints", () => {
  it("/_dev/api/stats returns stats with expected keys", async () => {
    const req = new Request("http://localhost/_dev/api/stats");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("mcp" in body, true);
    assertEquals("agents" in body, true);
    assertEquals("workflows" in body, true);
    assertEquals("timestamp" in body, true);
  });

  it("/_dev/api/tools returns tools list", async () => {
    const req = new Request("http://localhost/_dev/api/tools");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("tools" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/resources returns resources list", async () => {
    const req = new Request("http://localhost/_dev/api/resources");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("resources" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/prompts returns prompts list", async () => {
    const req = new Request("http://localhost/_dev/api/prompts");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("prompts" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/agents returns agents list", async () => {
    const req = new Request("http://localhost/_dev/api/agents");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("agents" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/workflows returns workflows list", async () => {
    const req = new Request("http://localhost/_dev/api/workflows");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("workflows" in body, true);
    assertEquals("count" in body, true);
    assertEquals("stats" in body, true);
  });

  it("/_dev/api/handlers returns empty when no routeRegistry", async () => {
    const req = new Request("http://localhost/_dev/api/handlers");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.handlers, []);
    assertEquals(body.count, 0);
    assertEquals("error" in body, true);
  });

  it("/_dev/api/handlers returns handler list when routeRegistry exists", async () => {
    const ctx = {
      ...createMockCtx(),
      routeRegistry: {
        getHandlers: () => [
          {
            metadata: {
              name: "TestHandler",
              priority: 100,
              patterns: [{ pattern: /^\/test/, method: ["GET"] }],
            },
          },
        ],
        getStats: () => ({ totalHandlers: 1 }),
      },
    } as unknown as HandlerContext;
    const req = new Request("http://localhost/_dev/api/handlers");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.count, 1);
    assertEquals(body.handlers[0].name, "TestHandler");
  });

  it("/_dev/api/metrics returns metrics snapshot", async () => {
    const req = new Request("http://localhost/_dev/api/metrics");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("counters" in body, true);
    assertEquals("timestamp" in body, true);
  });

  it("/_dev/api/infrastructure returns providers", async () => {
    const req = new Request("http://localhost/_dev/api/infrastructure");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("providers" in body, true);
    assertEquals("workflowNodeTypes" in body, true);
  });

  it("/_dev/api/memory returns heap and cache stats", async () => {
    const req = new Request("http://localhost/_dev/api/memory");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("heap" in body, true);
    assertEquals("caches" in body, true);
    assertEquals("pressure" in body, true);
  });

  it("/_dev/api/build returns transform stages and plugins", async () => {
    const req = new Request("http://localhost/_dev/api/build");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("transformStages" in body, true);
    assertEquals("remarkPlugins" in body, true);
    assertEquals("rehypePlugins" in body, true);
    assertEquals(Array.isArray(body.transformStages), true);
  });

  it("/_dev/api/errors returns error catalog", async () => {
    const req = new Request("http://localhost/_dev/api/errors");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("errors" in body, true);
    assertEquals("categories" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/config returns feature flags and env", async () => {
    const ctx = { ...createMockCtx(), projectDir: "/my/project", isLocalProject: true };
    const req = new Request("http://localhost/_dev/api/config");
    const res = await handleDashboardAPI(req, ctx as unknown as HandlerContext);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("featureFlags" in body, true);
    assertEquals("environment" in body, true);
    assertEquals(body.isLocalProject, true);
  });

  it("/_dev/api/live-errors returns collected errors", async () => {
    const req = new Request("http://localhost/_dev/api/live-errors");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("errors" in body, true);
    assertEquals("count" in body, true);
    assertEquals("countByType" in body, true);
  });

  it("/_dev/api/live-errors with type filter", async () => {
    const req = new Request("http://localhost/_dev/api/live-errors?type=runtime");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("/_dev/api/live-logs returns log entries", async () => {
    const req = new Request("http://localhost/_dev/api/live-logs");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("logs" in body, true);
    assertEquals("count" in body, true);
    assertEquals("countByLevel" in body, true);
  });

  it("/_dev/api/live-logs with query params", async () => {
    const req = new Request(
      "http://localhost/_dev/api/live-logs?level=error&source=test&pattern=foo&limit=10&since=123",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("/_dev/api/file-content returns text file content", async () => {
    const ctx = createMockCtxWithFs({
      readFile: async () => "const x = 1;\n",
    });
    const req = new Request("http://localhost/_dev/api/file-content?path=src/index.ts");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.extension, "ts");
    assertEquals(body.content, "const x = 1;\n");
    assertEquals("lines" in body, true);
  });

  it("/_dev/api/file-content returns binary notice for non-text files", async () => {
    const ctx = createMockCtxWithFs({
      readFile: async () => "binary data",
    });
    const req = new Request("http://localhost/_dev/api/file-content?path=image.png");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.isBinary, true);
  });

  it("/_dev/api/files with readDir error returns empty list", async () => {
    const ctx = createMockCtxWithFs({
      // deno-lint-ignore require-yield
      readDir: async function* () {
        throw new Error("permission denied");
      },
    });
    const req = new Request("http://localhost/_dev/api/files?path=src");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.files, []);
    assertEquals("error" in body, true);
  });

  it("/_dev/api/files lists directory entries sorted", async () => {
    const ctx = createMockCtxWithFs({
      readDir: async function* () {
        yield { name: "b.ts", isDirectory: false, isFile: true, isSymlink: false };
        yield { name: "a-dir", isDirectory: true, isFile: false, isSymlink: false };
        yield { name: "a.ts", isDirectory: false, isFile: true, isSymlink: false };
      },
    });
    const req = new Request("http://localhost/_dev/api/files");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.count, 3);
    // Directories first, then files alphabetically
    assertEquals(body.files[0].type, "directory");
    assertEquals(body.files[0].name, "a-dir");
  });

  it("returns null for unknown GET path", async () => {
    const req = new Request("http://localhost/_dev/api/unknown");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res, null);
  });
});

describe("Dashboard API - POST endpoints", () => {
  it("/_dev/api/execute-tool returns 400 without toolId", async () => {
    const req = new Request("http://localhost/_dev/api/execute-tool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("/_dev/api/execute-tool returns 404 for unknown tool", async () => {
    const req = new Request("http://localhost/_dev/api/execute-tool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolId: "nonexistent-tool" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 404);
  });

  it("/_dev/api/read-resource returns 400 without uri", async () => {
    const req = new Request("http://localhost/_dev/api/read-resource", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("/_dev/api/read-resource returns 404 for unknown uri", async () => {
    const req = new Request("http://localhost/_dev/api/read-resource", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri: "unknown://resource" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 404);
  });

  it("/_dev/api/render-prompt returns 400 without promptId", async () => {
    const req = new Request("http://localhost/_dev/api/render-prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("/_dev/api/render-prompt returns error for unknown prompt", async () => {
    const req = new Request("http://localhost/_dev/api/render-prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promptId: "nonexistent-prompt" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    // May return 404 or 500 depending on whether getContent returns undefined or throws
    assertEquals(res!.status >= 400, true);
  });

  it("/_dev/api/start-workflow returns 400 without workflowId", async () => {
    const req = new Request("http://localhost/_dev/api/start-workflow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("/_dev/api/start-workflow returns 404 for unknown workflow", async () => {
    const req = new Request("http://localhost/_dev/api/start-workflow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowId: "nonexistent-workflow" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 404);
  });

  it("/_dev/api/hmr-trigger returns success info", async () => {
    const req = new Request("http://localhost/_dev/api/hmr-trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    // No HMR listeners → success: false
    assertEquals("success" in body, true);
  });

  it("/_dev/api/hmr-trigger with path", async () => {
    const req = new Request("http://localhost/_dev/api/hmr-trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "src/index.ts" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("returns null for unknown POST path", async () => {
    const req = new Request("http://localhost/_dev/api/unknown", { method: "POST" });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res, null);
  });
});

describe("Dashboard API - other methods", () => {
  it("returns null for PUT request", async () => {
    const req = new Request("http://localhost/_dev/api/stats", { method: "PUT" });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res, null);
  });

  it("returns null for DELETE request", async () => {
    const req = new Request("http://localhost/_dev/api/stats", { method: "DELETE" });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res, null);
  });
});

describe("Dashboard API path validation", () => {
  it("rejects path traversal with '..' in list files", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=../../etc/passwd");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
    const body = await res!.json();
    assertEquals(body.error.includes("Invalid path"), true);
  });

  it("rejects encoded path traversal in list files", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects null bytes in list files", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=src%00.ts");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("allows valid relative paths in list files", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=src/components");
    const res = await handleDashboardAPI(req, createMockCtx());
    // Should succeed (200) since mock adapter returns empty readDir
    assertEquals(res?.status, 200);
  });

  it("rejects path traversal in file-content", async () => {
    const req = new Request("http://localhost/_dev/api/file-content?path=../../etc/passwd");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects encoded path traversal in file-content", async () => {
    const req = new Request(
      "http://localhost/_dev/api/file-content?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects null bytes in file-content", async () => {
    const req = new Request("http://localhost/_dev/api/file-content?path=src%00.ts");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("allows filenames with percent signs (no double-decoding)", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=reports%2F100%25done");
    const res = await handleDashboardAPI(req, createMockCtx());
    // searchParams.get decodes to "reports/100%done" — should not fail
    assertEquals(res?.status, 200);
  });

  it("requires path parameter for file-content", async () => {
    const req = new Request("http://localhost/_dev/api/file-content");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
    const body = await res!.json();
    assertEquals(body.error, "path parameter is required");
  });
});
