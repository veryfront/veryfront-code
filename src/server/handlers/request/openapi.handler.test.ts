import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OpenAPIHandler } from "./openapi.handler.ts";
import type { HandlerContext } from "../types.ts";

function createMockFs(
  opts: { existsReturn?: boolean; needsContext?: boolean; multiProject?: boolean } = {},
) {
  const calls: string[] = [];
  const fs: Record<string, unknown> = {
    exists: async (_path: string) => {
      calls.push(`exists:${_path}`);
      return opts.existsReturn ?? false;
    },
    readDir: async function* () {/* empty */},
    readFile: async () => "",
    stat: async () => ({
      size: 0,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      mtime: null,
    }),
  };

  if (opts.needsContext) {
    // Simulate extended FS adapter that requires context
    fs.isVeryfrontAdapter = () => true;
    fs.getUnderlyingAdapter = () => ({});
    fs.isMultiProjectMode = () => opts.multiProject !== false;
    fs.isContextualMode = () => true;
    fs.getAdapterType = () => "VeryfrontFSAdapter";
    fs.runWithContext = async (
      _slug: string,
      _token: string,
      fn: () => Promise<unknown>,
      _projectId?: string,
      _options?: Record<string, unknown>,
    ) => {
      calls.push("runWithContext");
      return await fn();
    };
  }

  return { fs, calls };
}

function createCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: { fs: createMockFs().fs } as never,
    config: { openapi: { enabled: true } },
    isLocalProject: true,
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/openapi.handler", () => {
  describe("remote execution isolation", () => {
    it("fails closed before route discovery or proxy context setup", async () => {
      const { fs, calls } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        projectId: "proj-123",
        resolvedEnvironment: "production",
        parsedDomain: { branch: null } as never,
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 503);
      const body = JSON.parse(await result.response!.text());
      assertEquals(body.error, "Isolated OpenAPI generation is unavailable");
      assertEquals(calls.includes("runWithContext"), false);
      assertEquals(calls.some((call) => call.startsWith("exists:")), false);
    });
  });

  describe("local generation", () => {
    it("should NOT call runWithContext for local projects", async () => {
      const { fs, calls } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: true,
        projectSlug: "test-project",
        proxyToken: "test-token",
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(calls.includes("runWithContext"), false);
      assertEquals(
        result.response!.headers.get("content-type"),
        "application/json; charset=utf-8",
        "the json route must serve JSON",
      );
      const spec = JSON.parse(await result.response!.text());
      assertEquals(spec.openapi, "3.1.0", "the served document must be a real OpenAPI spec");
      assertExists(spec.paths, "the spec must carry a paths object");
      assertExists(spec.info, "the spec must carry an info object");
    });

    it("serves the YAML document on the yaml route", async () => {
      const { fs } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({ adapter: { fs } as never, isLocalProject: true });

      const result = await handler.handle(
        new Request("https://example.com/_openapi.yaml"),
        ctx,
      );

      assertEquals(result.response?.status, 200);
      assertEquals(
        result.response!.headers.get("content-type"),
        "text/yaml; charset=utf-8",
        "the yaml route must serve YAML",
      );
      const body = await result.response!.text();
      assertStringIncludes(body, "openapi:", "the yaml route must serve YAML, not JSON");
      assertEquals(body.trimStart().startsWith("{"), false, "the yaml body must not be JSON");
    });

    it("serves the document on configured paths instead of the defaults", async () => {
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        config: {
          openapi: { enabled: true, paths: { json: "/docs/spec.json", yaml: "/docs/spec.yaml" } },
        } as never,
      });

      const custom = await handler.handle(new Request("https://example.com/docs/spec.json"), ctx);
      assertEquals(custom.response?.status, 200, "the configured json path must be served");
      const customYaml = await handler.handle(
        new Request("https://example.com/docs/spec.yaml"),
        ctx,
      );
      assertEquals(
        customYaml.response?.headers.get("content-type"),
        "text/yaml; charset=utf-8",
        "the configured yaml path must serve YAML",
      );

      const fallback = await handler.handle(new Request("https://example.com/_openapi.json"), ctx);
      assertEquals(fallback.continue, true, "the default path must not be served once overridden");
      assertEquals(fallback.response, undefined);
    });
  });

  describe("metadata.enabled", () => {
    it("opts out when config.openapi.enabled is false", () => {
      const handler = new OpenAPIHandler();
      const enabled = handler.metadata.enabled!;

      assertEquals(
        enabled(createCtx({ config: { openapi: { enabled: false } } as never })),
        false,
        "config.openapi.enabled === false must disable the handler",
      );
      assertEquals(enabled(createCtx()), true, "an enabled config must keep the handler on");
      assertEquals(
        enabled(createCtx({ config: {} as never })),
        true,
        "the handler must be on by default when openapi config is absent",
      );
    });
  });
});
