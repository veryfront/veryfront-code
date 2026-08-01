import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { resource, resourceRegistry } from "#veryfront/resource";
import { prompt, promptRegistry } from "#veryfront/prompt";
import { dynamicTool, type Tool, type ToolExecutionContext, toolRegistry } from "#veryfront/tool";
import { toolStep, waitForApproval, workflow } from "#veryfront/workflow";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import {
  getDashboardApiRoutePaths,
  handleDashboardAPI,
  MAX_DASHBOARD_API_BODY_BYTES,
  MAX_DASHBOARD_DIRECTORY_ENTRIES,
  MAX_DASHBOARD_DIRECTORY_NAME_BYTES,
  MAX_DASHBOARD_FILE_CONTENT_BYTES,
  PROMPT_RENDER_TIMEOUT_MS,
  RESOURCE_READ_TIMEOUT_MS,
  TOOL_EXECUTION_TIMEOUT_MS,
  WORKFLOW_EXECUTION_TIMEOUT_MS,
} from "./api.ts";
import type { HandlerContext } from "../../types.ts";
import { ReloadNotifier, type ReloadProjectInfo } from "../../../reload-notifier.ts";
import { DASHBOARD_CSRF_HEADER_NAME, getDashboardSessionToken } from "./access-policy.ts";
import { getDashboardSessionCookieName } from "#veryfront/extensions/dev-ui/protocol";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

const DASHBOARD_ORIGIN = "http://localhost";
const textEncoder = new TextEncoder();

function dashboardRequest(
  input: string | URL,
  init: RequestInit = {},
  peerHostname = "127.0.0.1",
): Request {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", url.host);
  const request = new Request(url, { ...init, headers });
  recordRequestPeerFromTransport(request, {
    runtime: "node",
    transport: "tcp",
    hostname: peerHostname,
  });
  return request;
}

function dashboardPostHeaders(
  overrides: HeadersInit = {},
  origin = DASHBOARD_ORIGIN,
): Headers {
  const originUrl = new URL(origin);
  const listenerPort = originUrl.port === ""
    ? originUrl.protocol === "https:" ? 443 : 80
    : Number(originUrl.port);
  const csrfToken = getDashboardSessionToken();
  const headers = new Headers({
    "content-type": "application/json",
    cookie: `${getDashboardSessionCookieName(listenerPort)}=${csrfToken}`,
    host: originUrl.host,
    origin: originUrl.origin,
    [DASHBOARD_CSRF_HEADER_NAME]: csrfToken,
  });
  for (const [name, value] of new Headers(overrides)) headers.set(name, value);
  return headers;
}

function dashboardMutationRequest(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Request {
  return dashboardRequest(`${DASHBOARD_ORIGIN}${path}`, {
    method: "POST",
    headers: dashboardPostHeaders(),
    body: JSON.stringify(body),
    signal,
  });
}

// Minimal mock adapter with fs that tracks readDir/readFile calls
function createMockCtx(): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      fs: {
        symlinkSemantics: "none",
        readDir: async function* () {},
        readFile: async () => new Uint8Array(),
        readFileBytesBounded: async () => new Uint8Array(),
      },
    },
    securityConfig: null,
    cspUserHeader: null,
    isLocalProject: true,
  } as unknown as HandlerContext;
}

function createWorkflowProjectCtx(): HandlerContext {
  return {
    ...createMockCtx(),
    projectId: "project-id-a",
    projectSlug: "project-a",
    resolvedEnvironment: "preview",
    environmentName: "Development",
    requestContext: {
      token: "SECRET_SENTINEL",
      tokenProvenance: "untrusted",
      slug: "project-a",
      branch: "feature-a",
      mode: "preview",
    },
  } as unknown as HandlerContext;
}

function createMockCtxWithFs(fsOverrides: Record<string, unknown> = {}): HandlerContext {
  return {
    ...createMockCtx(),
    adapter: {
      fs: {
        symlinkSemantics: "none",
        readDir: async function* () {},
        readFile: async () => "file content",
        readFileBytesBounded: async () => textEncoder.encode("file content"),
        ...fsOverrides,
      },
    },
  } as unknown as HandlerContext;
}

