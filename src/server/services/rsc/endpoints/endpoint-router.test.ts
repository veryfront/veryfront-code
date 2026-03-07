import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleRSCEndpoint } from "./endpoint-router.ts";
import type { RSCEndpointParams } from "./types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

/** Minimal mock adapter with fs operations for module endpoint tests */
function createMockAdapter(
  fsOverrides: {
    exists?: (path: string) => Promise<boolean>;
    readFile?: (path: string) => Promise<string>;
  } = {},
): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: fsOverrides.exists ?? (() => Promise.resolve(false)),
      readFile: fsOverrides.readFile ?? (() => Promise.resolve("")),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: {
      createHandler: () => () => new Response(),
    },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

/** Config with RSC enabled */
const rscEnabledConfig: VeryfrontConfig = {
  experimental: { rsc: true },
} as unknown as VeryfrontConfig;

/** Config with RSC disabled */
const rscDisabledConfig: VeryfrontConfig = {
  experimental: { rsc: false },
} as unknown as VeryfrontConfig;

/** Config with no experimental section */
const noExperimentalConfig: VeryfrontConfig = {} as unknown as VeryfrontConfig;

function makeParams(
  overrides: Partial<RSCEndpointParams> & { pathname: string },
): RSCEndpointParams {
  return {
    projectDir: overrides.projectDir ?? "/tmp/test-project",
    adapter: overrides.adapter ?? createMockAdapter(),
    config: overrides.config,
    ...overrides,
    req: overrides.req ?? new Request("http://localhost" + overrides.pathname),
  };
}

describe("server/services/rsc/endpoints/endpoint-router", () => {
  describe("non-RSC paths", () => {
    it("returns null for paths not starting with /_veryfront/rsc/", async () => {
      const result = await handleRSCEndpoint(makeParams({ pathname: "/some/other/path" }));
      assertEquals(result, null);
    });

    it("returns null for root path", async () => {
      const result = await handleRSCEndpoint(makeParams({ pathname: "/" }));
      assertEquals(result, null);
    });

    it("returns null for similar but not matching prefix", async () => {
      const result = await handleRSCEndpoint(
        makeParams({ pathname: "/_veryfront/rscx/something" }),
      );
      assertEquals(result, null);
    });

    it("returns null for partial prefix /_veryfront/rsc (no trailing slash)", async () => {
      const result = await handleRSCEndpoint(makeParams({ pathname: "/_veryfront/rsc" }));
      assertEquals(result, null);
    });
  });

  describe("flight_page (deprecated)", () => {
    it("returns 410 Gone regardless of RSC config", async () => {
      const result = await handleRSCEndpoint(
        makeParams({ pathname: "/_veryfront/rsc/flight_page" }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 410);
      const body = await result!.text();
      assertStringIncludes(body, "Flight endpoint removed");
    });

    it("returns 410 Gone even when RSC is enabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/flight_page",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result!.status, 410);
    });

    it("returns 410 Gone even when RSC is disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/flight_page",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result!.status, 410);
    });
  });

  describe("RSC not enabled", () => {
    it("returns null for RSC sub-endpoints when config has rsc: false", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/probe",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for RSC sub-endpoints when no config provided", async () => {
      const result = await handleRSCEndpoint(
        makeParams({ pathname: "/_veryfront/rsc/probe" }),
      );
      assertEquals(result, null);
    });

    it("returns null for RSC sub-endpoints when no experimental section", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/probe",
          config: noExperimentalConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for stream endpoint when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for module endpoint when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });
  });

  describe("probe endpoint", () => {
    it("returns JSON {ok: true, rsc: true} when RSC enabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/probe",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      assertEquals(result!.headers.get("content-type"), "application/json");
      const body = await result!.json();
      assertEquals(body, { ok: true, rsc: true });
    });
  });

  describe("action endpoint", () => {
    it("rejects non-POST with 405", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", { method: "GET" }),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 405);
      const body = await result!.text();
      assertStringIncludes(body, "Method Not Allowed");
    });

    it("rejects PUT with 405", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", { method: "PUT" }),
        }),
      );
      assertEquals(result!.status, 405);
    });
  });

  describe("module endpoint", () => {
    it("returns 400 when missing rel param", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module"),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
      const body = await result!.text();
      assertStringIncludes(body, "Missing rel query parameter");
    });

    it("serves file when found in candidate roots", async () => {
      const adapter = createMockAdapter({
        exists: (path: string) => Promise.resolve(path.includes("/src/hello.js")),
        readFile: () => Promise.resolve("console.log('hello');"),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=hello.js"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      assertEquals(
        result!.headers.get("content-type"),
        "application/javascript; charset=utf-8",
      );
      const body = await result!.text();
      assertEquals(body, "console.log('hello');");
    });

    it("returns 404 when file not found in any candidate root", async () => {
      const adapter = createMockAdapter({
        exists: () => Promise.resolve(false),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=nonexistent.js"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 404);
    });

    it("returns 400 for path traversal attempts without touching the filesystem", async () => {
      const attemptedPaths: string[] = [];
      const adapter = createMockAdapter({
        exists: (path: string) => {
          attemptedPaths.push(path);
          return Promise.resolve(true);
        },
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=../../etc/passwd",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
      assertEquals(attemptedPaths, []);
      const body = await result!.text();
      assertStringIncludes(body, "Invalid rel query parameter");
    });
  });

  describe("stream endpoint (root)", () => {
    it("returns NDJSON with name parameter", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/stream?name=Alice"),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      assertEquals(result!.headers.get("content-type"), "application/x-ndjson");

      const body = await result!.text();
      assertStringIncludes(body, "Alice");
      // Verify it's NDJSON (lines of JSON)
      const lines = body.trim().split("\n");
      assertEquals(lines.length >= 4, true);
      // Each non-malformed line should be valid JSON
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assertEquals(typeof parsed.type, "string");
      }
    });

    it("defaults name to World when no name param", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/stream"),
        }),
      );
      const body = await result!.text();
      assertStringIncludes(body, "World");
    });

    it("escapes HTML in name (XSS prevention)", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/stream?name=<script>alert(1)</script>",
          ),
        }),
      );
      const body = await result!.text();
      // The raw <script> tag should NOT appear in the output
      assertEquals(body.includes("<script>"), false);
      // Escaped version should appear
      assertStringIncludes(body, "&lt;script&gt;");
    });

    it("includes malformed JSON when ?bad param present", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/stream?bad"),
        }),
      );
      const body = await result!.text();
      assertStringIncludes(body, "{malformed json}");
      // Should have 5 lines (4 normal + 1 malformed)
      const lines = body.trim().split("\n");
      assertEquals(lines.length, 5);
    });

    it("does not include malformed JSON without ?bad param", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/stream"),
        }),
      );
      const body = await result!.text();
      assertEquals(body.includes("{malformed json}"), false);
      const lines = body.trim().split("\n");
      assertEquals(lines.length, 4);
    });
  });

  describe("unknown RSC sub-endpoint", () => {
    it("returns null for unrecognized sub-endpoint when RSC enabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/unknown-thing",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result, null);
    });
  });
});
