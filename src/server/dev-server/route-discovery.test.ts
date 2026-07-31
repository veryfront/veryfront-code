import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { ApiRouteMatcher } from "#veryfront/routing/api/api-route-matcher.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { RouteDiscovery } from "./route-discovery.ts";

function captureDebugLogs(): { entries: LogEntry[]; restore: () => void } {
  const originalLogLevel = Deno.env.get("LOG_LEVEL");
  const originalConsole = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  const entries: LogEntry[] = [];

  console.debug =
    console.error =
    console.log =
    console.warn =
      () => {};
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));

  return {
    entries,
    restore: () => {
      __resetLogRecordEmitterForTests();
      console.debug = originalConsole.debug;
      console.error = originalConsole.error;
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      if (originalLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", originalLogLevel);
      __resetLoggerConfigForTests();
    },
  };
}

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

  it("replaces the previous route generation only after discovery succeeds", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/current.tsx", "export default () => null;");
    const router = new ApiRouteMatcher();
    router.addRoute("/stale", "pages/stale.tsx");
    const discovery = new RouteDiscovery("/project", adapter, router, {
      router: "pages",
    });

    await discovery.discoverRoutes();

    assertEquals(router.match("/stale"), null);
    assertEquals(router.match("/current")?.route.page, "pages/current.tsx");
  });

  it("retains the previous route generation when a nested directory read fails", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/current.tsx", "export default () => null;");
    adapter.fs.files.set("/project/pages/private/page.tsx", "export default () => null;");
    const readDir = adapter.fs.readDir.bind(adapter.fs);
    adapter.fs.readDir = async function* (path: string) {
      if (path === "/project/pages/private") {
        throw new Error("permission denied");
      }
      yield* readDir(path);
    };
    const router = new ApiRouteMatcher();
    router.addRoute("/stable", "pages/stable.tsx");
    const discovery = new RouteDiscovery("/project", adapter, router, {
      router: "pages",
    });

    await assertRejects(() => discovery.discoverRoutes(), Error, "permission denied");

    assertEquals(router.match("/stable")?.route.page, "pages/stable.tsx");
    assertEquals(router.match("/current"), null);
  });

  it("propagates directory stat failures instead of treating them as missing", async () => {
    const adapter = createMockAdapter();
    const stat = adapter.fs.stat.bind(adapter.fs);
    adapter.fs.stat = (path: string) => {
      if (path === "/project/pages") return Promise.reject(new Error("adapter unavailable"));
      return stat(path);
    };
    const router = new ApiRouteMatcher();
    router.addRoute("/stable", "pages/stable.tsx");
    const discovery = new RouteDiscovery("/project", adapter, router, {
      router: "pages",
    });

    await assertRejects(() => discovery.discoverRoutes(), Error, "adapter unavailable");

    assertEquals(router.match("/stable")?.route.page, "pages/stable.tsx");
  });

  it("publishes an empty generation when every configured route directory is absent", async () => {
    const adapter = createMockAdapter();
    const router = new ApiRouteMatcher();
    router.addRoute("/stale", "pages/stale.tsx");
    const discovery = new RouteDiscovery("/project", adapter, router, {
      router: "pages",
    });

    await discovery.discoverRoutes();

    assertEquals(router.listRoutes(), []);
  });

  it("does not log expected missing route directories as failures", async () => {
    const adapter = createMockAdapter();
    const router = new ApiRouteMatcher();
    const discovery = new RouteDiscovery("/project", adapter, router);
    const logs = captureDebugLogs();

    try {
      await discovery.discoverRoutes();

      assertEquals(router.listRoutes(), []);
      assertEquals(
        logs.entries.some((entry) => entry.message === "Directory check failed"),
        false,
      );
    } finally {
      logs.restore();
    }
  });

  it("keeps unexpected route directory failures visible in debug logs", async () => {
    const adapter = createMockAdapter();
    adapter.fs.stat = () =>
      Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    const router = new ApiRouteMatcher();
    const discovery = new RouteDiscovery("/project", adapter, router, {
      fs: { type: "github" },
    });
    const logs = captureDebugLogs();

    try {
      await assertRejects(() => discovery.discoverRoutes(), Error, "permission denied");

      assertEquals(
        logs.entries.some((entry) => entry.message === "Directory check failed"),
        true,
      );
    } finally {
      logs.restore();
    }
  });
});