describe("Dashboard API - auth", () => {
  it("returns 401 for non-local project", async () => {
    const ctx = { ...createMockCtx(), isLocalProject: false } as unknown as HandlerContext;
    const req = dashboardRequest("http://localhost/_dev/api/stats");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 401);
  });

  it("rejects DNS-rebinding hosts before a file can be read", async () => {
    let readCount = 0;
    const ctx = createMockCtxWithFs({
      readFileBytesBounded: async () => {
        readCount++;
        return textEncoder.encode("SECRET_SENTINEL");
      },
    });
    const req = dashboardRequest(
      "http://evil.attacker:8000/_dev/api/file-content?path=secret.txt",
    );

    const res = await handleDashboardAPI(req, ctx);

    assertEquals(res?.status, 403);
    assertEquals(res?.headers.get("cache-control"), "no-store");
    assertEquals(readCount, 0);
    assertEquals((await res!.text()).includes("SECRET_SENTINEL"), false);
  });

  it("rejects browser cross-site GET work even with an exact loopback Host", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/files", {
      headers: { "sec-fetch-site": "cross-site" },
    });

    const res = await handleDashboardAPI(req, createMockCtx());

    assertEquals(res?.status, 403);
  });

  it("rejects forged local Host access from a non-loopback peer before file I/O", async () => {
    let readCount = 0;
    const ctx = createMockCtxWithFs({
      readFileBytesBounded: async () => {
        readCount++;
        return textEncoder.encode("SECRET_SENTINEL");
      },
    });
    const req = dashboardRequest(
      "http://localhost:8000/_dev/api/file-content?path=secret.txt",
      {},
      "192.168.1.25",
    );

    const res = await handleDashboardAPI(req, ctx);

    assertEquals(res?.status, 403);
    assertEquals(res?.headers.get("cache-control"), "no-store");
    assertEquals(readCount, 0);
    assertEquals((await res!.text()).includes("SECRET_SENTINEL"), false);
  });

  it("rejects authenticated mutations from a non-loopback peer", async () => {
    ReloadNotifier.reset();
    let reloadCount = 0;
    const unsubscribe = ReloadNotifier.subscribe(() => {
      reloadCount++;
    });
    try {
      const req = dashboardRequest(
        "http://localhost/_dev/api/hmr-trigger",
        {
          method: "POST",
          headers: dashboardPostHeaders(),
          body: JSON.stringify({ path: "src/index.ts" }),
        },
        "203.0.113.8",
      );

      const res = await handleDashboardAPI(req, createMockCtx());

      assertEquals(res?.status, 403);
      assertEquals(reloadCount, 0);
    } finally {
      unsubscribe();
      ReloadNotifier.reset();
    }
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
    const req = dashboardRequest("http://localhost/_dev/api/stats");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    assertEquals(res?.headers.get("cache-control"), "no-store");
    const body = await res!.json();
    assertEquals("mcp" in body, true);
    assertEquals("agents" in body, true);
    assertEquals("workflows" in body, true);
    assertEquals("timestamp" in body, true);
  });

  it("/_dev/api/tools returns tools list", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/tools");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("tools" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/tools rejects registry metadata above the JSON response bound", async () => {
    const oversizedTool = dynamicTool({
      id: "dashboard-oversized-list-tool",
      description: "x".repeat(MAX_DASHBOARD_API_BODY_BYTES + 1),
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true }),
    });
    toolRegistry.register(oversizedTool.id, oversizedTool);

    try {
      const response = await handleDashboardAPI(
        dashboardRequest("http://localhost/_dev/api/tools"),
        createMockCtx(),
      );

      assertEquals(response?.status, 500);
      assertEquals(await response?.json(), {
        error: "Tool registry contains data that cannot be displayed",
      });
    } finally {
      toolRegistry.delete(oversizedTool.id);
    }
  });

  it("/_dev/api/tools redacts hostile registry metadata failures", async () => {
    const toolId = "dashboard-hostile-list-tool";
    const hostileTool = {
      id: toolId,
      type: "dynamic",
      get description(): string {
        throw new Error("SECRET_SENTINEL hostile metadata getter");
      },
      execute: () => ({ ok: true }),
    } as unknown as Tool;
    toolRegistry.register(toolId, hostileTool);

    try {
      const response = await handleDashboardAPI(
        dashboardRequest("http://localhost/_dev/api/tools"),
        createMockCtx(),
      );
      const responseText = await response!.text();

      assertEquals(response?.status, 500);
      assertEquals(JSON.parse(responseText), {
        error: "Dashboard request could not be completed",
      });
      assertEquals(responseText.includes("SECRET_SENTINEL"), false);
    } finally {
      toolRegistry.delete(toolId);
    }
  });

  it("/_dev/api/resources returns resources list", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/resources");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("resources" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/prompts returns prompts list", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/prompts");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("prompts" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/agents returns agents list", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/agents");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("agents" in body, true);
    assertEquals("count" in body, true);
  });

  it("/_dev/api/workflows returns workflows list", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/workflows");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("workflows" in body, true);
    assertEquals("count" in body, true);
    assertEquals("stats" in body, true);
  });

  it("/_dev/api/handlers returns empty when no routeRegistry", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/handlers");
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
    const req = dashboardRequest("http://localhost/_dev/api/handlers");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.count, 1);
    assertEquals(body.handlers[0].name, "TestHandler");
  });

  it("/_dev/api/metrics returns metrics snapshot", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/metrics");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("counters" in body, true);
    assertEquals("timestamp" in body, true);
  });

  it("/_dev/api/infrastructure returns providers", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/infrastructure");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("providers" in body, true);
    assertEquals("workflowNodeTypes" in body, true);
  });

  it("/_dev/api/memory returns heap and cache stats", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/memory");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("heap" in body, true);
    assertEquals("caches" in body, true);
    assertEquals("pressure" in body, true);
  });

  it("/_dev/api/build returns transform stages and plugins", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/build");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("transformStages" in body, true);
    assertEquals("remarkPlugins" in body, true);
    assertEquals("rehypePlugins" in body, true);
    assertEquals(Array.isArray(body.transformStages), true);
  });

  it("/_dev/api/errors returns error catalog", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/errors");
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
    const req = dashboardRequest("http://localhost/_dev/api/config");
    const res = await handleDashboardAPI(req, ctx as unknown as HandlerContext);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("featureFlags" in body, true);
    assertEquals("environment" in body, true);
    assertEquals(body.isLocalProject, true);
  });

  it("/_dev/api/live-errors returns collected errors", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/live-errors");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("errors" in body, true);
    assertEquals("count" in body, true);
    assertEquals("countByType" in body, true);
  });

  it("/_dev/api/live-errors with type filter", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/live-errors?type=runtime");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("/_dev/api/live-logs returns log entries", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/live-logs");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals("logs" in body, true);
    assertEquals("count" in body, true);
    assertEquals("countByLevel" in body, true);
  });

  it("/_dev/api/live-logs with query params", async () => {
    const req = dashboardRequest(
      "http://localhost/_dev/api/live-logs?level=error&source=test&pattern=foo&limit=10&since=123",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("/_dev/api/file-content returns text file content", async () => {
    const ctx = createMockCtxWithFs({
      readFileBytesBounded: async () => textEncoder.encode("const x = 1;\n"),
    });
    const req = dashboardRequest("http://localhost/_dev/api/file-content?path=src/index.ts");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.extension, "ts");
    assertEquals(body.content, "const x = 1;\n");
    assertEquals("lines" in body, true);
  });

  it("/_dev/api/file-content rejects non-text extensions before reading", async () => {
    let readCount = 0;
    const ctx = createMockCtxWithFs({
      readFile: async () => {
        readCount++;
        return "binary data";
      },
      readFileBytesBounded: async () => {
        readCount++;
        return textEncoder.encode("binary data");
      },
    });
    const req = dashboardRequest("http://localhost/_dev/api/file-content?path=image.png");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.isBinary, true);
    assertEquals(readCount, 0);
  });

  it("/_dev/api/files does not disclose readDir errors", async () => {
    const ctx = createMockCtxWithFs({
      // deno-lint-ignore require-yield
      readDir: async function* () {
        throw new Error("SECRET_SENTINEL permission denied");
      },
    });
    const req = dashboardRequest("http://localhost/_dev/api/files?path=src");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 500);
    const body = await res!.json();
    assertEquals(body, { error: "Directory could not be read" });
  });

  it("/_dev/api/files lists directory entries sorted", async () => {
    const ctx = createMockCtxWithFs({
      readDir: async function* () {
        yield { name: "b.ts", isDirectory: false, isFile: true, isSymlink: false };
        yield { name: "a-dir", isDirectory: true, isFile: false, isSymlink: false };
        yield { name: "a.ts", isDirectory: false, isFile: true, isSymlink: false };
      },
    });
    const req = dashboardRequest("http://localhost/_dev/api/files");
    const res = await handleDashboardAPI(req, ctx);
    assertEquals(res?.status, 200);
    const body = await res!.json();
    assertEquals(body.count, 3);
    // Directories first, then files alphabetically
    assertEquals(body.files[0].type, "directory");
    assertEquals(body.files[0].name, "a-dir");
  });

  it("/_dev/api/files stops and closes iteration at the entry limit", async () => {
    let iteratorClosed = false;
    const ctx = createMockCtxWithFs({
      readDir: async function* () {
        try {
          for (let index = 0; index <= MAX_DASHBOARD_DIRECTORY_ENTRIES; index++) {
            yield {
              name: `file-${index}.ts`,
              isDirectory: false,
              isFile: true,
              isSymlink: false,
            };
          }
        } finally {
          iteratorClosed = true;
        }
      },
    });

    const res = await handleDashboardAPI(
      dashboardRequest("http://localhost/_dev/api/files"),
      ctx,
    );

    assertEquals(res?.status, 413);
    assertEquals(iteratorClosed, true);
  });

  it("/_dev/api/files rejects a directory entry with an oversized name", async () => {
    const ctx = createMockCtxWithFs({
      readDir: async function* () {
        yield {
          name: "a".repeat(MAX_DASHBOARD_DIRECTORY_NAME_BYTES + 1),
          isDirectory: false,
          isFile: true,
          isSymlink: false,
        };
      },
    });

    const res = await handleDashboardAPI(
      dashboardRequest("http://localhost/_dev/api/files"),
      ctx,
    );
    assertEquals(res?.status, 413);
  });

  it("/_dev/api/file-content rejects oversized content without an unbounded fallback", async () => {
    let unboundedRead = false;
    const ctx = createMockCtxWithFs({
      readFile: async () => {
        unboundedRead = true;
        return "must not be read";
      },
      readFileBytesBounded: async (_path: string, byteLimit: number) => {
        assertEquals(byteLimit, MAX_DASHBOARD_FILE_CONTENT_BYTES + 1);
        return new Uint8Array(byteLimit);
      },
    });

    const res = await handleDashboardAPI(
      dashboardRequest("http://localhost/_dev/api/file-content?path=large.txt"),
      ctx,
    );

    assertEquals(res?.status, 413);
    assertEquals(unboundedRead, false);
  });

  it("/_dev/api/file-content fails closed without bounded-read support", async () => {
    let unboundedRead = false;
    const ctx = createMockCtxWithFs({
      readFile: async () => {
        unboundedRead = true;
        return "must not be read";
      },
      readFileBytesBounded: undefined,
    });

    const res = await handleDashboardAPI(
      dashboardRequest("http://localhost/_dev/api/file-content?path=source.ts"),
      ctx,
    );

    assertEquals(res?.status, 501);
    assertEquals(unboundedRead, false);
  });

  it("returns null for unknown GET path", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/unknown");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res, null);
  });
});

