import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import type { HandlerContext } from "#veryfront/types";
import { StaticHandler } from "#veryfront/server/handlers/request/static.handler.ts";
import { SSRHandler } from "#veryfront/server/handlers/request/ssr/ssr.handler.ts";
import { createMockSSRService } from "#veryfront/server/handlers/request/ssr/ssr.handler.test-helpers.ts";

async function withProject(run: (context: HandlerContext) => Promise<void>): Promise<void> {
  await withTempDir(async (projectDir) => {
    await mkdir(`${projectDir}/app/items/[id]`, { recursive: true });
    await writeTextFile(
      `${projectDir}/app/items/[id]/page.tsx`,
      "export default function Page() { return <p>Item</p>; }",
    );
    await mkdir(`${projectDir}/public/items`, { recursive: true });
    await writeTextFile(`${projectDir}/public/items/logo.svg`, "<svg></svg>");
    await run({
      projectDir,
      adapter: await getAdapter(),
      securityConfig: null,
      config: { router: "app" },
      isLocalProject: true,
    });
  }, { prefix: "vf-dotted-page-" });
}

describe("dotted application routes", () => {
  it("renders declared dynamic page IDs with dots without URL-encoding them", async () => {
    await withProject(async (ctx) => {
      for (const pathname of ["/items/record.v2", "/items/photo.png", "/items/data.json"]) {
        const req = new Request(`http://localhost${pathname}`);
        const staticResult = await new StaticHandler().handle(req, ctx);
        assertEquals(staticResult.continue, true, `${pathname} must reach page routing`);
        let renderedSlug = "";
        const handler = new SSRHandler(createMockSSRService({
          renderPage: (_context, options) => {
            renderedSlug = options.slug;
            return Promise.resolve({
              status: 200,
              html: "<html>Item</html>",
              isStreaming: false,
              cacheStrategy: "no-cache",
              slug: options.slug,
            });
          },
        }));
        const result = await handler.handle(req, ctx);
        assertEquals(result.response?.status, 200, `${pathname} is a declared page`);
        assertEquals(renderedSlug, pathname.slice(1), "the route ID must retain its dots");
        await result.response?.text();
      }
    });
  });

  it("keeps existing static files ahead of matching pages even for HTML requests", async () => {
    await withProject(async (ctx) => {
      const result = await new StaticHandler().handle(
        new Request("http://localhost/items/logo.svg", { headers: { accept: "text/html" } }),
        ctx,
      );
      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(await result.response.text(), "<svg></svg>");
      assertEquals(result.response.headers.get("content-type")?.includes("image/svg+xml"), true);
    });
  });

  it("does not render missing assets without a declared page", async () => {
    await withProject(async (ctx) => {
      let rendered = false;
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () => {
          rendered = true;
          throw new Error("An undeclared asset must not enter the renderer");
        },
      }));
      for (const pathname of ["/missing.js", "/assets/missing.svg", "/notes.md"]) {
        const result = await handler.handle(new Request(`http://localhost${pathname}`), ctx);
        assertEquals(result.continue, true, `${pathname} belongs to another handler or the 404`);
      }
      assertEquals(rendered, false);
    });
  });

  it("lets API routes with dotted parameters reach API discovery", async () => {
    await withProject(async (ctx) => {
      const result = await new StaticHandler().handle(
        new Request("http://localhost/api/items/record.v2"),
        ctx,
      );
      assertEquals(result.continue, true, "a dot must not preempt API route discovery");
    });
  });
});
