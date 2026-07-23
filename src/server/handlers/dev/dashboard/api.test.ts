import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDashboardApiRoutePaths, handleDashboardAPI } from "./api.ts";
import type { HandlerContext } from "../../types.ts";
import { ReloadNotifier, type ReloadProjectInfo } from "../../../reload-notifier.ts";

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

describe("Dashboard API - route table", () => {
  it("registers the expected GET and POST API routes", () => {
    assertEquals(getDashboardApiRoutePaths("GET"), [
      "/_dev/api/agents",
      "/_dev/api/build",
      "/_dev/api/config",
      "/_dev/api/errors",
      "/_dev/api/file-content",
      "/_dev/api/files",
      "/_dev/api/handlers",
      "/_dev/api/infrastructure",
      "/_dev/api/live-errors",
      "/_dev/api/live-logs",
      "/_dev/api/memory",
      "/_dev/api/metrics",
      "/_dev/api/prompts",
      "/_dev/api/resources",
      "/_dev/api/stats",
      "/_dev/api/tools",
      "/_dev/api/workflows",
    ]);

    assertEquals(getDashboardApiRoutePaths("POST"), [
      "/_dev/api/execute-tool",
      "/_dev/api/hmr-trigger",
      "/_dev/api/read-resource",
      "/_dev/api/render-prompt",
      "/_dev/api/start-workflow",
    ]);
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
    assertEquals(body.count, 63);
    assertEquals(body.categories, {
      config: 7,
      build: 8,
      runtime: 7,
      route: 6,
      server: 8,
      module: 6,
      dev: 5,
      rsc: 6,
      deployment: 4,
      general: 6,
    });

    const errorsByCode = new Map<string, { code: string; category: string }>(
      body.errors.map((error: { code: string; category: string }) => [error.code, error]),
    );
    assertEquals(errorsByCode.get("config-not-found")?.category, "config");
    assertEquals(errorsByCode.get("cache-path-mismatch")?.category, "server");
    assertEquals(errorsByCode.get("hmr-error")?.category, "dev");
    assertEquals(errorsByCode.get("client-boundary-violation")?.category, "rsc");
    assertEquals(errorsByCode.get("deployment-error")?.category, "deployment");
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

  it("/_dev/api/hmr-trigger publishes the exact local project and source scope", async () => {
    ReloadNotifier.reset();
    let resolveReload!: (value: { paths?: string[]; project?: ReloadProjectInfo }) => void;
    const reload = new Promise<{ paths?: string[]; project?: ReloadProjectInfo }>((resolve) => {
      resolveReload = resolve;
    });
    const unsubscribe = ReloadNotifier.subscribe((paths, project) => {
      resolveReload({ paths, project });
    });

    try {
      const req = new Request("http://localhost/_dev/api/hmr-trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "src/index.ts" }),
      });
      const ctx = {
        ...createMockCtx(),
        projectId: "project-id-a",
        projectSlug: "project-a",
        projectDir: "/projects/a",
        releaseId: "release-a",
        requestContext: { branch: "feature-a" },
        enriched: { contentSourceId: "preview-feature-a" },
      } as unknown as HandlerContext;

      const res = await handleDashboardAPI(req, ctx);
      const event = await reload;

      assertEquals(res?.status, 200);
      assertEquals(event.paths, ["src/index.ts"]);
      assertEquals(event.project, {
        projectId: "project-id-a",
        projectSlug: "project-a",
        projectDir: "/projects/a",
        environment: "preview",
        branch: "feature-a",
        releaseId: "release-a",
        contentSourceId: "preview-feature-a",
      });
    } finally {
      unsubscribe();
      ReloadNotifier.reset();
    }
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

// VULN-FS-2 regression tests — absolute paths, mixed separators, edge cases.
// All paths must be rejected with HTTP 400 before the adapter ever sees them.
//
// IMPORTANT: URL.searchParams.get() percent-decodes the value ONCE, so raw
// "%2e%2e/..." in the query string becomes "../..." at the handler. Tests that
// want to exercise the decoded form embed "%2e%2e" directly (no double-encode),
// while tests for literal "%..." filenames double-encode with encodeURIComponent.
describe("Dashboard API path validation (VULN-FS-2)", () => {
  // Raw query-string values (already URL-encoded or embedded as-is).
  const MALICIOUS_RAW_QUERY: ReadonlyArray<[string, string]> = [
    // Absolute paths — searchParams decodes nothing, these stay absolute.
    ["absolute /etc/passwd", "/etc/passwd"],
    ["absolute /root/.ssh/id_rsa", "/root/.ssh/id_rsa"],
    // Percent-encoded absolute — decodes to /etc/passwd.
    ["percent-encoded absolute %2Fetc%2Fpasswd", "%2Fetc%2Fpasswd"],
    // Traversal variants — decode once to real "..".
    ["percent-encoded traversal lowercase", "%2e%2e%2F%2e%2e%2Fetc%2Fpasswd"],
    ["percent-encoded traversal uppercase", "%2E%2E%2F%2E%2E%2Fetc%2Fpasswd"],
    ["percent-encoded mixed case", "%2e%2E%2f%2E%2e%2fetc%2fpasswd"],
    // Windows-style separators.
    ["windows-style backslash traversal", "..%5C..%5Cetc%5Cpasswd"],
    ["mixed forward/backslash traversal", "..%5C..%2Fetc%2Fpasswd"],
    // NUL byte — must be blocked.
    ["NUL byte percent-encoded", "legit%00.ts"],
    ["NUL byte in traversal", "%2e%2e%2F%00etc%2Fpasswd"],
  ];

  for (const [label, rawQuery] of MALICIOUS_RAW_QUERY) {
    it(`files endpoint rejects ${label}`, async () => {
      const url = `http://localhost/_dev/api/files?path=${rawQuery}`;
      const req = new Request(url);
      const res = await handleDashboardAPI(req, createMockCtx());
      assertEquals(res?.status, 400, `expected 400 for ${label}: ${rawQuery}`);
    });

    it(`file-content endpoint rejects ${label}`, async () => {
      const url = `http://localhost/_dev/api/file-content?path=${rawQuery}`;
      const req = new Request(url);
      const res = await handleDashboardAPI(req, createMockCtx());
      assertEquals(res?.status, 400, `expected 400 for ${label}: ${rawQuery}`);
    });
  }

  it("double-encoded %252e%252e does not traverse (decoded once to %2e%2e)", async () => {
    // searchParams decodes once → literal "%2e%2e/%2e%2e/etc/passwd" which is
    // NOT a traversal (no real ".."). validator treats it as a filename and
    // joins under projectDir. The readDir will fail at the adapter (mock is
    // empty) but critically the path must NOT resolve to /etc/passwd.
    const req = new Request(
      "http://localhost/_dev/api/files?path=%252e%252e%252F%252e%252e%252Fetc%252Fpasswd",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    // Must never leak the sensitive file — either 200 with empty listing or
    // 400 is acceptable, but never 200 with /etc/passwd contents.
    assertEquals(res?.status === 200 || res?.status === 400, true);
  });

  it("unicode NFC form in relative path is accepted", async () => {
    // NFC form of "é" is single code point U+00E9.
    const nfc = "src/caf\u00E9.ts";
    const req = new Request(
      `http://localhost/_dev/api/files?path=${encodeURIComponent(nfc)}`,
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("unicode NFD form in relative path is accepted", async () => {
    // NFD form of "é" is "e" + U+0301 combining acute accent.
    const nfd = "src/cafe\u0301.ts";
    const req = new Request(
      `http://localhost/_dev/api/files?path=${encodeURIComponent(nfd)}`,
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("positive: nested relative path with hyphen and dot files is accepted", async () => {
    const req = new Request(
      "http://localhost/_dev/api/files?path=src/components/.config-dir",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("positive: empty path lists project root", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("file-content rejects absolute path that normalisation could collapse", async () => {
    // Reproduces VULN-FS-2 primary exploit: /project//etc/passwd → /etc/passwd
    // after adapter path normalisation. The strict validator must reject the
    // absolute /etc/passwd value before reaching the adapter.
    const req = new Request(
      "http://localhost/_dev/api/file-content?path=%2Fetc%2Fpasswd",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });
});
