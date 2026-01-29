/**
 * Flywheel Integration Test
 *
 * Tests the MCP feedback loop:
 * - vf_get_errors returns errors
 * - vf_get_logs returns request logs
 * - Errors clear when fixed
 */

import { assertEquals, assertExists } from "#std/assert.ts";
import { describe, it } from "#std/testing/bdd.ts";
import { getErrorCollector } from "./error-collector.ts";
import { getLogBuffer } from "./log-buffer.ts";

describe("Flywheel MCP", () => {
  describe("ErrorCollector", () => {
    it("captures runtime errors", () => {
      const collector = getErrorCollector();
      collector.clear();

      collector.addRuntimeError("Test error", "Error: Test\n  at test.ts:1", {
        source: "test",
      });

      const errors = collector.getAll();
      assertEquals(errors.length, 1);
      const first = errors[0];
      assertExists(first);
      assertEquals(first.message, "Test error");
      assertEquals(first.type, "runtime");
    });

    it("captures compile errors", () => {
      const collector = getErrorCollector();
      collector.clear();

      collector.addCompileError("Syntax error", "app/page.tsx", 10, 5);

      const errors = collector.getAll();
      assertEquals(errors.length, 1);
      const first = errors[0];
      assertExists(first);
      assertEquals(first.type, "compile");
      assertExists(first.file);
    });

    it("clears errors", () => {
      const collector = getErrorCollector();
      collector.addRuntimeError("Error 1", "stack");
      collector.clear();

      const errors = collector.getAll();
      assertEquals(errors.length, 0);
    });
  });

  describe("LogBuffer", () => {
    it("captures logs", () => {
      const buffer = getLogBuffer();
      buffer.clear();

      buffer.info("GET / → 200 (12ms)", "http", {
        method: "GET",
        path: "/",
        status: 200,
      });

      const logs = buffer.getAll();
      assertEquals(logs.length, 1);
      const first = logs[0];
      assertExists(first);
      assertEquals(first.message, "GET / → 200 (12ms)");
      assertEquals(first.source, "http");
    });

    it("clears logs", () => {
      const buffer = getLogBuffer();
      buffer.info("test", "test");
      buffer.clear();

      const logs = buffer.getAll();
      assertEquals(logs.length, 0);
    });
  });

  describe("Feedback Loop", () => {
    it("simulates write → observe → fix → verify cycle", () => {
      const errors = getErrorCollector();
      const logs = getLogBuffer();

      // Clear state
      errors.clear();
      logs.clear();

      // 1. WRITE: Simulate creating a page with error
      errors.addRuntimeError("useState is not defined", "at page.tsx:5");

      // 2. OBSERVE: Check errors
      let currentErrors = errors.getAll();
      assertEquals(currentErrors.length, 1);
      const firstError = currentErrors[0];
      assertExists(firstError);
      assertEquals(firstError.message, "useState is not defined");

      // 3. FIX: Clear the error (simulates fixing the code)
      errors.clear();

      // 4. OBSERVE: Simulate successful request
      logs.info("GET / → 200 (15ms)", "http", { status: 200 });

      // 5. VERIFY: No errors, successful response
      currentErrors = errors.getAll();
      const currentLogs = logs.getAll();

      assertEquals(currentErrors.length, 0);
      assertEquals(currentLogs.length, 1);
      const firstLog = currentLogs[0];
      assertExists(firstLog);
      assertEquals(firstLog.data?.status, 200);
    });
  });
});
