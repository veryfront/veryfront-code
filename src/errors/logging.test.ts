import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for structured error logging
 */

import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { logError, logErrorWithMessage } from "./logging.ts";
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "./error-registry.ts";

describe("logging", () => {
  let consoleErrorOutput: string[] = [];
  const originalConsoleError = console.error;
  const originalNodeEnv = Deno.env.get("NODE_ENV");

  function firstConsoleError(): string {
    const output = consoleErrorOutput[0];
    if (output === undefined) throw new Error("Expected console error output");
    return output;
  }

  beforeEach(() => {
    consoleErrorOutput = [];
    // Mock console.error to capture output
    console.error = (...args: unknown[]) => {
      consoleErrorOutput.push(args.map((arg) => String(arg)).join(" "));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    // Restore NODE_ENV
    if (originalNodeEnv) {
      Deno.env.set("NODE_ENV", originalNodeEnv);
    } else {
      Deno.env.delete("NODE_ENV");
    }
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
          "💡 Suggestion: Run 'veryfront init' to create a configuration file",
        );
        assertStringIncludes(output, "📚 Docs: https://veryfront.com/docs/errors/config-not-found");
      });

      it("should include context when provided", () => {
        const error = CONFIG_NOT_FOUND.create();

        logError(error, { projectPath: "/foo/bar" });

        const output = consoleErrorOutput.join("\n");
        assertStringIncludes(output, "Context:");
        assertStringIncludes(output, "projectPath");
        assertEquals(output.includes("/foo/bar"), false);
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

        assertEquals(consoleErrorOutput.length, 1);
        const parsed = JSON.parse(firstConsoleError());

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

        const parsed = JSON.parse(firstConsoleError());
        assertEquals(parsed.context.componentPath, "<LOCAL_PATH>");
      });

      it("redacts credential-like context keys in JSON output (#1989)", () => {
        const error = RENDER_ERROR.create();

        logError(error, { userId: "u-1", token: "sk-secret" });

        const parsed = JSON.parse(firstConsoleError());
        assertEquals(parsed.context.token, "[REDACTED]");
        assertEquals(parsed.context.userId, "u-1");
        assertEquals(firstConsoleError().includes("sk-secret"), false);
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

        const parsed = JSON.parse(firstConsoleError());
        assertEquals(parsed.context.source, "error");
        assertEquals(parsed.context.shared, "override");
        assertEquals(parsed.context.requestId, "req-123");
      });

      it("should use error.context in JSON when no context provided", () => {
        const error = CONFIG_NOT_FOUND.create({
          context: { path: "/config" },
        });

        logError(error);

        const parsed = JSON.parse(firstConsoleError());
        assertEquals(parsed.context.path, "<LOCAL_PATH>");
      });

      it("should handle errors without optional fields", () => {
        const error = RENDER_ERROR.create();

        logError(error);

        const parsed = JSON.parse(firstConsoleError());
        assertEquals(parsed.slug, "render-error");
        assertEquals(parsed.detail, undefined);
      });

      it("removes credentials and local paths from free-form detail", () => {
        const error = CONFIG_NOT_FOUND.create({
          detail: "password=<TOKEN> at /private/project/veryfront.config.ts",
        });

        logError(error);

        assertEquals(firstConsoleError().includes("<TOKEN>"), false);
        assertEquals(firstConsoleError().includes("/private/project"), false);
      });

      it("fails closed for hostile context properties", () => {
        const context = Object.defineProperty({}, "payload", {
          enumerable: true,
          get() {
            throw new Error("getter failed with <TOKEN>");
          },
        });

        logError(CONFIG_NOT_FOUND.create(), context);

        assertEquals(consoleErrorOutput.length, 1);
        assertEquals(firstConsoleError().includes("<TOKEN>"), false);
      });

      it("fails closed when extra context is hostile and error context exists", () => {
        const context = Object.defineProperty({}, "payload", {
          enumerable: true,
          get() {
            throw new Error("getter failed with password=<TOKEN>");
          },
        });
        const error = CONFIG_NOT_FOUND.create({ context: { source: "error" } });

        logError(error, context);

        assertEquals(consoleErrorOutput.length, 1);
        assertEquals(firstConsoleError().includes("<TOKEN>"), false);
      });

      it("fails closed for hostile mutable error properties", () => {
        const error = CONFIG_NOT_FOUND.create();
        Object.defineProperty(error, "title", {
          get() {
            throw new Error("getter leaked password=<TOKEN>");
          },
        });

        logError(error);

        const parsed = JSON.parse(firstConsoleError());
        assertEquals(parsed.slug, "unknown-error");
        assertEquals(parsed.title, "Unknown/unclassified error");
        assertEquals(firstConsoleError().includes("<TOKEN>"), false);
      });

      it("does not let a broken output sink replace the application flow", () => {
        console.error = () => {
          throw new Error("sink unavailable");
        };

        logError(CONFIG_NOT_FOUND.create());
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

      const parsed = JSON.parse(firstConsoleError());
      assertEquals(parsed.context.operation, "Failed to load project config");
      assertEquals(parsed.context.retry, 3);
    });

    it("should work without additional context", () => {
      const error = RENDER_ERROR.create();

      logErrorWithMessage("Component rendering failed", error);

      const parsed = JSON.parse(firstConsoleError());
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

      const parsed = JSON.parse(firstConsoleError());
      assertEquals(parsed.context.operation, "Failed to load config");
      assertEquals(parsed.context.source, "error");
      assertEquals(parsed.context.shared, "override");
      assertEquals(parsed.context.requestId, "req-456");
    });

    it("sanitizes hostile operation context before merging", () => {
      const context = Object.defineProperty({}, "payload", {
        enumerable: true,
        get() {
          throw new Error("getter failed with password=<TOKEN>");
        },
      });

      logErrorWithMessage("Failed at /private/project/file.ts", CONFIG_NOT_FOUND.create(), context);

      const parsed = JSON.parse(firstConsoleError());
      assertEquals(parsed.context.operation.includes("/private/project"), false);
      assertEquals(firstConsoleError().includes("<TOKEN>"), false);
    });
  });
});