describe("Dashboard API - POST endpoints", () => {
  it("rejects missing, opaque, cross-origin, and mismatched-host callers on every route", async () => {
    const missingOrigin = dashboardPostHeaders();
    missingOrigin.delete("origin");
    const untrustedHeaders = [
      missingOrigin,
      dashboardPostHeaders({ origin: "null" }),
      dashboardPostHeaders({ origin: "https://attacker.example", "sec-fetch-site": "cross-site" }),
      dashboardPostHeaders({ host: "127.0.0.1" }),
    ];

    for (const path of getDashboardApiRoutePaths("POST")) {
      for (const headers of untrustedHeaders) {
        const req = dashboardRequest(`${DASHBOARD_ORIGIN}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        });
        const res = await handleDashboardAPI(req, createMockCtx());
        assertEquals(res?.status, 403, `${path} must reject an untrusted caller`);
      }
    }
  });

  it("requires both the dashboard session cookie and CSRF header on every mutation", async () => {
    for (const path of getDashboardApiRoutePaths("POST")) {
      for (const credentialToRemove of ["cookie", DASHBOARD_CSRF_HEADER_NAME]) {
        const headers = dashboardPostHeaders();
        headers.delete(credentialToRemove);
        const res = await handleDashboardAPI(
          dashboardRequest(`${DASHBOARD_ORIGIN}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify({}),
          }),
          createMockCtx(),
        );
        assertEquals(res?.status, 403, `${path} must require ${credentialToRemove}`);
      }

      const forgedHeaders = dashboardPostHeaders({
        [DASHBOARD_CSRF_HEADER_NAME]: "A".repeat(43),
      });
      const forgedResponse = await handleDashboardAPI(
        dashboardRequest(`${DASHBOARD_ORIGIN}${path}`, {
          method: "POST",
          headers: forgedHeaders,
          body: JSON.stringify({}),
        }),
        createMockCtx(),
      );
      assertEquals(forgedResponse?.status, 403, `${path} must reject a forged token`);
    }
  });

  it("binds mutation admission to a non-default listener port", async () => {
    const origin = "http://veryfront.me:3000";
    const accepted = await handleDashboardAPI(
      dashboardRequest(`${origin}/_dev/api/execute-tool`, {
        method: "POST",
        headers: dashboardPostHeaders({}, origin),
        body: JSON.stringify({}),
      }),
      createMockCtx(),
    );
    assertEquals(accepted?.status, 400);

    const wrongPortHeaders = dashboardPostHeaders({}, origin);
    wrongPortHeaders.set(
      "cookie",
      `${getDashboardSessionCookieName(80)}=${getDashboardSessionToken()}`,
    );
    const rejected = await handleDashboardAPI(
      dashboardRequest(`${origin}/_dev/api/execute-tool`, {
        method: "POST",
        headers: wrongPortHeaders,
        body: JSON.stringify({}),
      }),
      createMockCtx(),
    );
    assertEquals(rejected?.status, 403);
  });

  it("rejects DNS-rebinding mutation requests before dispatch", async () => {
    const req = dashboardRequest("http://evil.attacker:8000/_dev/api/hmr-trigger", {
      method: "POST",
      headers: dashboardPostHeaders({
        host: "evil.attacker:8000",
        origin: "http://evil.attacker:8000",
      }),
      body: JSON.stringify({ path: "src/index.ts" }),
    });

    const res = await handleDashboardAPI(req, createMockCtx());

    assertEquals(res?.status, 403);
  });

  it("rejects text/plain, parameterized JSON, and no-cors POST bodies", async () => {
    for (
      const headers of [
        dashboardPostHeaders({ "content-type": "text/plain" }),
        dashboardPostHeaders({ "content-type": "application/json; charset=utf-8" }),
      ]
    ) {
      const req = dashboardRequest(`${DASHBOARD_ORIGIN}/_dev/api/execute-tool`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const res = await handleDashboardAPI(req, createMockCtx());
      assertEquals(res?.status, 415);
    }

    const noCors = dashboardRequest(`${DASHBOARD_ORIGIN}/_dev/api/execute-tool`, {
      method: "POST",
      headers: dashboardPostHeaders({
        "content-type": "text/plain",
        "sec-fetch-mode": "no-cors",
      }),
      body: JSON.stringify({}),
    });
    const noCorsResponse = await handleDashboardAPI(noCors, createMockCtx());
    assertEquals(noCorsResponse?.status, 403);
  });

  it("rejects declared and streamed bodies above the byte boundary", async () => {
    const declared = dashboardRequest(`${DASHBOARD_ORIGIN}/_dev/api/execute-tool`, {
      method: "POST",
      headers: dashboardPostHeaders({
        "content-length": String(MAX_DASHBOARD_API_BODY_BYTES + 1),
      }),
      body: JSON.stringify({}),
    });
    const declaredResponse = await handleDashboardAPI(declared, createMockCtx());
    assertEquals(declaredResponse?.status, 413);

    const streamed = dashboardRequest(`${DASHBOARD_ORIGIN}/_dev/api/execute-tool`, {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_DASHBOARD_API_BODY_BYTES));
          controller.enqueue(new Uint8Array([0]));
          controller.close();
        },
      }),
    });
    const streamedResponse = await handleDashboardAPI(streamed, createMockCtx());
    assertEquals(streamedResponse?.status, 413);
  });

  it("rejects JSON deeper than the shared bounded snapshot limit", async () => {
    let args: Record<string, unknown> = {};
    for (let depth = 0; depth < 130; depth++) args = { next: args };
    const req = dashboardRequest(`${DASHBOARD_ORIGIN}/_dev/api/execute-tool`, {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({ toolId: "nonexistent-tool", args }),
    });

    const res = await handleDashboardAPI(req, createMockCtx());

    assertEquals(res?.status, 400);
  });

  it("cancels a stalled request body when its request is aborted", async () => {
    const abortController = new AbortController();
    let cancelled = false;
    let holdPull!: () => void;
    const stalledPull = new Promise<void>((resolve) => {
      holdPull = resolve;
    });
    const request = dashboardRequest(`${DASHBOARD_ORIGIN}/_dev/api/execute-tool`, {
      method: "POST",
      headers: dashboardPostHeaders(),
      signal: abortController.signal,
      body: new ReadableStream<Uint8Array>({
        async pull() {
          await stalledPull;
        },
        cancel() {
          cancelled = true;
          holdPull();
        },
      }),
    });

    const response = handleDashboardAPI(request, createMockCtx());
    await Promise.resolve();
    abortController.abort();

    assertEquals((await response)?.status, 400);
    assertEquals(cancelled, true);
  });

  it("/_dev/api/execute-tool returns 400 without toolId", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/execute-tool", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("/_dev/api/execute-tool returns 404 for unknown tool", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/execute-tool", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({ toolId: "nonexistent-tool" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 404);
  });

  it("/_dev/api/execute-tool propagates request and project identity without untrusted auth", async () => {
    let executionContext: ToolExecutionContext | undefined;
    const contextTool = dynamicTool({
      id: "dashboard-context-tool",
      description: "Capture dashboard execution context",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: (_input, context) => {
        executionContext = context;
        return { ok: true };
      },
    });
    toolRegistry.register(contextTool.id, contextTool);

    try {
      const request = dashboardMutationRequest(
        "/_dev/api/execute-tool",
        { toolId: contextTool.id },
        new AbortController().signal,
      );
      const ctx = {
        ...createMockCtx(),
        projectId: "project-id-a",
        projectSlug: "project-a",
        resolvedEnvironment: "preview",
        environmentName: "Development",
        requestContext: {
          token: "SECRET_SENTINEL",
          tokenProvenance: "untrusted",
          slug: "project-a",
          branch: "feature-a",
          mode: "preview",
        },
      } as unknown as HandlerContext;

      const response = await handleDashboardAPI(request, ctx);

      assertEquals(response?.status, 200);
      assertEquals(executionContext?.abortSignal instanceof AbortSignal, true);
      assertEquals(executionContext?.abortSignal?.aborted, false);
      assertEquals({
        projectId: executionContext?.projectId,
        projectSlug: executionContext?.projectSlug,
        productionMode: executionContext?.productionMode,
        releaseId: executionContext?.releaseId,
        branch: executionContext?.branch,
        environmentName: executionContext?.environmentName,
        authToken: executionContext?.authToken,
      }, {
        projectId: "project-id-a",
        projectSlug: "project-a",
        productionMode: false,
        releaseId: null,
        branch: "feature-a",
        environmentName: "Development",
        authToken: undefined,
      });
      assertEquals((await response!.text()).includes("SECRET_SENTINEL"), false);
    } finally {
      toolRegistry.delete(contextTool.id);
    }
  });

  it("/_dev/api/execute-tool bounds extension output", async () => {
    const invalidOutputTool = dynamicTool({
      id: "dashboard-invalid-output-tool",
      description: "Return a non-JSON value",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => 1n,
    });
    toolRegistry.register(invalidOutputTool.id, invalidOutputTool);

    try {
      const response = await handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/execute-tool", {
          toolId: invalidOutputTool.id,
        }),
        createMockCtx(),
      );

      assertEquals(response?.status, 500);
      assertEquals(await response?.json(), {
        error: `Tool "${invalidOutputTool.id}" returned data that is not bounded JSON`,
      });
    } finally {
      toolRegistry.delete(invalidOutputTool.id);
    }
  });

  it("/_dev/api/execute-tool redacts unexpected failures", async () => {
    const failingTool = dynamicTool({
      id: "dashboard-failing-tool",
      description: "Fail without leaking details",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        throw new Error("SECRET_SENTINEL provider response");
      },
    });
    toolRegistry.register(failingTool.id, failingTool);

    try {
      const response = await handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/execute-tool", { toolId: failingTool.id }),
        createMockCtx(),
      );

      assertEquals(response?.status, 500);
      assertEquals(await response?.json(), {
        error: `Tool "${failingTool.id}" could not be executed`,
      });
    } finally {
      toolRegistry.delete(failingTool.id);
    }
  });

  it("/_dev/api/execute-tool propagates request cancellation", async () => {
    const started = Promise.withResolvers<void>();
    let toolSignal: AbortSignal | undefined;
    const blockingTool = dynamicTool({
      id: "dashboard-cancelled-tool",
      description: "Wait for request cancellation",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: (_input, context) => {
        toolSignal = context?.abortSignal;
        started.resolve();
        return new Promise<never>(() => {});
      },
    });
    toolRegistry.register(blockingTool.id, blockingTool);
    const requestController = new AbortController();

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest(
          "/_dev/api/execute-tool",
          { toolId: blockingTool.id },
          requestController.signal,
        ),
        createMockCtx(),
      );
      await started.promise;
      requestController.abort(new Error("SECRET_SENTINEL cancellation reason"));
      const response = await responsePromise;

      assertEquals(response?.status, 408);
      assertEquals(toolSignal?.aborted, true);
      assertEquals(await response?.json(), { error: "Tool execution was cancelled" });
    } finally {
      requestController.abort();
      toolRegistry.delete(blockingTool.id);
    }
  });

  it("/_dev/api/execute-tool bounds a non-cooperative tool with a deadline", async () => {
    using time = new FakeTime();
    const started = Promise.withResolvers<void>();
    let toolSignal: AbortSignal | undefined;
    const blockingTool = dynamicTool({
      id: "dashboard-timed-out-tool",
      description: "Ignore the dashboard execution deadline",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: (_input, context) => {
        toolSignal = context?.abortSignal;
        started.resolve();
        return new Promise<never>(() => {});
      },
    });
    toolRegistry.register(blockingTool.id, blockingTool);

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/execute-tool", { toolId: blockingTool.id }),
        createMockCtx(),
      );
      await started.promise;
      await time.tickAsync(TOOL_EXECUTION_TIMEOUT_MS);
      await time.tickAsync(0);
      const response = await responsePromise;

      assertEquals(response?.status, 408);
      assertEquals(toolSignal?.aborted, true);
      assertEquals(await response?.json(), {
        error: `Tool "${blockingTool.id}" execution timed out`,
      });
    } finally {
      toolRegistry.delete(blockingTool.id);
    }
  });

  it("/_dev/api/read-resource returns 400 without uri", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/read-resource", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("/_dev/api/read-resource returns 404 for unknown uri", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/read-resource", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({ uri: "unknown://resource" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 404);
  });

  it("/_dev/api/read-resource propagates the request signal and exact URI", async () => {
    let loadContext: { abortSignal?: AbortSignal; uri?: string } | undefined;
    const contextual = resource({
      pattern: "dashboard://context-resource",
      description: "Capture resource load context",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: (_params, context) => {
        loadContext = context;
        return { ok: true };
      },
    });
    resourceRegistry.register(contextual.id, contextual);

    try {
      const request = dashboardMutationRequest("/_dev/api/read-resource", {
        uri: contextual.pattern,
      });
      const response = await handleDashboardAPI(request, createMockCtx());

      assertEquals(response?.status, 200);
      assertEquals(loadContext?.abortSignal instanceof AbortSignal, true);
      assertEquals(loadContext?.abortSignal?.aborted, false);
      assertEquals(loadContext?.uri, contextual.pattern);
      assertEquals(Object.isFrozen(loadContext), true);
    } finally {
      resourceRegistry.delete(contextual.id);
    }
  });

  it("/_dev/api/read-resource stops waiting when the request is cancelled", async () => {
    const started = Promise.withResolvers<void>();
    let loadSignal: AbortSignal | undefined;
    const blocking = resource({
      pattern: "dashboard://cancelled-resource",
      description: "Wait for resource cancellation",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: (_params, context) => {
        loadSignal = context?.abortSignal;
        started.resolve();
        return new Promise<never>(() => {});
      },
    });
    resourceRegistry.register(blocking.id, blocking);
    const requestController = new AbortController();

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest(
          "/_dev/api/read-resource",
          { uri: blocking.pattern },
          requestController.signal,
        ),
        createMockCtx(),
      );
      await started.promise;
      requestController.abort();
      const response = await responsePromise;

      assertEquals(response?.status, 408);
      assertEquals(loadSignal?.aborted, true);
      assertEquals(await response?.json(), { error: "Resource read was cancelled" });
    } finally {
      requestController.abort();
      resourceRegistry.delete(blocking.id);
    }
  });

  it("/_dev/api/read-resource bounds a non-cooperative loader with a deadline", async () => {
    using time = new FakeTime();
    const started = Promise.withResolvers<void>();
    let loadSignal: AbortSignal | undefined;
    const blocking = resource({
      pattern: "dashboard://timed-out-resource",
      description: "Ignore the dashboard resource deadline",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: (_params, context) => {
        loadSignal = context?.abortSignal;
        started.resolve();
        return new Promise<never>(() => {});
      },
    });
    resourceRegistry.register(blocking.id, blocking);

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/read-resource", { uri: blocking.pattern }),
        createMockCtx(),
      );
      await started.promise;
      await time.tickAsync(RESOURCE_READ_TIMEOUT_MS);
      await time.tickAsync(0);
      const response = await responsePromise;

      assertEquals(response?.status, 408);
      assertEquals(loadSignal?.aborted, true);
      assertEquals(await response?.json(), {
        error: `Resource "${blocking.id}" read timed out`,
      });
    } finally {
      resourceRegistry.delete(blocking.id);
    }
  });

  it("/_dev/api/read-resource rejects non-JSON resource output", async () => {
    const invalid = resource({
      pattern: "dashboard://invalid-output",
      description: "Invalid output",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: () => undefined,
    });
    resourceRegistry.register(invalid.id, invalid);

    try {
      const req = dashboardRequest("http://localhost/_dev/api/read-resource", {
        method: "POST",
        headers: dashboardPostHeaders(),
        body: JSON.stringify({ uri: invalid.pattern }),
      });
      const res = await handleDashboardAPI(req, createMockCtx());

      assertEquals(res?.status, 500);
      assertEquals(await res?.json(), {
        error: `Resource "${invalid.id}" returned data that is not bounded JSON`,
      });
    } finally {
      resourceRegistry.delete(invalid.id);
    }
  });

  it("/_dev/api/read-resource does not disclose loader failures", async () => {
    const failing = resource({
      pattern: "dashboard://failing-resource",
      description: "Fail safely",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: () => {
        throw new Error("SECRET_SENTINEL database response");
      },
    });
    resourceRegistry.register(failing.id, failing);

    try {
      const req = dashboardRequest("http://localhost/_dev/api/read-resource", {
        method: "POST",
        headers: dashboardPostHeaders(),
        body: JSON.stringify({ uri: failing.pattern }),
      });
      const res = await handleDashboardAPI(req, createMockCtx());

      assertEquals(res?.status, 500);
      assertEquals(await res?.json(), {
        error: `Resource "${failing.id}" could not be loaded`,
      });
    } finally {
      resourceRegistry.delete(failing.id);
    }
  });

  it("/_dev/api/read-resource maps schema rejection to bad input", async () => {
    const numeric = resource({
      pattern: "/dashboard-users/:id",
      description: "Numeric user",
      paramsSchema: defineSchema((v) => v.object({ id: v.number() }))(),
      load: ({ id }) => ({ id }),
    });
    resourceRegistry.register(numeric.id, numeric);

    try {
      const req = dashboardRequest("http://localhost/_dev/api/read-resource", {
        method: "POST",
        headers: dashboardPostHeaders(),
        body: JSON.stringify({ uri: "/dashboard-users/not-a-number" }),
      });
      const res = await handleDashboardAPI(req, createMockCtx());

      assertEquals(res?.status, 400);
      assertEquals(await res?.json(), {
        error: `Resource URI does not satisfy parameters for "${numeric.id}"`,
      });
    } finally {
      resourceRegistry.delete(numeric.id);
    }
  });

  it("/_dev/api/read-resource maps malformed URI encoding without reflecting the URI", async () => {
    const encoded = resource({
      pattern: "/dashboard-encoded/:id",
      description: "Encoded user",
      paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      load: ({ id }) => ({ id }),
    });
    resourceRegistry.register(encoded.id, encoded);

    try {
      const req = dashboardRequest("http://localhost/_dev/api/read-resource", {
        method: "POST",
        headers: dashboardPostHeaders(),
        body: JSON.stringify({ uri: "/dashboard-encoded/%E0%A4%A-SECRET_SENTINEL" }),
      });
      const res = await handleDashboardAPI(req, createMockCtx());

      assertEquals(res?.status, 400);
      assertEquals(await res?.json(), {
        error: 'Resource URI has invalid percent-encoding for parameter "id"',
      });
    } finally {
      resourceRegistry.delete(encoded.id);
    }
  });

  it("/_dev/api/read-resource rejects raw-whitespace URIs before loading", async () => {
    const bounded = resource({
      pattern: "/dashboard-bounded/:id",
      description: "Bounded user",
      paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      load: ({ id }) => ({ id }),
    });
    resourceRegistry.register(bounded.id, bounded);

    try {
      const req = dashboardRequest("http://localhost/_dev/api/read-resource", {
        method: "POST",
        headers: dashboardPostHeaders(),
        body: JSON.stringify({ uri: "/dashboard-bounded/raw value" }),
      });
      const res = await handleDashboardAPI(req, createMockCtx());

      assertEquals(res?.status, 400);
      assertEquals(await res?.json(), {
        error: "Resource URI contains raw whitespace",
      });
    } finally {
      resourceRegistry.delete(bounded.id);
    }
  });

  it("/_dev/api/render-prompt returns 400 without promptId", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/render-prompt", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("/_dev/api/render-prompt returns 404 for unknown prompt", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/render-prompt", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({ promptId: "nonexistent-prompt" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 404);
  });

  it("/_dev/api/render-prompt propagates cancellation and a finite deadline", async () => {
    let renderContext: { abortSignal?: AbortSignal; deadline?: number } | undefined;
    const contextual = prompt({
      id: "dashboard-context-prompt",
      description: "Capture prompt render context",
      generate: (_variables, context) => {
        renderContext = context;
        return "ok";
      },
    });
    promptRegistry.register(contextual.id, contextual);

    try {
      const before = Date.now();
      const request = dashboardMutationRequest("/_dev/api/render-prompt", {
        promptId: contextual.id,
      });
      const response = await handleDashboardAPI(request, createMockCtx());
      const after = Date.now();

      assertEquals(response?.status, 200);
      assertEquals(renderContext?.abortSignal instanceof AbortSignal, true);
      assertEquals(Number.isFinite(renderContext?.deadline), true);
      assertEquals((renderContext?.deadline ?? 0) >= before, true);
      assertEquals((renderContext?.deadline ?? Infinity) <= after + 30_000, true);
    } finally {
      promptRegistry.delete(contextual.id);
    }
  });

  it("/_dev/api/render-prompt cancels a pending generator with its request", async () => {
    const started = Promise.withResolvers<void>();
    let promptSignal: AbortSignal | undefined;
    const blocking = prompt({
      id: "dashboard-cancelled-prompt",
      description: "Wait for prompt cancellation",
      generate: (_variables, context) => {
        promptSignal = context?.abortSignal;
        started.resolve();
        return new Promise<never>(() => {});
      },
    });
    promptRegistry.register(blocking.id, blocking);
    const requestController = new AbortController();

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest(
          "/_dev/api/render-prompt",
          { promptId: blocking.id },
          requestController.signal,
        ),
        createMockCtx(),
      );
      await started.promise;
      requestController.abort();
      const response = await responsePromise;

      assertEquals(response?.status, 408);
      assertEquals(promptSignal?.aborted, true);
      assertEquals(await response?.json(), { error: "Prompt rendering was cancelled" });
    } finally {
      requestController.abort();
      promptRegistry.delete(blocking.id);
    }
  });

  it("/_dev/api/render-prompt bounds a non-cooperative generator with a deadline", async () => {
    using time = new FakeTime();
    const started = Promise.withResolvers<void>();
    let promptSignal: AbortSignal | undefined;
    const blocking = prompt({
      id: "dashboard-timed-out-prompt",
      description: "Ignore the dashboard prompt deadline",
      generate: (_variables, context) => {
        promptSignal = context?.abortSignal;
        started.resolve();
        return new Promise<never>(() => {});
      },
    });
    promptRegistry.register(blocking.id, blocking);

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/render-prompt", { promptId: blocking.id }),
        createMockCtx(),
      );
      await started.promise;
      await time.tickAsync(PROMPT_RENDER_TIMEOUT_MS);
      await time.tickAsync(0);
      const response = await responsePromise;

      assertEquals(response?.status, 408);
      assertEquals(promptSignal?.aborted, true);
      assertEquals(await response?.json(), {
        error: `Prompt "${blocking.id}" rendering timed out`,
      });
    } finally {
      promptRegistry.delete(blocking.id);
    }
  });

  it("/_dev/api/render-prompt bounds generated content", async () => {
    const oversized = prompt({
      id: "dashboard-oversized-prompt",
      description: "Return oversized content",
      generate: () => "x".repeat(MAX_DASHBOARD_API_BODY_BYTES + 1),
    });
    promptRegistry.register(oversized.id, oversized);

    try {
      const response = await handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/render-prompt", { promptId: oversized.id }),
        createMockCtx(),
      );

      assertEquals(response?.status, 500);
      assertEquals(await response?.json(), {
        error: `Prompt "${oversized.id}" returned content that is not bounded JSON`,
      });
    } finally {
      promptRegistry.delete(oversized.id);
    }
  });

  it("/_dev/api/render-prompt does not disclose generator failures", async () => {
    const failing = prompt({
      id: "dashboard-failing",
      description: "Fail safely",
      generate: () => {
        throw new Error("SECRET_SENTINEL provider response");
      },
    });
    promptRegistry.register(failing.id, failing);

    try {
      const req = dashboardRequest("http://localhost/_dev/api/render-prompt", {
        method: "POST",
        headers: dashboardPostHeaders(),
        body: JSON.stringify({ promptId: failing.id }),
      });
      const res = await handleDashboardAPI(req, createMockCtx());

      assertEquals(res?.status, 500);
      assertEquals(await res?.json(), {
        error: 'Prompt "dashboard-failing" could not be rendered',
      });
    } finally {
      promptRegistry.delete(failing.id);
    }
  });

  it("/_dev/api/start-workflow returns 400 without workflowId", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/start-workflow", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("/_dev/api/start-workflow returns 404 for unknown workflow", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/start-workflow", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({ workflowId: "nonexistent-workflow" }),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 404);
  });

  it("/_dev/api/start-workflow preserves string tool resolution and project identity", async () => {
    const workflowId = "dashboard-workflow-context";
    const toolId = "dashboard-workflow-context-tool";
    let executionContext: ToolExecutionContext | undefined;
    const contextTool = dynamicTool({
      id: toolId,
      description: "Capture workflow execution context",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: (_input, context) => {
        executionContext = context;
        return { ok: true };
      },
    });
    toolRegistry.register(toolId, contextTool);
    workflow({
      id: workflowId,
      steps: [toolStep("capture", toolId)],
    });

    try {
      const response = await handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/start-workflow", { workflowId, input: {} }),
        createWorkflowProjectCtx(),
      );
      const responseText = await response!.text();

      assertEquals(response!.status, 200);
      assertEquals({
        projectId: executionContext?.projectId,
        projectSlug: executionContext?.projectSlug,
        productionMode: executionContext?.productionMode,
        releaseId: executionContext?.releaseId,
        branch: executionContext?.branch,
        environmentName: executionContext?.environmentName,
        authToken: executionContext?.authToken,
        hasAbortSignal: executionContext?.abortSignal instanceof AbortSignal,
      }, {
        projectId: "project-id-a",
        projectSlug: "project-a",
        productionMode: false,
        releaseId: null,
        branch: "feature-a",
        environmentName: "Development",
        authToken: "",
        hasAbortSignal: true,
      });
      assertEquals(responseText.includes("SECRET_SENTINEL"), false);
      const responseBody = JSON.parse(responseText);
      assertEquals(responseBody.success, true);
      assertEquals(responseBody.status, "completed");
      assertEquals(responseBody.nodeStates.capture.status, "completed");
      assertEquals(typeof responseBody.nodeStates.capture.startedAt, "string");
      assertEquals(typeof responseBody.nodeStates.capture.completedAt, "string");
    } finally {
      workflowRegistry.unregister(workflowId);
      toolRegistry.delete(toolId);
    }
  });

  it("/_dev/api/start-workflow preserves project identity without requestContext", async () => {
    const workflowId = "dashboard-workflow-context-without-request-context";
    const toolId = "dashboard-workflow-context-without-request-context-tool";
    let executionContext: ToolExecutionContext | undefined;
    const contextTool = dynamicTool({
      id: toolId,
      description: "Capture synthesized workflow project context",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: (_input, context) => {
        executionContext = context;
        return { ok: true };
      },
    });
    toolRegistry.register(toolId, contextTool);
    workflow({
      id: workflowId,
      steps: [toolStep("capture", toolId)],
    });
    const ctx = {
      ...createMockCtx(),
      projectId: "project-id-without-request-context",
      projectSlug: "project-without-request-context",
      resolvedEnvironment: "production",
      environmentName: "Production",
    } as unknown as HandlerContext;

    try {
      const response = await handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/start-workflow", { workflowId, input: {} }),
        ctx,
      );

      assertEquals(response?.status, 200);
      assertEquals({
        projectId: executionContext?.projectId,
        projectSlug: executionContext?.projectSlug,
        productionMode: executionContext?.productionMode,
        releaseId: executionContext?.releaseId,
        environmentName: executionContext?.environmentName,
        authToken: executionContext?.authToken,
      }, {
        projectId: "project-id-without-request-context",
        projectSlug: "project-without-request-context",
        productionMode: true,
        releaseId: null,
        environmentName: "Production",
        authToken: "",
      });
    } finally {
      workflowRegistry.unregister(workflowId);
      toolRegistry.delete(toolId);
    }
  });

  it("/_dev/api/start-workflow does not poll before returning an immediate result", async () => {
    using time = new FakeTime();
    const workflowId = "dashboard-workflow-immediate-result";
    workflow({
      id: workflowId,
      steps: [
        toolStep(
          "complete",
          dynamicTool({
            id: "dashboard-workflow-immediate-result-tool",
            description: "Complete immediately",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => ({ ok: true }),
          }),
        ),
      ],
    });
    const requestController = new AbortController();

    try {
      let settled = false;
      let response: Response | null = null;
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest(
          "/_dev/api/start-workflow",
          { workflowId, input: {} },
          requestController.signal,
        ),
        createMockCtx(),
      );
      responsePromise.then((value) => {
        settled = true;
        response = value;
      });
      await time.tickAsync(0);
      const completedWithoutPollingDelay = settled;

      if (!settled) {
        requestController.abort();
        await time.tickAsync(0);
        response = await responsePromise;
      }

      assertEquals(completedWithoutPollingDelay, true);
      assertEquals(response?.status, 200);
    } finally {
      requestController.abort();
      workflowRegistry.unregister(workflowId);
    }
  });

  it("/_dev/api/start-workflow bounds a non-cooperative completion hook", async () => {
    const workflowId = "dashboard-workflow-blocked-completion-hook";
    const hookStarted = Promise.withResolvers<void>();
    workflow({
      id: workflowId,
      steps: [
        toolStep(
          "complete",
          dynamicTool({
            id: "dashboard-workflow-blocked-completion-hook-tool",
            description: "Complete before the lifecycle hook",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => ({ ok: true }),
          }),
        ),
      ],
      onComplete: () => {
        hookStarted.resolve();
        return new Promise<never>(() => {});
      },
    });
    const requestController = new AbortController();

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest(
          "/_dev/api/start-workflow",
          { workflowId, input: {} },
          requestController.signal,
        ),
        createMockCtx(),
      );
      await hookStarted.promise;
      requestController.abort(new Error("SECRET_SENTINEL lifecycle disconnect"));
      const response = await responsePromise;
      const responseText = await response!.text();

      assertEquals(response?.status, 408);
      assertEquals(JSON.parse(responseText), {
        success: false,
        error: "Workflow execution was cancelled",
      });
      assertEquals(responseText.includes("SECRET_SENTINEL"), false);
    } finally {
      requestController.abort();
      workflowRegistry.unregister(workflowId);
    }
  });

  it("/_dev/api/start-workflow bounds a non-cooperative failure hook", async () => {
    const workflowId = "dashboard-workflow-blocked-failure-hook";
    const hookStarted = Promise.withResolvers<void>();
    workflow({
      id: workflowId,
      steps: [
        toolStep(
          "fail",
          dynamicTool({
            id: "dashboard-workflow-blocked-failure-hook-tool",
            description: "Fail before the lifecycle hook",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => {
              throw new Error("SECRET_SENTINEL workflow failure");
            },
          }),
        ),
      ],
      onError: () => {
        hookStarted.resolve();
        return new Promise<never>(() => {});
      },
    });
    const requestController = new AbortController();

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest(
          "/_dev/api/start-workflow",
          { workflowId, input: {} },
          requestController.signal,
        ),
        createMockCtx(),
      );
      await hookStarted.promise;
      requestController.abort(new Error("SECRET_SENTINEL failure-hook disconnect"));
      const response = await responsePromise;
      const responseText = await response!.text();

      assertEquals(response?.status, 408);
      assertEquals(JSON.parse(responseText), {
        success: false,
        error: "Workflow execution was cancelled",
      });
      assertEquals(responseText.includes("SECRET_SENTINEL"), false);
    } finally {
      requestController.abort();
      workflowRegistry.unregister(workflowId);
    }
  });

  it("/_dev/api/start-workflow cancels and settles a timed-out run", async () => {
    using time = new FakeTime();
    const workflowId = "dashboard-workflow-timeout";
    const started = Promise.withResolvers<void>();
    let toolSignal: AbortSignal | undefined;
    const blockingTool = dynamicTool({
      id: "dashboard-workflow-timeout-tool",
      description: "Wait for the dashboard workflow deadline",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: (_input, context) => {
        toolSignal = context?.abortSignal;
        started.resolve();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => reject(toolSignal?.reason);
          if (toolSignal?.aborted) abort();
          else toolSignal?.addEventListener("abort", abort, { once: true });
        });
      },
    });
    workflow({
      id: workflowId,
      steps: [toolStep("block", blockingTool)],
    });

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/start-workflow", { workflowId, input: {} }),
        createMockCtx(),
      );
      await started.promise;
      await time.tickAsync(WORKFLOW_EXECUTION_TIMEOUT_MS);
      await time.tickAsync(0);
      const response = await responsePromise;

      assertEquals(response?.status, 408);
      assertEquals(toolSignal?.aborted, true);
      assertEquals(await response?.json(), {
        success: false,
        error: "Workflow execution timed out and was cancelled",
      });
    } finally {
      workflowRegistry.unregister(workflowId);
    }
  });

  it("/_dev/api/start-workflow keeps a waiting run under the request deadline", async () => {
    using time = new FakeTime();
    const workflowId = "dashboard-workflow-waiting-timeout";
    const started = Promise.withResolvers<void>();
    workflow({
      id: workflowId,
      version: "1",
      steps: [
        toolStep(
          "start",
          dynamicTool({
            id: "dashboard-workflow-waiting-timeout-tool",
            description: "Signal that the waiting workflow started",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => {
              started.resolve();
              return { ok: true };
            },
          }),
        ),
        waitForApproval("approval"),
      ],
    });

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/start-workflow", { workflowId, input: {} }),
        createMockCtx(),
      );
      await started.promise;
      await time.tickAsync(WORKFLOW_EXECUTION_TIMEOUT_MS);
      await time.tickAsync(0);
      const response = await responsePromise;

      assertEquals(response?.status, 408);
      assertEquals(await response?.json(), {
        success: false,
        error: "Workflow execution timed out and was cancelled",
      });
    } finally {
      workflowRegistry.unregister(workflowId);
    }
  });

  it("/_dev/api/start-workflow cancels and settles a disconnected run", async () => {
    const workflowId = "dashboard-workflow-disconnect";
    const started = Promise.withResolvers<void>();
    let toolSignal: AbortSignal | undefined;
    const blockingTool = dynamicTool({
      id: "dashboard-workflow-disconnect-tool",
      description: "Wait for dashboard request cancellation",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: (_input, context) => {
        toolSignal = context?.abortSignal;
        started.resolve();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => reject(toolSignal?.reason);
          if (toolSignal?.aborted) abort();
          else toolSignal?.addEventListener("abort", abort, { once: true });
        });
      },
    });
    workflow({
      id: workflowId,
      steps: [toolStep("block", blockingTool)],
    });
    const requestController = new AbortController();

    try {
      const responsePromise = handleDashboardAPI(
        dashboardMutationRequest(
          "/_dev/api/start-workflow",
          { workflowId, input: {} },
          requestController.signal,
        ),
        createMockCtx(),
      );
      await started.promise;
      requestController.abort(new Error("SECRET_SENTINEL disconnect reason"));
      const response = await responsePromise;
      const responseText = await response!.text();

      assertEquals(response!.status, 408);
      assertEquals(toolSignal?.aborted, true);
      assertEquals(JSON.parse(responseText), {
        success: false,
        error: "Workflow execution was cancelled",
      });
      assertEquals(responseText.includes("SECRET_SENTINEL"), false);
    } finally {
      requestController.abort();
      workflowRegistry.unregister(workflowId);
    }
  });

  it("/_dev/api/start-workflow uses the current definition for every request", async () => {
    const workflowId = "dashboard-workflow-refresh";
    let firstExecutions = 0;
    let secondExecutions = 0;
    const registerGeneration = (generation: "first" | "second") => {
      const generationTool = dynamicTool({
        id: `${workflowId}-${generation}`,
        description: `Execute the ${generation} workflow generation`,
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => {
          if (generation === "first") firstExecutions++;
          else secondExecutions++;
          return { generation };
        },
      });
      workflow({
        id: workflowId,
        steps: [toolStep("generation", generationTool)],
      });
    };

    try {
      registerGeneration("first");
      const firstResponse = await handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/start-workflow", { workflowId, input: {} }),
        createMockCtx(),
      );
      assertEquals(firstResponse?.status, 200);
      assertEquals(firstExecutions, 1);
      assertEquals(secondExecutions, 0);

      workflowRegistry.unregister(workflowId);
      registerGeneration("second");
      const secondResponse = await handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/start-workflow", { workflowId, input: {} }),
        createMockCtx(),
      );

      assertEquals(secondResponse?.status, 200);
      assertEquals(firstExecutions, 1);
      assertEquals(secondExecutions, 1);
    } finally {
      workflowRegistry.unregister(workflowId);
    }
  });

  it("/_dev/api/start-workflow redacts workflow failures", async () => {
    const workflowId = "dashboard-workflow-failure";
    const failingTool = dynamicTool({
      id: "dashboard-workflow-failure-tool",
      description: "Fail without leaking workflow details",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        throw new Error("SECRET_SENTINEL workflow failure");
      },
    });
    workflow({
      id: workflowId,
      steps: [toolStep("fail", failingTool)],
    });

    try {
      const response = await handleDashboardAPI(
        dashboardMutationRequest("/_dev/api/start-workflow", { workflowId, input: {} }),
        createMockCtx(),
      );
      const responseText = await response!.text();

      assertEquals(response!.status, 500);
      assertEquals(JSON.parse(responseText), {
        error: `Workflow "${workflowId}" could not be completed`,
      });
      assertEquals(responseText.includes("SECRET_SENTINEL"), false);
    } finally {
      workflowRegistry.unregister(workflowId);
    }
  });

  it("/_dev/api/hmr-trigger returns success info", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/hmr-trigger", {
      method: "POST",
      headers: dashboardPostHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
    const body = await res!.json();
    // No HMR listeners → success: false
    assertEquals("success" in body, true);
  });

  it("/_dev/api/hmr-trigger with path", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/hmr-trigger", {
      method: "POST",
      headers: dashboardPostHeaders(),
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
      const req = dashboardRequest("http://localhost/_dev/api/hmr-trigger", {
        method: "POST",
        headers: dashboardPostHeaders(),
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
    const req = dashboardRequest("http://localhost/_dev/api/unknown", { method: "POST" });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res, null);
  });
});

