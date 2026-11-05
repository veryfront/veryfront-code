import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { serverLogger } from "#veryfront/utils";
import { REDACTED } from "#veryfront/utils/logger/redact.ts";
import { runWithRequestContext } from "#veryfront/utils/logger/request-context.ts";
import {
  __resetLoggerConfigForTests,
  __subscribeLogRecordEmitter,
  LogLevel,
  setLogLevel,
} from "#veryfront/utils/logger/logger.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  __isRouteConsoleCaptureWrapperForTests,
  __uninstallRouteConsoleCaptureForTests,
  formatRouteConsoleMessage,
  ROUTE_CONSOLE_MESSAGE_LIMIT,
  runWithRouteConsoleCapture,
} from "./route-console.ts";
import { executeAppRoute, executePagesRoute } from "./route-executor.ts";

// Read before any test replaces the console: importing the route executor
// must already have wrapped it, ahead of any route module.
const wrappedAtImport = __isRouteConsoleCaptureWrapperForTests(console.log);

interface Recorded {
  level: string;
  message: string;
  fields: Record<string, unknown>;
}

/** A request logger that records what route console capture writes to it. */
function recordingLogger(records: Recorded[], fields: Record<string, unknown> = {}): Logger {
  const write = (level: string) => (message: string) => {
    records.push({ level, message, fields });
  };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    time: (_label, fn) => fn(),
    child: (context) => recordingLogger(records, { ...fields, ...context }),
    component: () => recordingLogger(records, fields),
  };
}

function inRequest<T>(logger: Logger, fn: () => T): T {
  return runWithRequestContext({ logger, requestId: "req-1" }, fn);
}

