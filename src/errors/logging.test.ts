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
          "💡 Suggestion: Run 'vf init' to create a configuration file",
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
        const parsed = JSON.parse(consoleErrorOutput[0]);

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

        const parsed = JSON.parse(consoleErrorOutput[0]);
        assertEquals(parsed.context.componentPath, "/app/page.tsx");
      });

      it("should use error.context in JSON when no context provided", () => {
        const error = CONFIG_NOT_FOUND.create({
          context: { path: "/config" },
        });

        logError(error);

        const parsed = JSON.parse(consoleErrorOutput[0]);
        assertEquals(parsed.context.path, "/config");
      });

      it("should handle errors without optional fields", () => {
        const error = RENDER_ERROR.create();

        logError(error);

        const parsed = JSON.parse(consoleErrorOutput[0]);
        assertEquals(parsed.slug, "render-error");
        assertEquals(parsed.detail, undefined);
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

      const parsed = JSON.parse(consoleErrorOutput[0]);
      assertEquals(parsed.context.operation, "Failed to load project config");
      assertEquals(parsed.context.retry, 3);
    });

    it("should work without additional context", () => {
      const error = RENDER_ERROR.create();

      logErrorWithMessage("Component rendering failed", error);

      const parsed = JSON.parse(consoleErrorOutput[0]);
      assertEquals(parsed.context.operation, "Component rendering failed");
    });
  });
});
