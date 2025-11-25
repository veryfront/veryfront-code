/**
 * Workflow Types Tests
 */

import { assertEquals, assertThrows } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.220.0/testing/bdd.ts";
import { generateId, parseDuration } from "./types.ts";

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
    assertEquals(parseDuration(0), 0);
  });

  it("should throw on invalid format", () => {
    assertThrows(() => parseDuration("invalid"), Error, "Invalid duration format");
    assertThrows(() => parseDuration("10x"), Error, "Invalid duration format");
    assertThrows(() => parseDuration(""), Error, "Invalid duration format");
  });
});

describe("generateId", () => {
  it("should generate unique IDs", () => {
    const id1 = generateId();
    const id2 = generateId();
    const id3 = generateId();

    assertEquals(typeof id1, "string");
    assertEquals(id1.length > 0, true);

    // IDs should be unique
    assertEquals(id1 !== id2, true);
    assertEquals(id2 !== id3, true);
    assertEquals(id1 !== id3, true);
  });

  it("should use provided prefix", () => {
    const id = generateId("wf");
    assertEquals(id.startsWith("wf_"), true);

    const runId = generateId("run");
    assertEquals(runId.startsWith("run_"), true);
  });

  it("should use default 'wf' prefix when no prefix provided", () => {
    const id = generateId();
    assertEquals(id.startsWith("wf_"), true);
  });
});
