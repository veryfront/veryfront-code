import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for build error handler
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { setVerboseMode } from "#cli/utils";
import { handleBuildError } from "./error-handler.ts";

describe("build/error-handler", () => {
  describe("handleBuildError", () => {
    it("is a function", () => {
      assertEquals(typeof handleBuildError, "function");
    });

    it("throws Error objects back after logging", () => {
      const error = new Error("Test build error");

      assertThrows(
        () => handleBuildError(error),
        Error,
        "Test build error",
      );
    });

    it("throws non-Error values back after logging", () => {
      let threw = false;
      let thrownValue: unknown;

      try {
        handleBuildError("string error");
      } catch (e) {
        threw = true;
        thrownValue = e;
      }

      assertEquals(threw, true);
      assertEquals(thrownValue, "string error");
    });

    it("prints one actionable recovery hint", () => {
      const originalError = console.error;
      const output: string[] = [];

      try {
        console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));
        assertThrows(() => handleBuildError(new Error("Build failed")));
      } finally {
        console.error = originalError;
      }

      assertEquals(
        output.some((line) => line.includes("veryfront build --help")),
        true,
      );
    });

    it("prints the underlying cause stack in verbose mode", () => {
      const absoluteSourcePath = `${Deno.cwd()}/.cache/veryfront-http-bundle/http-deadbeef.mjs`;
      const cause = new ReferenceError("document is not defined");
      cause.stack = [
        "ReferenceError: document is not defined",
        `    at file://${absoluteSourcePath}:3:7`,
        "    at renderAppRouteToHTML (static-generation.ts:401:13)",
      ].join("\n");
      const error = new Error("Static site generation failed", { cause });
      const originalError = console.error;
      const output: string[] = [];

      setVerboseMode(true);
      try {
        console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));
        assertThrows(() => handleBuildError(error));
      } finally {
        console.error = originalError;
        setVerboseMode(false);
      }

      const rendered = output.join("\n");
      assertEquals(rendered.includes("Underlying stack trace:"), true);
      assertEquals(rendered.includes("ReferenceError: document is not defined"), true);
      assertEquals(rendered.includes("<REDACTED>/http-deadbeef.mjs:3:7"), true);
      assertEquals(rendered.includes(absoluteSourcePath), false);
    });

    it("points non-verbose failures with a cause to the diagnostic flag", () => {
      const originalError = console.error;
      const output: string[] = [];

      try {
        console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));
        assertThrows(() =>
          handleBuildError(
            new Error("Static site generation failed", {
              cause: new ReferenceError("document is not defined"),
            }),
          )
        );
      } finally {
        console.error = originalError;
      }

      assertEquals(
        output.some((line) => line.includes("veryfront build --verbose")),
        true,
      );
    });
  });
});
