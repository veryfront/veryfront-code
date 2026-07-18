import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { ApiRouteMatcher } from "#veryfront/routing/api/api-route-matcher.ts";
import { RouteDiscovery } from "./route-discovery.ts";

describe("server/dev-server/route-discovery", () => {
  it("discovers routes from configured app and pages directories", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/src/app/page.tsx", "export default () => null;");
    adapter.fs.files.set("/project/src/pages/about.tsx", "export default () => null;");
    adapter.fs.files.set("/project/src/pages/guide.md", "# Guide");
    const router = new ApiRouteMatcher();
    const discovery = new RouteDiscovery("/project", adapter, router, {
      directories: { app: "src/app", pages: "src/pages" },
    });

    await discovery.discoverRoutes();

    assertEquals(router.match("/")?.route.page, "src/app/page.tsx");
    assertEquals(router.match("/about")?.route.page, "src/pages/about.tsx");
    assertEquals(router.match("/guide")?.route.page, "src/pages/guide.md");
  });

  it("uses configured relative directories with remote filesystem adapters", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("src/app/page.tsx", "export default () => null;");
    const router = new ApiRouteMatcher();
    const discovery = new RouteDiscovery("/project", adapter, router, {
      fs: { type: "github" },
      directories: { app: "src/app" },
      router: "app",
    });

    await discovery.discoverRoutes();

    assertEquals(router.match("/")?.route.page, "src/app/page.tsx");
  });
});
