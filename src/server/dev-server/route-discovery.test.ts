import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
import { logPath } from "#veryfront/modules/react-loader/ssr-module-loader/loader.ts";

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
  it("names every searched directory without leaking the project path", async () => {
    const captured = captureDebugLogs();
    try {
      const adapter = createMockAdapter();
      const discovery = new RouteDiscovery(
        "/Users/someone/private/path/my-project",
        adapter,
        new ApiRouteMatcher(),
        { router: "app" } as never,
      );
      await discovery.discoverRoutes();

      const warning = captured.entries.find((entry) =>
        entry.message.includes("No route directories found")
      );
      assertEquals(warning !== undefined, true, "the warning must be emitted");
      const message = warning!.message;

      // Discovery probes .veryfront and, when the configured router's directory
      // is missing, the other router's as a fallback. Reporting only the
      // preferred one would claim a directory went unsearched when it did not.
      assertEquals(message.includes(".veryfront/"), true);
      assertEquals(message.includes("app/"), true);
      assertEquals(message.includes("pages/"), true);

      // An absolute project root is machine-specific and does not belong in a
      // user-facing log line.
      assertEquals(message.includes("/Users/someone"), false);
      // AGENTS.md prohibits em and en dashes in public copy.
      assertEquals(/[\u2014\u2013]/.test(message), false);
    } finally {
      captured.restore();
    }
  });

  it("marks a truncated log path so it cannot read as a whole path", () => {
    const short = "app/page.tsx";
    assertEquals(logPath(short), short);

    const long = "/private/tmp/build/node_modules/veryfront/esm/src/react/context/index.js";
    const shortened = logPath(long);
    assertEquals(shortened.startsWith("…"), true);
    assertEquals(shortened.length, 41);
    assertEquals(long.endsWith(shortened.slice(1)), true);

    // The pair that made two distinct files read as one cache-key collision
    // stays distinguishable once both are marked as cut.
    const a = logPath("/a/very/long/prefix/veryfront/esm/src/react/context/index.js");
    const b = logPath("/b/other/long/prefix/veryfront/esm/src/react/router/index.js");
    assertEquals(a === b, false);
  });

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
      await discovery.discoverRoutes();

      assertEquals(
        logs.entries.some((entry) => entry.message === "Directory check failed"),
        true,
      );
    } finally {
      logs.restore();
    }
  });
});
