/**
 * Workflow Types Tests
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateId, parseDuration, validateRetryConfig } from "./types.ts";

describe("parseDuration", () => {
  it("should parse seconds", () => {
    assertEquals(parseDuration("30s"), 30000);
    assertEquals(parseDuration("1s"), 1000);
    assertEquals(parseDuration("120s"), 120000);
  });

  it("should parse minutes", () => {
    assertEquals(parseDuration("1m"), 60000);
    assertEquals(parseDuration("5m"), 300000);
    assertEquals(parseDuration("30m"), 1800000);
  });

  it("should parse hours", () => {
    assertEquals(parseDuration("1h"), 3600000);
    assertEquals(parseDuration("24h"), 86400000);
    assertEquals(parseDuration("2h"), 7200000);
  });

  it("should parse days", () => {
    assertEquals(parseDuration("1d"), 86400000);
    assertEquals(parseDuration("7d"), 604800000);
  });

  it("should handle number input (passthrough)", () => {
    assertEquals(parseDuration(5000), 5000);
    assertEquals(parseDuration(100), 100);
  });

  it("should reject zero and negative durations", () => {
    assertThrows(() => parseDuration("0s"), Error, "Duration must be positive");
    assertThrows(() => parseDuration("0m"), Error, "Duration must be positive");
    assertThrows(() => parseDuration(-100), Error, "Duration cannot be negative");
  });

  it("should throw on invalid format", () => {
    assertThrows(() => parseDuration("invalid"), Error, "Invalid duration format");
    assertThrows(() => parseDuration("10x"), Error, "Invalid duration format");
    assertThrows(() => parseDuration(""), Error, "Invalid duration format");
  });
});

describe("generateId", () => {
  it("should generate unique IDs", () => {
    const ids = [generateId(), generateId(), generateId()];

    for (const id of ids) {
      assertEquals(typeof id, "string");
      assertEquals(id.length > 0, true);
    }

    assertEquals(new Set(ids).size, ids.length);
  });

  it("should use provided prefix", () => {
    assertEquals(generateId("wf").startsWith("wf_"), true);
    assertEquals(generateId("run").startsWith("run_"), true);
  });

  it("should use default 'wf' prefix when no prefix provided", () => {
    assertEquals(generateId().startsWith("wf_"), true);
  });
});

describe("validateRetryConfig", () => {
  it("should accept valid config", () => {
    validateRetryConfig({});
    validateRetryConfig({ maxAttempts: 3 });
    validateRetryConfig({ backoff: "exponential", initialDelay: 100, maxDelay: 5000 });
  });

  it("should reject invalid maxAttempts", () => {
    const message = "maxAttempts must be a positive integer";

    assertThrows(() => validateRetryConfig({ maxAttempts: 0 }), Error, message);
    assertThrows(() => validateRetryConfig({ maxAttempts: -1 }), Error, message);
    assertThrows(() => validateRetryConfig({ maxAttempts: 1.5 }), Error, message);
  });

  it("should reject negative delays", () => {
    assertThrows(
      () => validateRetryConfig({ initialDelay: -100 }),
      Error,
      "initialDelay cannot be negative",
    );
    assertThrows(
      () => validateRetryConfig({ maxDelay: -100 }),
      Error,
      "maxDelay cannot be negative",
    );
  });

  it("should reject initialDelay greater than maxDelay", () => {
    assertThrows(
      () => validateRetryConfig({ initialDelay: 5000, maxDelay: 1000 }),
      Error,
      "initialDelay (5000) cannot be greater than maxDelay (1000)",
    );
  });
});
