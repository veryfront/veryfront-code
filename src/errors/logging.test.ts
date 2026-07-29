import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for structured error logging
 */

import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { logError, logErrorWithMessage } from "./logging.ts";
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "./error-registry.ts";
import {
  ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
} from "./safe-diagnostics.ts";
import { VeryfrontError } from "./types.ts";
import { refreshLoggerConfig } from "#veryfront/utils/logger/logger.ts";

describe("logging", () => {
  const environmentKeys = [
    "VERYFRONT_ENV",
    "NODE_ENV",
    "DENO_ENV",
    "LOG_FORMAT",
    "LOG_LEVEL",
  ] as const;
  const originalEnvironment = new Map(
    environmentKeys.map((key) => [key, Deno.env.get(key)] as const),
  );
  // Separate capture arrays so we can distinguish error-level from debug-level output.
  let consoleErrorLines: string[] = [];
  let consoleDebugLines: string[] = [];

  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalConsoleDebug = console.debug;

  function getOnlyConsoleError(): string {
    assertEquals(consoleErrorLines.length, 1);
    const output = consoleErrorLines[0];
    if (output === undefined) throw new Error("Expected one captured console error");
    return output;
  }

  function parseOnlyConsoleError(): Record<string, unknown> & {
    context: Record<string, unknown>;
  } {
    return JSON.parse(getOnlyConsoleError()) as Record<string, unknown> & {
      context: Record<string, unknown>;
    };
  }

  beforeEach(() => {
    consoleErrorLines = [];
    consoleDebugLines = [];
    for (const key of environmentKeys) Deno.env.delete(key);
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
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
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

        // Error level: one-line summary with title and suggestion only.
        const errorOutput = consoleErrorLines.join("\n");
        assertStringIncludes(errorOutput, "Configuration file not found");
        assertStringIncludes(
          errorOutput,
          "Create veryfront.config.js, veryfront.config.ts, or veryfront.config.mjs in the project root",
        );
        assertStringIncludes(errorOutput, " - ");
        assertEquals(errorOutput.includes("—"), false);
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

      it("redacts URL credentials embedded in diagnostic details", () => {
        const error = RENDER_ERROR.create({
          detail: "Failed to connect to postgres://admin:super-secret@db.internal/app",
        });

        logError(error);

        const output = [...consoleErrorLines, ...consoleDebugLines].join("\n");
        assertStringIncludes(output, "postgres://admin:[REDACTED]@db.internal/app");
        assertEquals(output.includes("super-secret"), false);
      });

      it("redacts free-form authorization, API-key, and cookie diagnostics", () => {
        const error = RENDER_ERROR.create({
          detail: "Authorization: Bearer auth-secret, apiKey=key-secret, cookie=session-secret",
        });

        logErrorWithMessage(
          "load Authorization=Bearer operation-secret",
          error,
        );

        const output = [...consoleErrorLines, ...consoleDebugLines].join("\n");
        assertStringIncludes(output, "[REDACTED]");
        for (const secret of ["auth-secret", "key-secret", "session-secret", "operation-secret"]) {
          assertEquals(output.includes(secret), false);
        }
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
        const parsed = parseOnlyConsoleError() as {
          level: string;
          message: string;
          timestamp: string;
          context: Record<string, unknown>;
        };

        assertEquals(parsed.level, "error");
        // title becomes the top-level message field.
        assertEquals(parsed.message, "Configuration file not found");
        // error-specific fields travel in the context bag.
        assertEquals(parsed.context.slug, "config-not-found");
        assertEquals(parsed.context.category, "CONFIG");
        assertEquals(parsed.context.detail, "Missing config file");
        assertEquals(parsed.context.status, 404);
        assertStringIncludes(parsed.context.docs as string, "errors/config-not-found");
        assertEquals(typeof parsed.timestamp, "string");
      });

      it("should include context in JSON output", () => {
        const error = RENDER_ERROR.create();

        logError(error, { componentPath: "/app/page.tsx" });

        const parsed = parseOnlyConsoleError() as {
          context: Record<string, unknown>;
        };
        assertEquals(parsed.context.componentPath, "/app/page.tsx");
      });

      it("redacts credential-like context keys in JSON output (#1989)", () => {
        const error = RENDER_ERROR.create();

        logError(error, { userId: "u-1", token: "sk-secret" });

        const output = getOnlyConsoleError();
        const parsed = JSON.parse(output);
        assertEquals(parsed.context.token, "[REDACTED]");
        // userId is a well-known field hoisted by the canonical logger.
        assertEquals(parsed.userId, "u-1");
        assertEquals(output.includes("sk-secret"), false);
      });

      it("detaches and redacts error context serializers before JSON emission", () => {
        let toJSONCalls = 0;
        const error = RENDER_ERROR.create({
          context: {
            toJSON() {
              toJSONCalls++;
              return {
                source: "runtime",
                token: "raw-serializer-token",
              };
            },
          },
        });

        logError(error);

        const output = getOnlyConsoleError();
        const parsed = JSON.parse(output);
        assertEquals(toJSONCalls, 1);
        assertEquals(parsed.context.source, "runtime");
        assertEquals(parsed.context.token, "[REDACTED]");
        assertEquals(output.includes("raw-serializer-token"), false);
      });

      it("redacts URL credentials embedded in JSON diagnostic details", () => {
        const error = RENDER_ERROR.create({
          detail: "Failed to connect to postgres://admin:super-secret@db.internal/app",
        });

        logError(error);

        const output = getOnlyConsoleError();
        const parsed = JSON.parse(output);
        assertEquals(
          parsed.context.detail,
          "Failed to connect to postgres://admin:[REDACTED]@db.internal/app",
        );
        assertEquals(output.includes("super-secret"), false);
      });

      it("fails closed for unreadable error context", () => {
        const context = Object.defineProperty({}, "token", {
          enumerable: true,
          get(): never {
            throw new Error("unreadable");
          },
        });
        const error = RENDER_ERROR.create({ context });

        logError(error);

        const parsed = parseOnlyConsoleError();
        assertEquals((parsed.context as Record<string, unknown>).token, "[REDACTED]");
      });

      it("falls back safely for a proxy around a real VeryfrontError", () => {
        const hostile = new Proxy(CONFIG_NOT_FOUND.create(), {
          get(target, property, receiver) {
            if (property === "title") throw new Error("blocked");
            return Reflect.get(target, property, receiver);
          },
        });

        logError(hostile);

        const parsed = parseOnlyConsoleError();
        const context = parsed.context as Record<string, unknown>;
        assertEquals(context.slug, "unknown-error");
        assertEquals(context.status, 500);
      });

      it("redacts free-form authorization, API-key, and cookie diagnostics", () => {
        const error = CONFIG_NOT_FOUND.create({
          detail: "Authorization: Bearer auth-secret, x-api-key=key-secret, cookie=session-secret",
        });

        logErrorWithMessage("operation token=operation-secret", error);

        const output = getOnlyConsoleError();
        const parsed = JSON.parse(output);
        assertStringIncludes(parsed.context.detail, "[REDACTED]");
        assertStringIncludes(parsed.context.operation, "[REDACTED]");
        for (const secret of ["auth-secret", "key-secret", "session-secret", "operation-secret"]) {
          assertEquals(output.includes(secret), false);
        }
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

        const parsed = parseOnlyConsoleError();
        assertEquals(parsed.context.source, "error");
        assertEquals(parsed.context.shared, "override");
        // requestId is a well-known field hoisted to the top level by the canonical logger.
        assertEquals(parsed.requestId, "req-123");
      });

      it("should not let context override canonical error fields", () => {
        const error = CONFIG_NOT_FOUND.create({
          context: {
            slug: "spoofed-slug",
            category: "SPOOFED",
            status: 200,
            docs: "https://example.com/spoofed",
          },
        });

        logError(error);

        const parsed = JSON.parse(consoleErrorLines[0]!);
        assertEquals(parsed.context.slug, "config-not-found");
        assertEquals(parsed.context.category, "CONFIG");
        assertEquals(parsed.context.status, 404);
        assertStringIncludes(parsed.context.docs, "errors/config-not-found");
      });

      it("should use error.context in JSON when no context provided", () => {
        const error = CONFIG_NOT_FOUND.create({
          context: { path: "/config" },
        });

        logError(error);

        const parsed = parseOnlyConsoleError();
        assertEquals(parsed.context.path, "/config");
      });

      it("should handle errors without optional fields", () => {
        const error = RENDER_ERROR.create();

        logError(error);

        const parsed = parseOnlyConsoleError();
        assertEquals(parsed.context.slug, "render-error");
        assertEquals(parsed.context.detail, undefined);
      });

      it("should emit bounded valid JSON for oversized diagnostics and context", () => {
        const error = new VeryfrontError("Vendor error", {
          slug: "vendor/path?token=slug-secret#fragment",
          category: "GENERAL",
          status: 599,
          title: "t".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
          detail: `${
            "d".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS)
          } Authorization: Bearer detail-secret`,
          suggestion: "s".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
          context: {
            token: "context-secret",
            payload: "x".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
          },
        });

        logError(error, {
          apiKey: "extra-secret",
          extraPayload: "y".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
        });

        const output = getOnlyConsoleError();
        const parsed = JSON.parse(output);

        assert(output.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS);
        assert((parsed.message as string).length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
        assert(
          (parsed.context.detail as string).length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
        );
        assert(
          (parsed.context.suggestion as string).length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
        );
        assertEquals(parsed.context.context_truncated, true);
        for (
          const secret of [
            "slug-secret",
            "detail-secret",
            "context-secret",
            "extra-secret",
          ]
        ) {
          assertEquals(output.includes(secret), false);
        }
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

      const parsed = parseOnlyConsoleError();
      assertEquals(parsed.context.operation, "Failed to load project config");
      assertEquals(parsed.context.retry, 3);
    });

    it("should work without additional context", () => {
      const error = RENDER_ERROR.create();

      logErrorWithMessage("Component rendering failed", error);

      const parsed = parseOnlyConsoleError();
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

      const parsed = parseOnlyConsoleError();
      assertEquals(parsed.context.operation, "Failed to load config");
      assertEquals(parsed.context.source, "error");
      assertEquals(parsed.context.shared, "override");
      // requestId is a well-known field hoisted to the top level by the canonical logger.
      assertEquals(parsed.requestId, "req-456");
    });
  });
});
