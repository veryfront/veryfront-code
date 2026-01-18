import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd";
import { APIRouteHandler } from "@veryfront/routing/api/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "API Allow-list",
  () => {
    it("blocks disallowed remote import hosts", async () => {
      await withTestContext("api-allowlist-block", async (context) => {
        // Remove default app directory to use pages router
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        // Create pages/api/test.ts that imports a disallowed host
        const apiDir = join(context.projectDir, "pages", "api");
        await Deno.mkdir(apiDir, { recursive: true });
        await Deno.writeTextFile(
          join(apiDir, "bad.ts"),
          `export async function GET() { await import('https://example.com/x.js'); return new Response('ok'); }`,
        );

        const handler = new APIRouteHandler(context.projectDir);
        await handler.initialize();
        const res = await handler.handle(new Request("http://local/api/bad"));
        // Should fail with error status when remote import is blocked:
        // - 502 (Bad Gateway) when build fails
        // - 500 (Internal Server Error) when runtime import fails in Deno direct mode
        // - null when handler can't process the request
        const status = res?.status;
        assertEquals(
          status === 502 || status === 500 || res === null,
          true,
          `Expected 500, 502, or null but got status ${status}`,
        );
      });
    });
  },
);
