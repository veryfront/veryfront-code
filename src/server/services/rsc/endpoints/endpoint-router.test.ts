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

  describe("action endpoint - POST handling", () => {
    it("handles POST action with missing body id", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ args: [] }),
          }),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
    });

    it("handles POST action with invalid JSON body", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "not json",
          }),
        }),
      );
      assertEquals(result instanceof Response, true);
      // Should still get a response (400 for bad body)
      assertEquals(result!.status, 400);
    });

    it("handles POST action with path traversal id", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "../evil", args: [] }),
          }),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
    });

    it("handles POST action with valid id but non-existent file returns error", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "valid-action", args: ["hello"] }),
          }),
        }),
      );
      assertEquals(result instanceof Response, true);
      // The import of the non-existent file will fail, resulting in a 500
      assertEquals(result!.status, 500);
    });

    it("rejects DELETE with 405", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", { method: "DELETE" }),
        }),
      );
      assertEquals(result!.status, 405);
    });
  });

  describe("payload endpoint", () => {
    it("returns JSON with html, modules, slots keys", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/payload",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/payload"),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      const body = await result!.json();
      assertEquals("html" in body, true);
      assertEquals("modules" in body, true);
      assertEquals("slots" in body, true);
    });

    it("uses name param in payload response", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/payload",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/payload?name=Test"),
        }),
      );
      const body = await result!.json();
      assertStringIncludes(body.html, "Test");
    });

    it("escapes HTML in payload name", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/payload",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/payload?name=<script>xss</script>",
          ),
        }),
      );
      const body = await result!.json();
      assertEquals(body.html.includes("<script>"), false);
      assertStringIncludes(body.html, "&lt;script&gt;");
    });
  });

  describe("manifest endpoint", () => {
    it("returns response when RSC enabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/manifest",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
    });
  });

  describe("hydrator script endpoints", () => {
    it("returns response for hydrator.js", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/hydrator.js",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
    });

    it("returns response for hydrate.js", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/hydrate.js",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
    });
  });

  describe("page endpoint (root)", () => {
    it("returns response for /_veryfront/rsc/page", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/page",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
    });
  });

  describe("module endpoint - fs error handling", () => {
    it("returns 500 when fs.exists throws", async () => {
      const adapter = createMockAdapter({
        exists: () => {
          throw new Error("fs error");
        },
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=foo.js"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 500);
    });

    it("handles leading slash in rel param", async () => {
      const adapter = createMockAdapter({
        exists: (path: string) => Promise.resolve(path.includes("/app/test.js")),
        readFile: () => Promise.resolve("export default {}"),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=/test.js",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
    });
  });

  describe("module endpoint - edge cases", () => {
    it("returns 400 for backslash path traversal", async () => {
      const adapter = createMockAdapter({
        exists: () => Promise.resolve(true),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=..\\..\\etc\\passwd",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
    });

    it("serves file from app directory root", async () => {
      const adapter = createMockAdapter({
        exists: (path: string) => Promise.resolve(path.includes("/app/component.js")),
        readFile: () => Promise.resolve("export default {}"),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=component.js"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      const body = await result!.text();
      assertEquals(body, "export default {}");
    });
  });

  describe("stream endpoint - sub-paths", () => {
    it("returns null for stream sub-path when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream/sub",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for page sub-path when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/page/sub",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for render sub-path when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/render/sub",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });
  });
});
