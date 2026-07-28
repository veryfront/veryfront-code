import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for structured error logging
 */

import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { logError, logErrorWithMessage } from "./logging.ts";
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "./error-registry.ts";
import { refreshLoggerConfig } from "#veryfront/utils/logger/logger.ts";

describe("logging", () => {
  // Separate capture arrays so we can distinguish error-level from debug-level output.
  let consoleErrorLines: string[] = [];
  let consoleDebugLines: string[] = [];

  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalConsoleDebug = console.debug;
  const originalNodeEnv = Deno.env.get("NODE_ENV");
  const originalLogFormat = Deno.env.get("LOG_FORMAT");
  const originalLogLevel = Deno.env.get("LOG_LEVEL");

  beforeEach(() => {
    consoleErrorLines = [];
    consoleDebugLines = [];
    // The canonical logger routes error → console.error, debug → console.debug.
    console.error = (...args: unknown[]) => {
      consoleErrorLines.push(args.map((arg) => String(arg)).join(" "));
    };
    // Capture console.log too — canonical logger uses it for non-error text output.
    console.log = (...args: unknown[]) => {
      consoleErrorLines.push(args.map((arg) => String(arg)).join(" "));
    };
    console.debug = (...args: unknown[]) => {
      consoleDebugLines.push(args.map((arg) => String(arg)).join(" "));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    console.debug = originalConsoleDebug;
    if (originalNodeEnv) Deno.env.set("NODE_ENV", originalNodeEnv);
    else Deno.env.delete("NODE_ENV");
    if (originalLogFormat) Deno.env.set("LOG_FORMAT", originalLogFormat);
    else Deno.env.delete("LOG_FORMAT");
    if (originalLogLevel) Deno.env.set("LOG_LEVEL", originalLogLevel);
    else Deno.env.delete("LOG_LEVEL");
    refreshLoggerConfig();
  });

  describe("logError", () => {
    describe("development mode", () => {
      beforeEach(() => {
        Deno.env.set("NODE_ENV", "development");
        Deno.env.delete("LOG_FORMAT");
        // Enable debug so we can assert that detailed info goes to debug level.
        Deno.env.set("LOG_LEVEL", "DEBUG");
        refreshLoggerConfig();
      });

      it("should log a single-line summary to error and full detail to debug", () => {
        const error = CONFIG_NOT_FOUND.create({
          detail: "Missing veryfront.config.ts",
        });

        logError(error);

        // Error level: one-line summary — title and suggestion only.
        const errorOutput = consoleErrorLines.join("\n");
        assertStringIncludes(errorOutput, "Configuration file not found");
        assertStringIncludes(errorOutput, "Run 'vf init' to create a configuration file");
        // Old multi-line fields are NOT in the error output.
        assertEquals(errorOutput.includes("Detail:"), false);
        assertEquals(errorOutput.includes("📚"), false);

        // Debug level: slug, detail, and docs URL.
        const debugOutput = consoleDebugLines.join("\n");
        assertStringIncludes(debugOutput, "config-not-found");
        assertStringIncludes(debugOutput, "Missing veryfront.config.ts");
        assertStringIncludes(debugOutput, "https://veryfront.com/docs/errors/config-not-found");
      });

      it("should include context at debug level when provided", () => {
        const error = CONFIG_NOT_FOUND.create();

        logError(error, { projectPath: "/foo/bar" });

        // Context is at debug level — not in the error summary.
        const errorOutput = consoleErrorLines.join("\n");
        assertEquals(errorOutput.includes("projectPath"), false);

        // But it does appear in the debug line.
        const debugOutput = consoleDebugLines.join("\n");
        assertStringIncludes(debugOutput, "projectPath");
      });

      it("should handle errors without detail or suggestion", () => {
        const error = RENDER_ERROR.create();

        logError(error);

        const errorOutput = consoleErrorLines.join("\n");
        assertStringIncludes(errorOutput, "Component render failed");
      });

      it("redacts credential-like context keys before debug emission (#1989)", () => {
        const error = RENDER_ERROR.create();

        logError(error, { userId: "u-1", apiKey: "sk-secret" });

        // Secret must not appear anywhere — error or debug.
        const allOutput = [...consoleErrorLines, ...consoleDebugLines].join("\n");
        assertEquals(allOutput.includes("sk-secret"), false);
        // Safe value and the redaction marker appear in debug output.
        assertStringIncludes(consoleDebugLines.join("\n"), "[REDACTED]");
        assertStringIncludes(consoleDebugLines.join("\n"), "u-1");
      });

      it("should use error.context when no context provided", () => {
        const error = CONFIG_NOT_FOUND.create({
          context: { originalContext: true },
        });

        logError(error);

        const debugOutput = consoleDebugLines.join("\n");
        assertStringIncludes(debugOutput, "originalContext");
      });
    });

    describe("production mode", () => {
      beforeEach(() => {
        Deno.env.set("NODE_ENV", "production");
        // Force JSON so JSON.parse works reliably regardless of prior logger state.
        Deno.env.set("LOG_FORMAT", "json");
        refreshLoggerConfig();
      });

      it("should log JSON format in production", () => {
        const error = CONFIG_NOT_FOUND.create({
          detail: "Missing config file",
        });

        logError(error);

        // Canonical logger writes one JSON line per serverLogger.error() call.
        assertEquals(consoleErrorLines.length, 1);
        const parsed = JSON.parse(consoleErrorLines[0]!);

        assertEquals(parsed.level, "error");
        // title becomes the top-level message field.
        assertEquals(parsed.message, "Configuration file not found");
        // error-specific fields travel in the context bag.
        assertEquals(parsed.context.slug, "config-not-found");
        assertEquals(parsed.context.category, "CONFIG");
        assertEquals(parsed.context.detail, "Missing config file");
        assertEquals(parsed.context.status, 404);
        assertStringIncludes(parsed.context.docs, "errors/config-not-found");
        assertEquals(typeof parsed.timestamp, "string");
      });

      it("should include context in JSON output", () => {
        const error = RENDER_ERROR.create();

        logError(error, { componentPath: "/app/page.tsx" });

        const parsed = JSON.parse(consoleErrorLines[0]!);
        assertEquals(parsed.context.componentPath, "/app/page.tsx");
      });

      it("redacts credential-like context keys in JSON output (#1989)", () => {
        const error = RENDER_ERROR.create();

        logError(error, { userId: "u-1", token: "sk-secret" });

        const parsed = JSON.parse(consoleErrorLines[0]!);
        // token stays in the context bag (not a well-known field) and is redacted.
        assertEquals(parsed.context.token, "[REDACTED]");
        // userId is a well-known field hoisted to the top level by the canonical logger.
        assertEquals(parsed.userId, "u-1");
        assertEquals(consoleErrorLines[0]!.includes("sk-secret"), false);
      });

      it("should merge error context with extra context and prefer extra values", () => {
        const error = CONFIG_NOT_FOUND.create({
          context: {
            source: "error",
            shared: "original",
          },
        });

        logError(error, {
          shared: "override",
          requestId: "req-123",
        });

        const parsed = JSON.parse(consoleErrorLines[0]!);
        assertEquals(parsed.context.source, "error");
        assertEquals(parsed.context.shared, "override");
        // requestId is a well-known field hoisted to the top level by the canonical logger.
        assertEquals(parsed.requestId, "req-123");
      });

      it("should use error.context in JSON when no context provided", () => {
        const error = CONFIG_NOT_FOUND.create({
          context: { path: "/config" },
        });

        logError(error);

        const parsed = JSON.parse(consoleErrorLines[0]!);
        assertEquals(parsed.context.path, "/config");
      });

      it("should handle errors without optional fields", () => {
        const error = RENDER_ERROR.create();

        logError(error);

        const parsed = JSON.parse(consoleErrorLines[0]!);
        assertEquals(parsed.context.slug, "render-error");
        assertEquals(parsed.context.detail, undefined);
      });
    });
  });

  describe("logErrorWithMessage", () => {
    beforeEach(() => {
      Deno.env.set("NODE_ENV", "production");
      Deno.env.set("LOG_FORMAT", "json");
      refreshLoggerConfig();
    });

    it("should add operation message to context", () => {
      const error = CONFIG_NOT_FOUND.create();

      logErrorWithMessage("Failed to load project config", error, { retry: 3 });

      const parsed = JSON.parse(consoleErrorLines[0]!);
      assertEquals(parsed.context.operation, "Failed to load project config");
      assertEquals(parsed.context.retry, 3);
    });

    it("should work without additional context", () => {
      const error = RENDER_ERROR.create();

      logErrorWithMessage("Component rendering failed", error);

      const parsed = JSON.parse(consoleErrorLines[0]!);
      assertEquals(parsed.context.operation, "Component rendering failed");
    });

    it("should preserve merged context when adding operation", () => {
      const error = CONFIG_NOT_FOUND.create({
        context: {
          source: "error",
          shared: "original",
        },
      });

      logErrorWithMessage("Failed to load config", error, {
        shared: "override",
        requestId: "req-456",
      });

      const parsed = JSON.parse(consoleErrorLines[0]!);
      assertEquals(parsed.context.operation, "Failed to load config");
      assertEquals(parsed.context.source, "error");
      assertEquals(parsed.context.shared, "override");
      // requestId is a well-known field hoisted to the top level by the canonical logger.
      assertEquals(parsed.requestId, "req-456");
    });
  });
});
