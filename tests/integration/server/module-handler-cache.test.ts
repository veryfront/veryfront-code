import { assertEquals, assertMatch } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { makeTempDir, mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import type { HandlerContext } from "../../../src/server/handlers/types.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { getConfig } from "#veryfront/config";

async function setupProject(): Promise<string> {
  const dir = await makeTempDir({ prefix: "vf_module_cache_" });
  await mkdir(join(dir, "pages"), { recursive: true });
  await writeTextFile(join(dir, "pages", "index.mdx"), `# Hello`);
  return dir;
}

function createBuilder(ctx: HandlerContext): ResponseBuilder {
  return new ResponseBuilder({
    securityConfig: ctx.securityConfig ?? undefined,
    isDev: !!ctx.isLocalProject, // Default to false in test environment
    cspUserHeader: ctx.cspUserHeader ?? undefined,
    adapter: ctx.adapter,
  });
}

function respond(response: Response): { response: Response; continue: false } {
  return { response, continue: false };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createHandlerContext(projectDir: string): Promise<HandlerContext> {
  const adapter = await getAdapter();
  const config = await getConfig(projectDir, adapter);

  return {
    projectDir,
    adapter,
    moduleServerUrl: undefined,
    securityConfig: null,
    cspUserHeader: null,
    debug: false,
    config,
  };
}

async function cleanupProject(projectDir: string): Promise<void> {
  await cleanupBundler();
  const adapter = await getAdapter();
  await adapter.fs.remove(projectDir, { recursive: true });
}

describe("Module Handler Cache Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("Page Module Handler", () => {
    it("returns cached ETag for page modules", async () => {
      const projectDir = await setupProject();

      try {
        const handlerContext = await createHandlerContext(projectDir);

        const { handlePageModule } = await import(
          "../../../src/server/handlers/request/module/page-module-handler.ts"
        );

        const req1 = new Request("http://localhost/_veryfront/pages/index.js");
        const res1 = (await handlePageModule(
          req1,
          "/_veryfront/pages/index.js",
          handlerContext,
          () => createBuilder(handlerContext),
          respond,
          getErrorMessage,
        )).response;

        if (!res1) throw new Error("Expected response for first module request");
        assertEquals(res1.status, 200);

        const text = await res1.text();
        assertMatch(text, /export default/);

        const etag = res1.headers.get("etag");
        if (!etag) throw new Error("ETag missing from module response");

        const req2 = new Request("http://localhost/_veryfront/pages/index.js", {
          headers: { "if-none-match": etag },
        });
        const res2 = (await handlePageModule(
          req2,
          "/_veryfront/pages/index.js",
          handlerContext,
          () => createBuilder(handlerContext),
          respond,
          getErrorMessage,
        )).response;

        if (!res2) throw new Error("Expected response for cached module request");
        assertEquals(res2.status, 304);
        await res2.body?.cancel();
      } finally {
        await cleanupProject(projectDir);
      }
    });
  });

  describe("Data Endpoint Handler", () => {
    it("caches data endpoint responses", async () => {
      const projectDir = await setupProject();

      try {
        const handlerContext = await createHandlerContext(projectDir);

        const { handleDataEndpoint } = await import(
          "../../../src/server/handlers/request/module/data-endpoint-handler.ts"
        );

        const req1 = new Request("http://localhost/_veryfront/data/index.json");
        const res1 = (await handleDataEndpoint(
          req1,
          "/_veryfront/data/index.json",
          handlerContext,
          () => createBuilder(handlerContext),
          respond,
          getErrorMessage,
        )).response;

        if (!res1) throw new Error("Expected data response");
        assertEquals(res1.status, 200);

        const etag = res1.headers.get("etag");
        if (!etag) throw new Error("ETag missing from data response");
        await res1.body?.cancel();

        const req2 = new Request("http://localhost/_veryfront/data/index.json", {
          headers: { "if-none-match": etag },
        });
        const res2 = (await handleDataEndpoint(
          req2,
          "/_veryfront/data/index.json",
          handlerContext,
          () => createBuilder(handlerContext),
          respond,
          getErrorMessage,
        )).response;

        if (!res2) throw new Error("Expected cached data response");
        assertEquals(res2.status, 304);
        await res2.body?.cancel();
      } finally {
        await cleanupProject(projectDir);
      }
    });
  });
});