describe("Dashboard API - other methods", () => {
  it("returns null for PUT request", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/stats", { method: "PUT" });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res, null);
  });

  it("returns null for DELETE request", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/stats", { method: "DELETE" });
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res, null);
  });
});

describe("Dashboard API path validation", () => {
  it("rejects path traversal with '..' in list files", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/files?path=../../etc/passwd");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
    const body = await res!.json();
    assertEquals(body.error.includes("Invalid path"), true);
  });

  it("rejects encoded path traversal in list files", async () => {
    const req = dashboardRequest(
      "http://localhost/_dev/api/files?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects null bytes in list files", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/files?path=src%00.ts");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("allows valid relative paths in list files", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/files?path=src/components");
    const res = await handleDashboardAPI(req, createMockCtx());
    // Should succeed (200) since mock adapter returns empty readDir
    assertEquals(res?.status, 200);
  });

  it("rejects path traversal in file-content", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/file-content?path=../../etc/passwd");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects encoded path traversal in file-content", async () => {
    const req = dashboardRequest(
      "http://localhost/_dev/api/file-content?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects null bytes in file-content", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/file-content?path=src%00.ts");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("allows filenames with percent signs (no double-decoding)", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/files?path=reports%2F100%25done");
    const res = await handleDashboardAPI(req, createMockCtx());
    // searchParams.get decodes to "reports/100%done" — should not fail
    assertEquals(res?.status, 200);
  });

  it("requires path parameter for file-content", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/file-content");
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
      const req = dashboardRequest(url);
      const res = await handleDashboardAPI(req, createMockCtx());
      assertEquals(res?.status, 400, `expected 400 for ${label}: ${rawQuery}`);
    });

    it(`file-content endpoint rejects ${label}`, async () => {
      const url = `http://localhost/_dev/api/file-content?path=${rawQuery}`;
      const req = dashboardRequest(url);
      const res = await handleDashboardAPI(req, createMockCtx());
      assertEquals(res?.status, 400, `expected 400 for ${label}: ${rawQuery}`);
    });
  }

  it("double-encoded %252e%252e does not traverse (decoded once to %2e%2e)", async () => {
    // searchParams decodes once → literal "%2e%2e/%2e%2e/etc/passwd" which is
    // NOT a traversal (no real ".."). validator treats it as a filename and
    // joins under projectDir. The readDir will fail at the adapter (mock is
    // empty) but critically the path must NOT resolve to /etc/passwd.
    const req = dashboardRequest(
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
    const req = dashboardRequest(
      `http://localhost/_dev/api/files?path=${encodeURIComponent(nfc)}`,
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("unicode NFD form in relative path is accepted", async () => {
    // NFD form of "é" is "e" + U+0301 combining acute accent.
    const nfd = "src/cafe\u0301.ts";
    const req = dashboardRequest(
      `http://localhost/_dev/api/files?path=${encodeURIComponent(nfd)}`,
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("positive: nested relative path with hyphen and dot files is accepted", async () => {
    const req = dashboardRequest(
      "http://localhost/_dev/api/files?path=src/components/.config-dir",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("positive: empty path lists project root", async () => {
    const req = dashboardRequest("http://localhost/_dev/api/files?path=");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 200);
  });

  it("file-content rejects absolute path that normalisation could collapse", async () => {
    // Reproduces VULN-FS-2 primary exploit: /project//etc/passwd → /etc/passwd
    // after adapter path normalisation. The strict validator must reject the
    // absolute /etc/passwd value before reaching the adapter.
    const req = dashboardRequest(
      "http://localhost/_dev/api/file-content?path=%2Fetc%2Fpasswd",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });
});
