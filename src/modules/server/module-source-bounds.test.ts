import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { MAX_SERVABLE_MODULE_SOURCE_BYTES } from "./module-limits.ts";

let projectDir = "";

async function serve(pathname: string): Promise<Response> {
  const { serveModule } = await import("./module-server.ts");
  return await serveModule(
    new Request(`http://localhost${pathname}`),
    // dev: the refusal case asserts the specific limit message, which the
    // production branch deliberately redacts.
    { projectId: "test", projectDir, adapter: denoAdapter, dev: true },
  );
}

describe("serveModule source size bounds", () => {
  beforeAll(async () => {
    projectDir = await Deno.makeTempDir({ prefix: "vf-source-bounds-" });
    await Deno.mkdir(`${projectDir}/components`, { recursive: true });
    await Deno.writeTextFile(
      `${projectDir}/components/Small.json`,
      JSON.stringify({ ok: true }),
    );
    // One byte past the admission boundary.
    await Deno.writeTextFile(
      `${projectDir}/components/Huge.json`,
      `{"pad":"${"a".repeat(MAX_SERVABLE_MODULE_SOURCE_BYTES)}"}`,
    );
  });

  afterAll(async () => {
    await Deno.remove(projectDir, { recursive: true });
  });

  it("serves a module within the size boundary", async () => {
    const response = await serve("/_vf_modules/components/Small.json");
    assertEquals(response.status, 200);
  });

  it("refuses a module source past the size boundary instead of buffering it", async () => {
    const response = await serve("/_vf_modules/components/Huge.json");
    const body = await response.text();

    assertEquals(response.status, 500);
    assertEquals(JSON.parse(body), { error: "Module source exceeds 5242880 bytes" });
  });
});
