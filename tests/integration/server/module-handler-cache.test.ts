import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import type { HandlerContext } from "../../../src/server/handlers/types.ts";
import { denoAdapter } from "@veryfront/platform/adapters/runtime/deno/index.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { getConfig } from "@veryfront/config";

async function setupProject(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "vf_module_cache_" });
  await Deno.mkdir(join(dir, "pages"), { recursive: true });
  await Deno.writeTextFile(join(dir, "pages", "index.mdx"), `# Hello`);
  return dir;
}

function createBuilder(ctx: HandlerContext): ResponseBuilder {
  return new ResponseBuilder({
    securityConfig: ctx.securityConfig ?? undefined,
    isDev: ctx.mode === "development",
    cspUserHeader: ctx.cspUserHeader ?? undefined,
    adapter: ctx.adapter,
  });
}

const respond = (response: Response) => ({ response, continue: false });
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

denoTest("Module handler returns cached ETag for page modules", async (ctx) => {
  const { handlePageModule } = await import(
    "../../../src/server/handlers/request/module/page-module-handler.ts"
  );

  const req1 = new Request("http://localhost/_veryfront/pages/index.js");
  const res1 = (await handlePageModule(
    req1,
    "/_veryfront/pages/index.js",
    ctx,
    () => createBuilder(ctx),
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
    ctx,
    () => createBuilder(ctx),
    respond,
    getErrorMessage,
  )).response;
  if (!res2) throw new Error("Expected response for cached module request");
  assertEquals(res2.status, 304);
  await res2.body?.cancel();
});

denoTest("Module handler caches data endpoint responses", async (ctx) => {
  const { handleDataEndpoint } = await import(
    "../../../src/server/handlers/request/module/data-endpoint-handler.ts"
  );

  const req1 = new Request("http://localhost/_veryfront/data/index.json");
  const res1 = (await handleDataEndpoint(
    req1,
    "/_veryfront/data/index.json",
    ctx,
    () => createBuilder(ctx),
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
    ctx,
    () => createBuilder(ctx),
    respond,
    getErrorMessage,
  )).response;
  if (!res2) throw new Error("Expected cached data response");
  assertEquals(res2.status, 304);
  await res2.body?.cancel();
});

function denoTest(
  name: string,
  run: (ctx: HandlerContext) => Promise<void>,
) {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
  }, async () => {
    const projectDir = await setupProject();

    // Load config for the handler context
    const config = await getConfig(projectDir, denoAdapter);

    const handlerContext: HandlerContext = {
      projectDir,
      adapter: denoAdapter,
      mode: "development",
      moduleServerUrl: undefined,
      securityConfig: null,
      cspUserHeader: null,
      debug: false,
      config,
    };

    try {
      await run(handlerContext);
    } finally {
      await cleanupBundler();
      await denoAdapter.fs.remove(projectDir, { recursive: true });
    }
  });
}
