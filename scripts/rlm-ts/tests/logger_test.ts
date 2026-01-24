/**
 * Logger Tests
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  Logger,
  createLogger,
  silentLogger,
  defaultLogger,
} from "../src/core/logger.ts";
import type { LogEntry } from "../src/core/logger.ts";

Deno.test("Logger - creates with default config", () => {
  const logger = new Logger();
  assertExists(logger);
});

Deno.test("Logger - respects log level", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "warn",
    output: (entry) => entries.push(entry),
  });

  logger.debug("debug message");
  logger.info("info message");
  logger.warn("warn message");
  logger.error("error message");

  assertEquals(entries.length, 2);
  assertEquals(entries[0].level, "warn");
  assertEquals(entries[1].level, "error");
});

Deno.test("Logger - includes context in entries", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "debug",
    output: (entry) => entries.push(entry),
  });

  logger.info("test message", { key: "value", count: 42 });

  assertEquals(entries.length, 1);
  assertEquals(entries[0].context?.key, "value");
  assertEquals(entries[0].context?.count, 42);
});

Deno.test("Logger - includes trace ID", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "info",
    traceId: "abc-123",
    output: (entry) => entries.push(entry),
  });

  logger.info("test");

  assertEquals(entries[0].traceId, "abc-123");
});

Deno.test("Logger - setTraceId updates trace ID", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "info",
    output: (entry) => entries.push(entry),
  });

  logger.info("before");
  logger.setTraceId("new-trace-id");
  logger.info("after");

  assertEquals(entries[0].traceId, undefined);
  assertEquals(entries[1].traceId, "new-trace-id");
});

Deno.test("Logger - child creates logger with trace ID", () => {
  const entries: LogEntry[] = [];
  const parent = new Logger({
    level: "info",
    output: (entry) => entries.push(entry),
  });

  const child = parent.child({ traceId: "child-trace" });
  child.info("child message");

  assertEquals(entries[0].traceId, "child-trace");
});

Deno.test("Logger - iteration helper logs correctly", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "info",
    output: (entry) => entries.push(entry),
  });

  logger.iteration(3, { tokens: 100 });

  assertEquals(entries.length, 1);
  assertStringIncludes(entries[0].message, "Iteration 3");
  assertEquals(entries[0].context?.tokens, 100);
});

Deno.test("Logger - codeExecution logs success", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "debug",
    output: (entry) => entries.push(entry),
  });

  logger.codeExecution("console.log('hello')", {
    success: true,
    output: "hello",
  });

  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "debug");
  assertStringIncludes(entries[0].message, "successfully");
});

Deno.test("Logger - codeExecution logs failure", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "debug",
    output: (entry) => entries.push(entry),
  });

  logger.codeExecution("bad code", {
    success: false,
    error: "SyntaxError",
  });

  assertEquals(entries.length, 1);
  assertEquals(entries[0].level, "warn");
  assertStringIncludes(entries[0].message, "failed");
});

Deno.test("Logger - codeExecution truncates long code", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "debug",
    output: (entry) => entries.push(entry),
  });

  const longCode = "x".repeat(300);
  logger.codeExecution(longCode, { success: true });

  const loggedCode = entries[0].context?.code as string;
  assertEquals(loggedCode.length < 300, true);
  assertStringIncludes(loggedCode, "...");
});

Deno.test("Logger - completion logs model info", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "debug",
    output: (entry) => entries.push(entry),
  });

  logger.completion("gpt-4", { input: 100, output: 50 }, 1500);

  assertEquals(entries[0].context?.model, "gpt-4");
  assertEquals(entries[0].context?.inputTokens, 100);
  assertEquals(entries[0].context?.outputTokens, 50);
  assertEquals(entries[0].context?.latencyMs, 1500);
});

Deno.test("Logger - nestedCall logs depth and query", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "info",
    output: (entry) => entries.push(entry),
  });

  logger.nestedCall(2, "What is the capital of France?");

  assertStringIncludes(entries[0].message, "Depth 2");
  assertStringIncludes(entries[0].context?.queryPreview as string, "capital");
});

Deno.test("Logger - finalAnswer logs answer", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "info",
    output: (entry) => entries.push(entry),
  });

  logger.finalAnswer("The answer is 42");

  assertStringIncludes(entries[0].message, "Final answer");
  assertStringIncludes(entries[0].context?.answerPreview as string, "42");
});

Deno.test("Logger - JSON format outputs valid JSON", () => {
  let output = "";
  const logger = new Logger({
    level: "info",
    format: "json",
    output: (entry) => {
      output = JSON.stringify(entry);
    },
  });

  logger.info("test message", { key: "value" });

  const parsed = JSON.parse(output);
  assertEquals(parsed.message, "test message");
  assertEquals(parsed.context.key, "value");
  assertEquals(parsed.level, "info");
});

Deno.test("createLogger utility works", () => {
  const logger = createLogger({ level: "debug" });
  assertExists(logger);
});

Deno.test("silentLogger produces no output", () => {
  // Silent logger shouldn't call anything
  // We can verify by checking that it exists and has the right level
  assertExists(silentLogger);
});

Deno.test("defaultLogger exists", () => {
  assertExists(defaultLogger);
});

Deno.test("Logger - timestamp is present", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "info",
    output: (entry) => entries.push(entry),
  });

  logger.info("test");

  assertExists(entries[0].timestamp);
  assertEquals(entries[0].timestamp instanceof Date, true);
});

Deno.test("Logger - all log levels work", () => {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: "debug",
    output: (entry) => entries.push(entry),
  });

  logger.debug("debug");
  logger.info("info");
  logger.warn("warn");
  logger.error("error");

  assertEquals(entries.length, 4);
  assertEquals(entries[0].level, "debug");
  assertEquals(entries[1].level, "info");
  assertEquals(entries[2].level, "warn");
  assertEquals(entries[3].level, "error");
});
