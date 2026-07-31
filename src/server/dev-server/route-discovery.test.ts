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

async function assertBudgetFailureKeepsPublishedRoutes(
  adapter: ReturnType<typeof createMockAdapter>,
  expectedMessage: string,
): Promise<void> {
  const router = new ApiRouteMatcher();
  router.addRoute("/stable", "pages/stable.tsx");
  const discovery = new RouteDiscovery("/project", adapter, router, {
    router: "pages",
  });

  await assertRejects(() => discovery.discoverRoutes(), RangeError, expectedMessage);

  assertEquals(router.listRoutes().length, 1);
  assertEquals(router.match("/stable")?.route.page, "pages/stable.tsx");
}

async function assertInvalidEntryCannotEscape(
  routerType: "app" | "pages",
  invalidName: string,
): Promise<void> {
  const adapter = createMockAdapter();
  const routeRoot = `/project/${routerType}`;
  adapter.fs.files.set(`${routeRoot}/seed.tsx`, "export default () => null;");
  const statPaths: string[] = [];
  const readPaths: string[] = [];
  const originalStat = adapter.fs.stat.bind(adapter.fs);
  adapter.fs.stat = (path: string) => {
    statPaths.push(path);
    return originalStat(path);
  };
  adapter.fs.readDir = async function* (path: string) {
    readPaths.push(path);
    if (path !== routeRoot) {
      throw new Error(`route discovery escaped to ${path}`);
    }
    yield {
      name: invalidName,
      isDirectory: true,
      isFile: false,
      isSymlink: false,
    };
  };
  const router = new ApiRouteMatcher();
  router.addRoute("/stable", "pages/stable.tsx");
  const discovery = new RouteDiscovery("/project", adapter, router, {
    router: routerType,
    directories: { [routerType]: routerType },
  });

  await assertRejects(
    () => discovery.discoverRoutes(),
    TypeError,
    "canonical basename",
  );

  assertEquals(readPaths, [routeRoot]);
  assertEquals(statPaths.some((path) => path.includes("outside")), false);
  assertEquals(router.listRoutes().length, 1);
  assertEquals(router.match("/stable")?.route.page, "pages/stable.tsx");
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

  it("does not let an older overlapping scan overwrite the latest route generation", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/seed.tsx", "export default () => null;");
    let pagesReads = 0;
    let releaseOlderScan!: () => void;
    const olderScanBlocked = new Promise<void>((resolve) => {
      releaseOlderScan = resolve;
    });
    let markOlderScanStarted!: () => void;
    const olderScanStarted = new Promise<void>((resolve) => {
      markOlderScanStarted = resolve;
    });
    adapter.fs.readDir = async function* (path: string) {
      if (path !== "/project/pages") return;
      pagesReads++;
      if (pagesReads === 1) {
        markOlderScanStarted();
        await olderScanBlocked;
        yield {
          name: "older.tsx",
          isDirectory: false,
          isFile: true,
          isSymlink: false,
        };
        return;
      }
      yield {
        name: "latest.tsx",
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      };
    };
    const router = new ApiRouteMatcher();
    const discovery = new RouteDiscovery("/project", adapter, router, {
      router: "pages",
    });

    const olderDiscovery = discovery.discoverRoutes();
    await olderScanStarted;
    await discovery.discoverRoutes();
    assertEquals(router.match("/latest")?.route.page, "pages/latest.tsx");

    releaseOlderScan();
    await olderDiscovery;
    assertEquals(router.match("/latest")?.route.page, "pages/latest.tsx");
    assertEquals(router.match("/older"), null);
  });

  it("treats .veryfront as an exact path segment when skipping tool directories", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      "/project/foo.veryfrontend/cache/index.tsx",
      "export default () => null;",
    );
    adapter.fs.files.set(
      "/project/foo.veryfrontend/tmp/report.tsx",
      "export default () => null;",
    );
    const router = new ApiRouteMatcher();
    const discovery = new RouteDiscovery("/project", adapter, router, {
      router: "pages",
      directories: { pages: "foo.veryfrontend" },
    });

    await discovery.discoverRoutes();

    assertEquals(
      router.match("/cache")?.route.page,
      "foo.veryfrontend/cache/index.tsx",
    );
    assertEquals(
      router.match("/tmp/report")?.route.page,
      "foo.veryfrontend/tmp/report.tsx",
    );
  });

  it("discovers cache and tmp route segments outside the tool-owned .veryfront tree", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/cache/index.tsx", "export default () => null;");
    adapter.fs.files.set("/project/pages/tmp/report.tsx", "export default () => null;");
    adapter.fs.files.set(
      "/project/.veryfront/cache/hidden.tsx",
      "export default () => null;",
    );
    const router = new ApiRouteMatcher();
    const discovery = new RouteDiscovery("/project", adapter, router, {
      router: "pages",
    });

    await discovery.discoverRoutes();

    assertEquals(router.match("/cache")?.route.page, "pages/cache/index.tsx");
    assertEquals(router.match("/tmp/report")?.route.page, "pages/tmp/report.tsx");
    assertEquals(router.match("/hidden"), null);
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

  it("rejects traversal-shaped pages entries before joining or recursing", async () => {
    await assertInvalidEntryCannotEscape("pages", "segment/../../outside");
  });

  it("rejects absolute-shaped app entries before joining or recursing", async () => {
    await assertInvalidEntryCannotEscape("app", String.raw`C:\outside`);
  });

  it("rejects non-canonical entry basenames atomically", async () => {
    for (
      const invalidName of [
        "",
        ".",
        "..",
        "nested/route",
        String.raw`nested\route`,
        "drive:route",
        "bad\u0000name",
        "e\u0301.tsx",
      ]
    ) {
      await assertInvalidEntryCannotEscape("pages", invalidName);
    }
  });

  it("rejects route trees deeper than 64 directories atomically", async () => {
    const adapter = createMockAdapter();
    const nestedPath = Array.from({ length: 65 }, () => "d").join("/");
    adapter.fs.files.set(
      `/project/pages/${nestedPath}/page.tsx`,
      "export default () => null;",
    );

    await assertBudgetFailureKeepsPublishedRoutes(
      adapter,
      "Route discovery directory depth limit of 64 was exceeded",
    );
  });

  it("rejects route trees containing more than 10,000 directories atomically", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/seed.tsx", "export default () => null;");
    adapter.fs.readDir = async function* (path: string) {
      if (path !== "/project/pages") return;
      for (let index = 0; index < 10_000; index++) {
        yield {
          name: `directory-${index}`,
          isDirectory: true,
          isFile: false,
          isSymlink: false,
        };
      }
    };

    await assertBudgetFailureKeepsPublishedRoutes(
      adapter,
      "Route discovery directory limit of 10000 was exceeded",
    );
  });

  it("rejects route scans containing more than 100,000 entries atomically", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/seed.tsx", "export default () => null;");
    adapter.fs.readDir = async function* (path: string) {
      if (path !== "/project/pages") return;
      for (let index = 0; index <= 100_000; index++) {
        yield {
          name: "ignored",
          isDirectory: false,
          isFile: false,
          isSymlink: false,
        };
      }
    };

    await assertBudgetFailureKeepsPublishedRoutes(
      adapter,
      "Route discovery entry limit of 100000 was exceeded",
    );
  });

  it("rejects route scans containing more than 10,000 routes atomically", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/seed.tsx", "export default () => null;");
    adapter.fs.readDir = async function* (path: string) {
      if (path !== "/project/pages") return;
      for (let index = 0; index <= 10_000; index++) {
        yield {
          name: `route-${index}.tsx`,
          isDirectory: false,
          isFile: true,
          isSymlink: false,
        };
      }
    };

    await assertBudgetFailureKeepsPublishedRoutes(
      adapter,
      "Route discovery route limit of 10000 was exceeded",
    );
  });

  it("rejects route scans exceeding 16 MiB of entry-name data atomically", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/seed.tsx", "export default () => null;");
    const name = "n".repeat(256);
    adapter.fs.readDir = async function* (path: string) {
      if (path !== "/project/pages") return;
      for (let index = 0; index <= 65_536; index++) {
        yield {
          name,
          isDirectory: false,
          isFile: false,
          isSymlink: false,
        };
      }
    };

    await assertBudgetFailureKeepsPublishedRoutes(
      adapter,
      "Route discovery entry-name byte budget of 16777216 was exceeded",
    );
  });
});
