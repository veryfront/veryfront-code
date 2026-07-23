import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for CLI Error Boundary Middleware
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists, assertMatch, assertRejects } from "#veryfront/testing/assert";
import { cliErrorBoundary, formatCLIError } from "./cli-error-boundary.ts";
import { VeryfrontError } from "../types.ts";
import { CONFIG_NOT_FOUND, UNKNOWN_ERROR } from "../error-registry.ts";

describe("cli-error-boundary", () => {
  it("bounds oversized unknown failures before reporting and exiting", async () => {
    const originalDenoExit = Deno.exit;
    const originalConsoleError = console.error;
    const output: string[] = [];
    let exitCode: number | undefined;
    Deno.exit = ((code?: number): never => {
      exitCode = code;
      throw new Error("exit called");
    }) as typeof Deno.exit;
    console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));

    try {
      await assertRejects(
        () =>
          cliErrorBoundary(async () => {
            throw "x".repeat(100_000);
          }),
        Error,
        "exit called",
      );
      assertEquals(exitCode, 1);
      assertEquals(output.length, 1);
      assertEquals(output[0]?.length !== undefined && output[0].length < 20_000, true);
    } finally {
      Deno.exit = originalDenoExit;
      console.error = originalConsoleError;
    }
  });

  it("snapshots callbacks and rejects success exit codes", async () => {
    const originalExit = Deno.exit;
    const exitCodes: number[] = [];
    const callbacks: string[] = [];
    Object.defineProperty(Deno, "exit", {
      configurable: true,
      value: (code = 0): never => {
        exitCodes.push(code);
        throw new Error("exit intercepted");
      },
    });
    try {
      const options = {
        onError: () => {
          callbacks.push("original");
        },
        getExitCode: () => 7,
      };
      await assertRejects(
        () =>
          cliErrorBoundary(async () => {
            options.onError = () => callbacks.push("mutated");
            options.getExitCode = () => 0;
            throw new Error("failed");
          }, options),
        Error,
        "exit intercepted",
      );

      assertEquals(callbacks, ["original"]);
      assertEquals(exitCodes, [7]);

      await assertRejects(
        () =>
          cliErrorBoundary(
            async () => {
              throw new Error("failed");
            },
            { onError: () => {}, getExitCode: () => 0 },
          ),
        Error,
        "exit intercepted",
      );
      assertEquals(exitCodes, [7, 1]);

      const errorOutput: string[] = [];
      const standardOutput: string[] = [];
      const originalConsoleError = console.error;
      const originalConsoleLog = console.log;
      console.error = (...args: unknown[]) => errorOutput.push(args.map(String).join(" "));
      console.log = (...args: unknown[]) => standardOutput.push(args.map(String).join(" "));
      try {
        await assertRejects(
          () =>
            cliErrorBoundary(async () => {
              throw new Error("failed");
            }),
          Error,
          "exit intercepted",
        );
        assertEquals(errorOutput.length, 1);
        assertEquals(standardOutput, []);
      } finally {
        console.error = originalConsoleError;
        console.log = originalConsoleLog;
      }
    } finally {
      Object.defineProperty(Deno, "exit", {
        configurable: true,
        value: originalExit,
      });
    }
  });

  it("rejects malformed boundary inputs before treating them as command failures", async () => {
    await assertRejects(
      () => cliErrorBoundary(null as never),
      TypeError,
      "handler must be a function",
    );
    await assertRejects(
      () => cliErrorBoundary(async () => {}, { onError: 42 as never }),
      TypeError,
      "Invalid CLI error boundary options",
    );
  });

  describe("formatCLIError", () => {
    it("should format VeryfrontError with slug and title", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing veryfront.config.ts in project root",
      });

      const output = formatCLIError(error);

      // Should include slug in brackets
      assertMatch(output, /\[config-not-found\]/);
      // Should include title
      assertMatch(output, /Configuration file not found/);
    });

    it("should include detail when present", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing veryfront.config.ts in project root",
      });

      const output = formatCLIError(error);

      assertMatch(output, /Missing veryfront.config.ts/);
      assertMatch(output, /Detail:/);
    });

    it("should include suggestion when present", () => {
      const error = CONFIG_NOT_FOUND.create();

      const output = formatCLIError(error);

      // CONFIG_NOT_FOUND has a suggestion
      assertMatch(output, /Suggestion:/);
      assertMatch(output, /veryfront init/);
    });

    it("should include docs URL", () => {
      const error = CONFIG_NOT_FOUND.create();

      const output = formatCLIError(error);

      assertMatch(output, /Docs:/);
      assertMatch(output, /https:\/\/veryfront\.com\/docs\/errors\/config-not-found/);
    });

    it("should wrap plain Error as unknown-error", () => {
      const error = new Error("Something went wrong");

      const output = formatCLIError(error);

      assertMatch(output, /\[unknown-error\]/);
      assertMatch(output, /Something went wrong/);
    });

    it("should handle Error with no message", () => {
      const error = new Error();

      const output = formatCLIError(error);

      assertMatch(output, /\[unknown-error\]/);
    });

    it("should handle non-Error throws", () => {
      const output = formatCLIError("string error");

      assertMatch(output, /\[unknown-error\]/);
      assertMatch(output, /string error/);
    });

    it("should format output with proper structure", () => {
      const error = new VeryfrontError("Test error", {
        slug: "test-error",
        category: "GENERAL",
        status: 500,
        title: "Test Error Title",
        detail: "This is a detailed description",
        suggestion: "Try this fix",
      });

      const output = formatCLIError(error);

      const lines = output.split("\n");

      // Should start with empty line
      assertEquals(lines[0], "");

      // Should have slug and title on second line (with ANSI codes stripped for testing)
      const rawHeaderLine = lines[1];
      assertExists(rawHeaderLine);
      // deno-lint-ignore no-control-regex
      const headerLine = rawHeaderLine.replace(/\x1b\[\d+m/g, ""); // Strip ANSI codes
      assertMatch(headerLine, /\[test-error\]/);
      assertMatch(headerLine, /Test Error Title/);

      // Should have detail
      const detailLine = lines.find((line) => line.includes("Detail:"));
      assertEquals(detailLine !== undefined, true);

      // Should have suggestion
      const suggestionLine = lines.find((line) => line.includes("Suggestion:"));
      assertEquals(suggestionLine !== undefined, true);

      // Should have docs link
      const docsLine = lines.find((line) => line.includes("Docs:"));
      assertEquals(docsLine !== undefined, true);

      // Should end with empty line
      assertEquals(lines[lines.length - 1], "");
    });

    it("should not include detail if not provided", () => {
      const error = new VeryfrontError("Test", {
        slug: "test",
        category: "GENERAL",
        status: 500,
        title: "Test",
        // No detail provided
      });

      const output = formatCLIError(error);

      // Should not have "Detail:" line
      assertEquals(output.includes("Detail:"), false);
    });

    it("should not include suggestion if not provided", () => {
      const error = new VeryfrontError("Test", {
        slug: "test",
        category: "GENERAL",
        status: 500,
        title: "Test",
        // No suggestion provided
      });

      const output = formatCLIError(error);

      // Should not have "Suggestion:" line
      assertEquals(output.includes("Suggestion:"), false);
    });

    it("should handle errors with cause", () => {
      const originalError = new Error("Original cause");
      const error = UNKNOWN_ERROR.create({
        detail: "Wrapped error",
        cause: originalError,
      });

      const output = formatCLIError(error);

      assertMatch(output, /Wrapped error/);
      assertMatch(output, /\[unknown-error\]/);
    });

    it("should format multiple errors consistently", () => {
      const error1 = CONFIG_NOT_FOUND.create();
      const error2 = new Error("Test");

      const output1 = formatCLIError(error1);
      const output2 = formatCLIError(error2);

      // Both should start and end with empty lines
      assertEquals(output1.startsWith("\n"), true);
      assertEquals(output1.endsWith("\n"), true);
      assertEquals(output2.startsWith("\n"), true);
      assertEquals(output2.endsWith("\n"), true);
    });

    it("does not expose credentials or local paths", () => {
      const output = formatCLIError(
        new Error("password=<TOKEN> at /private/project/config.ts"),
      );

      assertEquals(output.includes("<TOKEN>"), false);
      assertEquals(output.includes("/private/project"), false);
    });

    it("fails closed for mutable hostile error properties", () => {
      const error = CONFIG_NOT_FOUND.create();
      Object.defineProperty(error, "title", {
        get() {
          throw new Error("getter leaked password=<TOKEN>");
        },
      });

      const output = formatCLIError(error);

      assertMatch(output, /\[unknown-error\]/);
      assertEquals(output.includes("<TOKEN>"), false);
    });
  });
});
