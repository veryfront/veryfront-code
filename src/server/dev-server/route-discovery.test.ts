import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

  it("propagates adapter stat failures without consulting the host filesystem", async () => {
    const hostProjectDir = await Deno.makeTempDir({ prefix: "route-discovery-boundary-" });
    await Deno.mkdir(`${hostProjectDir}/.veryfront`);
    const adapter = createMockAdapter();
    const failure = new Error("injected adapter is unavailable");
    let statCalls = 0;
    let readDirCalls = 0;
    adapter.fs.stat = () => {
      statCalls++;
      return Promise.reject(failure);
    };
    const originalReadDir = adapter.fs.readDir;
    adapter.fs.readDir = (path) => {
      readDirCalls++;
      return originalReadDir(path);
    };
    const discovery = new RouteDiscovery(hostProjectDir, adapter, new ApiRouteMatcher());

    let caught: unknown;
    try {
      await discovery.discoverRoutes();
    } catch (error) {
      caught = error;
    } finally {
      await Deno.remove(hostProjectDir, { recursive: true });
    }

    assertEquals(caught === failure, true);
    assertEquals(statCalls, 1);
    assertEquals(readDirCalls, 0);
  });

  it("treats adapter not-found failures as missing directories", async () => {
    const adapter = createMockAdapter();
    adapter.fs.stat = () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
    const router = new ApiRouteMatcher();
    const discovery = new RouteDiscovery("/project", adapter, router);

    await discovery.discoverRoutes();

    assertEquals(router.listRoutes(), []);
  });

  it("propagates hostile operational failures without inspecting their messages", async () => {
    const adapter = createMockAdapter();
    const failure = new Proxy(Object.create(null) as object, {
      get() {
        throw new Error("must-not-be-read");
      },
      getPrototypeOf() {
        throw new Error("must-not-be-read");
      },
    });
    adapter.fs.stat = () => Promise.reject(failure);
    const discovery = new RouteDiscovery("/project", adapter, new ApiRouteMatcher());

    let caught: unknown;
    try {
      await discovery.discoverRoutes();
    } catch (error) {
      caught = error;
    }

    assertEquals(caught === failure, true);
  });

  it("propagates readDir failures instead of returning a partial route table", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", "export default () => null;");
    const failure = new Error("route directory cannot be read");
    adapter.fs.readDir = () => ({
      [Symbol.asyncIterator]() {
        return { next: () => Promise.reject(failure) };
      },
    });
    const discovery = new RouteDiscovery("/project", adapter, new ApiRouteMatcher(), {
      router: "app",
    });

    let caught: unknown;
    try {
      await discovery.discoverRoutes();
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, failure);
  });

  it("preserves the previous route generation when discovery fails", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", "export default () => null;");
    const router = new ApiRouteMatcher();
    router.addRoute("/stable", "pages/stable.tsx");
    const failure = new Error("route directory cannot be read");
    adapter.fs.readDir = () => ({
      [Symbol.asyncIterator]() {
        return { next: () => Promise.reject(failure) };
      },
    });

    const discovery = new RouteDiscovery("/project", adapter, router, { router: "app" });
    await assertRejects(() => discovery.discoverRoutes(), Error, failure.message);

    assertEquals(router.match("/stable")?.route.page, "pages/stable.tsx");
    assertEquals(router.match("/")?.route.page, undefined);
  });

  it("rejects configured route directories that escape the project root", async () => {
    const adapter = createMockAdapter();
    let statCalls = 0;
    adapter.fs.stat = (path) => {
      statCalls++;
      return Promise.reject(new Error(`unexpected stat: ${path}`));
    };
    const discovery = new RouteDiscovery("/project", adapter, new ApiRouteMatcher(), {
      router: "app",
      directories: { app: "../outside" },
    });

    await assertRejects(
      () => discovery.discoverRoutes(),
      TypeError,
      "project-relative path",
    );
    assertEquals(statCalls, 0);
  });

  it("rejects unsafe directory entries without changing the active routes", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", "export default () => null;");
    adapter.fs.readDir = () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          name: "../../outside.tsx",
          isDirectory: false,
          isFile: true,
          isSymlink: false,
        };
      },
    });
    const router = new ApiRouteMatcher();
    router.addRoute("/stable", "pages/stable.tsx");
    const discovery = new RouteDiscovery("/project", adapter, router, { router: "app" });

    await assertRejects(() => discovery.discoverRoutes(), TypeError, "directory entry");
    assertEquals(router.match("/stable")?.route.page, "pages/stable.tsx");
  });
});
