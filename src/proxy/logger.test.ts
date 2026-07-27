import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { refreshLoggerConfig } from "#veryfront/utils";
import {
  __registerProxyTraceContextGetter,
  proxyLogger,
  runWithProxyRequestContext,
} from "./logger.ts";

const LOGGER_ENV_KEYS = [
  "CI",
  "FORCE_COLOR",
  "LOG_COLOR",
  "LOG_FORMAT",
  "LOG_LEVEL",
  "NODE_ENV",
  "NO_COLOR",
] as const;

Deno.test("Proxy logger hardening", async (t) => {
  const previousEnv = new Map(
    LOGGER_ENV_KEYS.map((key) => [key, Deno.env.get(key)] as const),
  );
  const originalConsole = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  const output: string[] = [];
  const capture = (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  };

  console.debug = capture;
  console.error = capture;
  console.log = capture;
  console.warn = capture;
  Deno.env.set("LOG_LEVEL", "DEBUG");
  Deno.env.set("LOG_FORMAT", "json");
  Deno.env.set("NODE_ENV", "production");
  Deno.env.set("NO_COLOR", "1");
  Deno.env.delete("CI");
  Deno.env.delete("FORCE_COLOR");
  Deno.env.delete("LOG_COLOR");
  refreshLoggerConfig();

  const disposeTraceGetter = __registerProxyTraceContextGetter(() => ({
    traceId: "trace-1",
    spanId: "span-1",
  }));

  try {
    await t.step("snapshots child and request context into bounded redacted JSON", () => {
      const bound = {
        module: "routing",
        apiKey: "must-not-leak",
      };
      const child = proxyLogger.child(bound);
      bound.module = "mutated";

      const cyclic: Record<string, unknown> = { value: 1n };
      cyclic.self = cyclic;
      const requestContext = {
        requestId: "request-1",
        projectSlug: "demo-project",
        projectId: "project-1",
        releaseId: "release-1",
        branchId: "branch-1",
        branchName: "main",
        domain: "demo.test",
        environment: "production",
      };

      runWithProxyRequestContext(requestContext, () => {
        requestContext.requestId = "mutated";
        child.info("Routing ready", {
          cyclic,
          password: "must-not-leak",
        });
      });

      const line = output.pop() ?? "";
      const entry = JSON.parse(line) as Record<string, unknown>;
      const context = entry.context as Record<string, unknown>;
      assertEquals(entry.requestId, "request-1");
      assertEquals(entry.request_id, "request-1");
      assertEquals(entry.traceId, "trace-1");
      assertEquals(entry.trace_id, "trace-1");
      assertEquals(entry.projectId, "project-1");
      assertEquals(entry.project_id, "project-1");
      assertEquals(entry.releaseId, "release-1");
      assertEquals(entry.release_id, "release-1");
      assertEquals(entry.branchId, "branch-1");
      assertEquals(entry.branch_id, "branch-1");
      assertEquals(entry.branchName, "main");
      assertEquals(entry.branch_name, "main");
      assertEquals(entry.environment, "production");
      assertEquals(context.module, "routing");
      assertEquals(context.apiKey, "[REDACTED]");
      assertEquals(context.password, "[REDACTED]");
      assertEquals(
        (context.cyclic as Record<string, unknown>).self,
        "[REDACTED]",
      );
      assertEquals(line.includes("must-not-leak"), false);
      assertEquals(line.includes("mutated"), false);
    });

    await t.step("fails closed on hostile context and preserves non-Error failures", () => {
      proxyLogger.info("Hostile context", {
        get value() {
          throw new Error("getter must not escape");
        },
      });
      const hostileEntry = JSON.parse(output.pop() ?? "") as {
        context?: Record<string, unknown>;
      };
      assertEquals(
        hostileEntry.context?.unreadable_context,
        "[REDACTED]",
      );

      proxyLogger.error("String failure", "connection broke");
      const errorEntry = JSON.parse(output.pop() ?? "") as {
        error?: { name?: string; message?: string };
      };
      assertEquals(errorEntry.error?.name, "UnknownError");
      assertEquals(errorEntry.error?.message, "connection broke");
    });

    await t.step("includes ambient request and trace fields in text output", () => {
      Deno.env.set("LOG_FORMAT", "text");
      refreshLoggerConfig();

      runWithProxyRequestContext(
        { requestId: "request-text", projectSlug: "demo-project" },
        () => proxyLogger.info("Text context"),
      );

      const line = output.pop() ?? "";
      assertStringIncludes(line, "Text context");
      assertStringIncludes(line, "requestId=request-text");
      assertStringIncludes(line, "projectSlug=demo-project");
      assertStringIncludes(line, "traceId=trace-1");
      assertStringIncludes(line, "spanId=span-1");
    });

    await t.step("never invokes request-context accessors", () => {
      let getterReads = 0;
      const context = Object.defineProperty({}, "requestId", {
        enumerable: true,
        get() {
          getterReads++;
          return "request-accessor";
        },
      });

      assertThrows(
        () =>
          runWithProxyRequestContext(
            context as { requestId: string },
            () => undefined,
          ),
        TypeError,
        "data property",
      );
      assertEquals(getterReads, 0);
    });

    await t.step("isolates diagnostic sink failures", () => {
      console.error = () => {
        throw new Error("sink failed");
      };
      proxyLogger.error("Still isolated", new Error("operation failed"));
      console.error = capture;
    });
  } finally {
    disposeTraceGetter();
    console.debug = originalConsole.debug;
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    for (const [key, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    refreshLoggerConfig();
  }
});