describe("route console capture", () => {
  const originalLog = console.log;
  const originalError = console.error;
  let passedThrough: unknown[][];

  beforeEach(() => {
    passedThrough = [];
    // Installed before capture so capture wraps it as the original console.
    console.log = (...args: unknown[]) => {
      passedThrough.push(args);
    };
    console.error = (...args: unknown[]) => {
      passedThrough.push(args);
    };
  });

  afterEach(() => {
    __uninstallRouteConsoleCaptureForTests();
    console.log = originalLog;
    console.error = originalError;
  });

  it("writes route console calls to the request logger as route console output", () => {
    const records: Recorded[] = [];
    inRequest(
      recordingLogger(records, { project_id: "project-a" }),
      () =>
        runWithRouteConsoleCapture(() => {
          console.log("rows", 3);
          console.error(new TypeError("bad input"));
        }),
    );

    assertEquals(records, [
      {
        level: "info",
        message: "rows 3",
        fields: { project_id: "project-a", event_kind: "route_console", user_visible: "true" },
      },
      {
        level: "error",
        message: "TypeError: bad input",
        fields: { project_id: "project-a", event_kind: "route_console", user_visible: "true" },
      },
    ]);
    assertEquals(passedThrough, []);
  });

  it("leaves console output outside a route handler unchanged", () => {
    const records: Recorded[] = [];
    inRequest(recordingLogger(records), () => runWithRouteConsoleCapture(() => undefined));
    console.log("after the route");
    inRequest(recordingLogger(records), () => console.log("same request, not the route"));

    assertEquals(records, []);
    assertEquals(passedThrough, [["after the route"], ["same request, not the route"]]);
  });

  it("runs the handler unchanged without a request context", () => {
    const value = runWithRouteConsoleCapture(() => {
      console.log("no request");
      return 7;
    });

    assertEquals(value, 7);
    assertEquals(passedThrough, [["no request"]]);
  });

  it("writes through a real request logger without capturing its own console line", () => {
    // The request logger writes its formatted line through `console`. Without
    // the framework-write guard that line would be captured again, recursing.
    const requestLogger = serverLogger.child({ project_id: "project-a" });
    inRequest(requestLogger, () =>
      runWithRouteConsoleCapture(() => {
        console.error("user failure");
      }));

    assertEquals(passedThrough.length, 1);
    const line = String(passedThrough[0]?.[0]);
    assertEquals(line.includes("user failure"), true, line);
    assertEquals(line.includes("route_console"), true, line);
  });

  it("keeps concurrent requests on their own project logger", async () => {
    const recordsA: Recorded[] = [];
    const recordsB: Recorded[] = [];
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
    const route = (label: string) => async () => {
      console.log(`${label} start`);
      await tick();
      console.log(`${label} after timer`);
      await Promise.resolve();
      console.log(`${label} end`);
    };

    await Promise.all([
      inRequest(
        recordingLogger(recordsA, { project_id: "project-a" }),
        () => runWithRouteConsoleCapture(route("a")),
      ),
      inRequest(
        recordingLogger(recordsB, { project_id: "project-b" }),
        () => runWithRouteConsoleCapture(route("b")),
      ),
    ]);

    assertEquals(recordsA.map((record) => record.message), ["a start", "a after timer", "a end"]);
    assertEquals(recordsB.map((record) => record.message), ["b start", "b after timer", "b end"]);
    assertEquals(
      new Set(recordsA.map((record) => record.fields.project_id)),
      new Set(["project-a"]),
    );
    assertEquals(
      new Set(recordsB.map((record) => record.fields.project_id)),
      new Set(["project-b"]),
    );
  });

  it("formats objects as redacted JSON and caps long messages", () => {
    assertEquals(formatRouteConsoleMessage(["user", { id: 1 }]), 'user {"id":1}');
    const long = formatRouteConsoleMessage(["x".repeat(ROUTE_CONSOLE_MESSAGE_LIMIT + 10)]);
    assertEquals(long.length, ROUTE_CONSOLE_MESSAGE_LIMIT + "… [truncated]".length);
    assertEquals(long.endsWith("… [truncated]"), true);
  });

  it("leaves output the logger level would drop on the console", () => {
    const records: Recorded[] = [];
    setLogLevel(LogLevel.WARN);
    try {
      inRequest(recordingLogger(records), () =>
        runWithRouteConsoleCapture(() => {
          console.log("below the level");
          console.error("at the level");
        }));
    } finally {
      __resetLoggerConfigForTests();
    }

    assertEquals(records.map((record) => record.message), ["at the level"]);
    assertEquals(passedThrough, [["below the level"]]);
  });

  it("applies console format specifiers", () => {
    assertEquals(
      formatRouteConsoleMessage(["%s has %d rows (%i%%) %o", "t", 3, 4.7, { a: 1 }, "extra"]),
      't has 3 rows (4%) {"a":1} extra',
    );
    assertEquals(formatRouteConsoleMessage(["%d", { valueOf: () => 1 }]), "NaN");
    assertEquals(formatRouteConsoleMessage(["%s and %s", "one"]), "one and %s");
  });

  it("redacts paths in an error's name and message", () => {
    const error = new Error("failed at /srv/app/secret/handler.ts");
    error.name = "/srv/app/secret/BadError";
    assertEquals(formatRouteConsoleMessage([error]), "BadError: failed at handler.ts");
  });

  it("formats values without running their hooks", () => {
    let calls = 0;
    const value = {
      a: 1,
      toJSON() {
        calls++;
        return "json";
      },
      get g() {
        calls++;
        return "getter";
      },
      toString() {
        calls++;
        return "string";
      },
      password: "hunter2",
    };
    assertEquals(
      formatRouteConsoleMessage([value]),
      `{"a":1,"toJSON":[Function],"g":[Getter],"toString":[Function],"password":${REDACTED}}`,
    );
    assertEquals(calls, 0);
  });

  it("wraps the console when the route executor is imported", () => {
    assertEquals(wrappedAtImport, true);
  });

  it("redacts filesystem paths in strings and keys", () => {
    assertEquals(
      formatRouteConsoleMessage([
        "failed at /srv/project/private/route.ts",
        { path: "/srv/project/private/data.json", "/srv/project/private/rows": 1 },
      ]),
      'failed at route.ts {"path":"data.json","rows":1}',
    );
  });

  it("stops formatting at the message limit", () => {
    const message = formatRouteConsoleMessage([
      "x".repeat(ROUTE_CONSOLE_MESSAGE_LIMIT),
      "y".repeat(ROUTE_CONSOLE_MESSAGE_LIMIT),
    ]);
    assertEquals(message, "x".repeat(ROUTE_CONSOLE_MESSAGE_LIMIT) + "… [truncated]");
  });

  it("passes through console output from a log record subscriber", () => {
    let calls = 0;
    const unsubscribe = __subscribeLogRecordEmitter(() => {
      calls++;
      console.log("subscriber diagnostic");
    });
    try {
      inRequest(
        serverLogger.child({ project_id: "project-a" }),
        () =>
          runWithRouteConsoleCapture(() => {
            console.error("route failure");
          }),
      );
    } finally {
      unsubscribe();
    }

    assertEquals(calls, 1);
    assertEquals(passedThrough.some((args) => args[0] === "subscriber diagnostic"), true);
  });

  it("captures console output from a host-realm app route handler", async () => {
    const records: Recorded[] = [];
    const handler = {
      GET: () => {
        console.log("handled");
        return new Response("ok");
      },
    };

    const response = await inRequest(
      recordingLogger(records, { project_id: "project-a" }),
      () =>
        executeAppRoute(
          handler,
          new Request("http://localhost/api/test"),
          { route: { pattern: "/api/test", page: "/api/test.ts" }, params: {} },
          "/api/test",
          {} as RuntimeAdapter,
          { isLocalProject: true, allowHostProjectCodeExecution: true },
        ),
    );

    assertEquals(await response.text(), "ok");
    const routeConsole = records.filter((record) => record.fields.event_kind === "route_console");
    assertEquals(routeConsole.map((record) => [record.level, record.message]), [[
      "info",
      "handled",
    ]]);
  });

  it("captures console output from a host-realm pages route handler", async () => {
    const records: Recorded[] = [];
    const handler = {
      GET: () => {
        console.warn("pages handled");
        return new Response("ok");
      },
    };

    const response = await inRequest(
      recordingLogger(records, { project_id: "project-a" }),
      () =>
        executePagesRoute(
          handler,
          new Request("http://localhost/api/test"),
          { route: { pattern: "/api/test", page: "/api/test.ts" }, params: {} },
          "/api/test",
          { fs: {} } as RuntimeAdapter,
          undefined,
          { isLocalProject: true, allowHostProjectCodeExecution: true },
        ),
    );

    assertEquals(await response.text(), "ok");
    const routeConsole = records.filter((record) => record.fields.event_kind === "route_console");
    assertEquals(routeConsole.map((record) => [record.level, record.message]), [[
      "warn",
      "pages handled",
    ]]);
  });
});
