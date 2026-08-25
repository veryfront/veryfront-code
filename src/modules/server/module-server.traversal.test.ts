import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";

const SECRET = "TOP_SECRET_MODULE_SERVER_TRAVERSAL_CANARY";

let root = "";
let projectDir = "";

async function serve(pathname: string): Promise<Response> {
  const { serveModule } = await import("./module-server.ts");
  return await serveModule(
    new Request(`http://localhost${pathname}`),
    { projectId: "test", projectDir, adapter: denoAdapter },
  );
}

describe("serveModule path traversal", () => {
  beforeAll(async () => {
    root = await Deno.makeTempDir({ prefix: "vf-traversal-" });
    projectDir = `${root}/project`;
    await Deno.mkdir(`${projectDir}/components`, { recursive: true });
    await Deno.writeTextFile(
      `${projectDir}/components/data.json`,
      JSON.stringify({ ok: true }),
    );
    // Sits beside the project root, reachable only by escaping it.
    await Deno.writeTextFile(`${root}/secret.tsx`, `export const secret = "${SECRET}";\n`);
  });

  afterAll(async () => {
    await Deno.remove(root, { recursive: true });
  });

  const attacks = [
    ["literal dot-dot", "/_vf_modules/../secret.js"],
    ["single-encoded dot-dot", "/_vf_modules/%2e%2e%2fsecret.js"],
    ["double-encoded dot-dot", "/_vf_modules/%252e%252e%252fsecret.js"],
    ["encoded slash only", "/_vf_modules/..%2fsecret.js"],
    ["encoded backslash", "/_vf_modules/..%5csecret.js"],
    ["absolute-ish path", "/_vf_modules//etc/passwd.js"],
  ] as const;

  for (const [label, pathname] of attacks) {
    it(`does not serve a file outside the project root via ${label}`, async () => {
      const response = await serve(pathname);
      const body = await response.text();

      assertEquals(
        body.includes(SECRET),
        false,
        `${label} leaked the out-of-root file (status ${response.status})`,
      );
      assertEquals(
        response.status === 200 && body.includes(SECRET),
        false,
        `${label} must never serve the out-of-root file`,
      );
      assertEquals(
        [403, 404].includes(response.status),
        true,
        `${label} must be rejected, got status ${response.status}`,
      );
    });
  }

  it("still serves a legitimate in-project module", async () => {
    const response = await serve("/_vf_modules/components/data.json");
    assertEquals(response.status, 200);
  });
});
