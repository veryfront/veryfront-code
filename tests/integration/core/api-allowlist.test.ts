import { assertEquals } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { mkdir, remove, writeTextFile } from "@veryfront/testing/deno-compat";
import { APIRouteHandler } from "@veryfront/routing/api/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("API Allow-list", () => {
  it("blocks disallowed remote import hosts", async () => {
    await withTestContext("api-allowlist-block", async (context) => {
      await remove(join(context.projectDir, "app"), { recursive: true });

      const apiDir = join(context.projectDir, "pages", "api");
      await mkdir(apiDir, { recursive: true });
      await writeTextFile(
        join(apiDir, "bad.ts"),
        `export async function GET() { await import('https://example.com/x.js'); return new Response('ok'); }`,
      );

      const handler = new APIRouteHandler(context.projectDir);
      await handler.initialize();

      const res = await handler.handle(new Request("http://local/api/bad"));
      const status = res?.status;

      assertEquals(
        status === 502 || status === 500 || res === null,
        true,
        `Expected 500, 502, or null but got status ${status}`,
      );
    });
  });
});
