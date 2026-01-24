/**
 * Tests for stack trace parser
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { formatStackTrace, hasStackTrace, parseStackTrace } from "./stack-parser.ts";

describe("stack-parser", () => {
  describe("parseStackTrace", () => {
    it("should parse simple stack trace", () => {
      const stack =
        "Error: Something went wrong\n    at foo (file.ts:10:5)\n    at bar (file.ts:20:3)";
      const frames = parseStackTrace(stack);

      expect(frames).toHaveLength(3);
      expect(frames[0]?.raw).toBe("Error: Something went wrong");
      expect(frames[1]?.raw).toBe("at foo (file.ts:10:5)");
      expect(frames[2]?.raw).toBe("at bar (file.ts:20:3)");
    });

    it("should return empty array for empty stack", () => {
      expect(parseStackTrace("")).toEqual([]);
    });

    it("should skip empty lines", () => {
      const stack = "Error\n\n    at foo\n\n    at bar";
      const frames = parseStackTrace(stack);

      expect(frames).toHaveLength(3);
      expect(frames[0]?.raw).toBe("Error");
      expect(frames[1]?.raw).toBe("at foo");
      expect(frames[2]?.raw).toBe("at bar");
    });

    it("should trim whitespace from lines", () => {
      const stack = "  Error: Test  \n    at foo  \n    at bar  ";
      const frames = parseStackTrace(stack);

      expect(frames[0]?.raw).toBe("Error: Test");
      expect(frames[1]?.raw).toBe("at foo");
      expect(frames[2]?.raw).toBe("at bar");
    });

    it("should handle single line stack", () => {
      const frames = parseStackTrace("Error: Test");

      expect(frames).toHaveLength(1);
      expect(frames[0]?.raw).toBe("Error: Test");
    });

    it("should handle stack with only whitespace lines", () => {
      expect(parseStackTrace("   \n  \t  \n   ")).toEqual([]);
    });

    it("should parse real Deno stack trace", () => {
      const stack = `Error: Test error
    at testFunction (file:///path/to/file.ts:10:15)
    at async runTest (file:///path/to/test.ts:20:5)
    at async Object.action (file:///path/to/runner.ts:30:7)`;
      const frames = parseStackTrace(stack);

      expect(frames).toHaveLength(4);
      expect(frames[0]?.raw).toContain("Error: Test error");
      expect(frames[1]?.raw).toContain("testFunction");
      expect(frames[2]?.raw).toContain("async runTest");
      expect(frames[3]?.raw).toContain("async Object.action");
    });

    it("should parse Node.js style stack trace", () => {
      const stack = `Error: Test
    at Object.<anonymous> (/path/to/file.js:10:5)
    at Module._compile (internal/modules/cjs/loader.js:999:30)`;
      const frames = parseStackTrace(stack);

      expect(frames).toHaveLength(3);
      expect(frames[1]?.raw).toContain("Object.<anonymous>");
      expect(frames[2]?.raw).toContain("Module._compile");
    });

    it("should parse browser stack trace", () => {
      const stack = `Error: Test
    at testFunc (http://localhost:3000/app.js:10:20)
    at HTMLButtonElement.onclick (http://localhost:3000/app.js:50:10)`;
      const frames = parseStackTrace(stack);

      expect(frames).toHaveLength(3);
      expect(frames[1]?.raw).toContain("testFunc");
      expect(frames[2]?.raw).toContain("HTMLButtonElement");
    });

    it("should handle anonymous functions", () => {
      const stack = `Error: Test
    at <anonymous>:1:1
    at eval (eval at <anonymous>:1:1)`;
      const frames = parseStackTrace(stack);

      expect(frames).toHaveLength(3);
      expect(frames[1]?.raw).toContain("<anonymous>");
    });

    it("should preserve all frame information as raw", () => {
      const stack = "Error\n    at foo (file.ts:10:5)";
      const frames = parseStackTrace(stack);

      expect(frames[1]?.raw).toBe("at foo (file.ts:10:5)");
    });
  });

  describe("formatStackTrace", () => {
    it("should return stack as-is", () => {
      const stack = "Error: Test\n    at foo (file.ts:10:5)";
      expect(formatStackTrace(stack)).toBe(stack);
    });

    it("should return empty string for empty stack", () => {
      expect(formatStackTrace("")).toBe("");
    });

    it("should preserve multiline stack", () => {
      const stack = `Error: Test
    at foo (file.ts:10:5)
    at bar (file.ts:20:3)`;
      expect(formatStackTrace(stack)).toBe(stack);
    });

    it("should preserve whitespace", () => {
      const stack = "  Error  \n    at foo  ";
      expect(formatStackTrace(stack)).toBe(stack);
    });

    it("should handle long stack traces", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `    at func${i} (file.ts:${i}:1)`);
      const stack = `Error: Test\n${lines.join("\n")}`;
      const result = formatStackTrace(stack);

      expect(result).toBe(stack);
      expect(result.split("\n")).toHaveLength(101);
    });
  });

  describe("hasStackTrace", () => {
    it("should return true for error with stack", () => {
      expect(hasStackTrace(new Error("Test"))).toBe(true);
    });

    it("should return false for error without stack", () => {
      const error = new Error("Test");
      delete (error as { stack?: string }).stack;
      expect(hasStackTrace(error)).toBe(false);
    });

    it("should return false for error with empty stack", () => {
      const error = new Error("Test");
      (error as { stack?: string }).stack = "";
      expect(hasStackTrace(error)).toBe(false);
    });

    it("should return true for custom error with stack", () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }

      expect(hasStackTrace(new CustomError("Test"))).toBe(true);
    });

    it("should return false for manually set falsy stack", () => {
      const error = new Error("Test");
      (error as { stack?: string }).stack = undefined;
      expect(hasStackTrace(error)).toBe(false);
    });

    it("should handle TypeError with stack", () => {
      expect(hasStackTrace(new TypeError("Test"))).toBe(true);
    });

    it("should handle ReferenceError with stack", () => {
      expect(hasStackTrace(new ReferenceError("Test"))).toBe(true);
    });

    it("should handle SyntaxError with stack", () => {
      expect(hasStackTrace(new SyntaxError("Test"))).toBe(true);
    });
  });

  describe("integration", () => {
    it("should work end-to-end with real error", () => {
      const error = new Error("Test error");

      expect(hasStackTrace(error)).toBe(true);

      const stack = error.stack ?? "";
      const frames = parseStackTrace(stack);
      expect(frames.length).toBeGreaterThan(0);

      const formatted = formatStackTrace(stack);
      expect(formatted).toContain("Test error");
    });

    it("should handle error thrown from function", () => {
      function throwError(): never {
        throw new Error("Function error");
      }

      try {
        throwError();
      } catch (error) {
        if (!(error instanceof Error)) return;

        expect(hasStackTrace(error)).toBe(true);

        const frames = parseStackTrace(error.stack ?? "");
        expect(frames.length).toBeGreaterThan(0);
        expect(frames[0]?.raw).toContain("Function error");
      }
    });
  });
});
