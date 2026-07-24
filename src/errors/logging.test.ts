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

describe("logging", () => {
  const environmentKeys = ["VERYFRONT_ENV", "NODE_ENV", "DENO_ENV"] as const;
  const originalEnvironment = new Map(
    environmentKeys.map((key) => [key, Deno.env.get(key)] as const),
  );
  let consoleErrorOutput: string[] = [];
  const originalConsoleError = console.error;

  function restoreEnvironment(): void {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }

  function getOnlyConsoleError(): string {
    assertEquals(consoleErrorOutput.length, 1);
    const output = consoleErrorOutput[0];
    if (output === undefined) throw new Error("Expected one captured console error");
    return output;
  }

  function parseOnlyConsoleError() {
    return JSON.parse(getOnlyConsoleError());
  }

  beforeEach(() => {
    consoleErrorOutput = [];
    for (const key of environmentKeys) Deno.env.delete(key);
    // Mock console.error to capture output
    console.error = (...args: unknown[]) => {
      consoleErrorOutput.push(args.map((arg) => String(arg)).join(" "));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    restoreEnvironment();
  });

  describe("logError", () => {
    describe("development mode", () => {
      beforeEach(() => {
        Deno.env.set("NODE_ENV", "development");
      });

      it("should log human-readable format in development", () => {
        const error = CONFIG_NOT_FOUND.create({
          detail: "Missing veryfront.config.ts",
        });

        logError(error);

        const output = consoleErrorOutput.join("\n");
        assertStringIncludes(output, "[ERROR] config-not-found (CONFIG)");
        assertStringIncludes(output, "Configuration file not found");
        assertStringIncludes(output, "Detail: Missing veryfront.config.ts");
        assertStringIncludes(
          output,
          "💡 Suggestion: Create veryfront.config.js, veryfront.config.ts, or veryfront.config.mjs in the project root",
        );
        assertStringIncludes(output, "📚 Docs: https://veryfront.com/docs/errors/config-not-found");
      });

      it("should include context when provided", () => {
        const error = CONFIG_NOT_FOUND.create();

        logError(error, { projectPath: "/foo/bar" });

        const output = consoleErrorOutput.join("\n");
        assertStringIncludes(output, "Context:");
        assertStringIncludes(output, "projectPath");
      });

      it("should handle errors without detail or suggestion", () => {
        const error = RENDER_ERROR.create();

        logError(error);

        const output = consoleErrorOutput.join("\n");
        assertStringIncludes(output, "[ERROR] render-error (RUNTIME)");
        assertStringIncludes(output, "Component render failed");
      });

      it("redacts credential-like context keys in the dev dump (#1989)", () => {
        const error = RENDER_ERROR.create();

        logError(error, { userId: "u-1", apiKey: "sk-secret" });

        const output = consoleErrorOutput.join("\n");
        assertStringIncludes(output, "[REDACTED]");
        assertStringIncludes(output, "u-1");
        assertEquals(output.includes("sk-secret"), false);
      });

      it("redacts URL credentials embedded in diagnostic details", () => {
        const error = RENDER_ERROR.create({
          detail: "Failed to connect to postgres://admin:super-secret@db.internal/app",
        });

        logError(error);

        const output = consoleErrorOutput.join("\n");
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

        const output = consoleErrorOutput.join("\n");
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

        const output = consoleErrorOutput.join("\n");
        assertStringIncludes(output, "Context:");
        assertStringIncludes(output, "originalContext");
      });
    });

    describe("production mode", () => {
      beforeEach(() => {
        Deno.env.set("NODE_ENV", "production");
      });

      it("should log JSON format in production", () => {
        const error = CONFIG_NOT_FOUND.create({
          detail: "Missing config file",
        });

        logError(error);

        const parsed = parseOnlyConsoleError();

        assertEquals(parsed.level, "error");
        assertEquals(parsed.slug, "config-not-found");
        assertEquals(parsed.category, "CONFIG");
        assertEquals(parsed.title, "Configuration file not found");
        assertEquals(parsed.detail, "Missing config file");
        assertEquals(parsed.status, 404);
        assertEquals(parsed.docs, "https://veryfront.com/docs/errors/config-not-found");
        assertEquals(typeof parsed.timestamp, "string");
      });

      it("should include context in JSON output", () => {
        const error = RENDER_ERROR.create();

        logError(error, { componentPath: "/app/page.tsx" });

        const parsed = parseOnlyConsoleError();
        assertEquals(parsed.context.componentPath, "/app/page.tsx");
      });

      it("redacts credential-like context keys in JSON output (#1989)", () => {
        const error = RENDER_ERROR.create();

        logError(error, { userId: "u-1", token: "sk-secret" });

        const output = getOnlyConsoleError();
        const parsed = JSON.parse(output);
        assertEquals(parsed.context.token, "[REDACTED]");
        assertEquals(parsed.context.userId, "u-1");
        assertEquals(output.includes("sk-secret"), false);
      });

      it("redacts URL credentials embedded in JSON diagnostic details", () => {
        const error = RENDER_ERROR.create({
          detail: "Failed to connect to postgres://admin:super-secret@db.internal/app",
        });

        logError(error);

        const output = getOnlyConsoleError();
        const parsed = JSON.parse(output);
        assertEquals(
          parsed.detail,
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
        assertEquals(parsed.context, { token: "[REDACTED]" });
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
        assertEquals(parsed.slug, "unknown-error");
        assertEquals(parsed.status, 500);
      });

      it("redacts free-form authorization, API-key, and cookie diagnostics", () => {
        const error = CONFIG_NOT_FOUND.create({
          detail: "Authorization: Bearer auth-secret, x-api-key=key-secret, cookie=session-secret",
        });

        logErrorWithMessage("operation token=operation-secret", error);

        const output = getOnlyConsoleError();
        const parsed = JSON.parse(output);
        assertStringIncludes(parsed.detail, "[REDACTED]");
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
        assertEquals(parsed.context.requestId, "req-123");
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
        assertEquals(parsed.slug, "render-error");
        assertEquals(parsed.detail, undefined);
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
        assert(parsed.title.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
        assert(parsed.detail.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
        assert(parsed.suggestion.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
        assertEquals(parsed.context, { context_truncated: true });
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
      assertEquals(parsed.context.requestId, "req-456");
    });
  });
});
