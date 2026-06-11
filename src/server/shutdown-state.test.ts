import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetServerShuttingDownForTests,
  isServerShuttingDown,
  markServerShuttingDown,
} from "./shutdown-state.ts";

describe("server/shutdown-state", () => {
  afterEach(() => {
    __resetServerShuttingDownForTests();
  });

  it("defaults to not shutting down", () => {
    assertEquals(isServerShuttingDown(), false);
  });

  it("reports shutting down after markServerShuttingDown()", () => {
    markServerShuttingDown();
    assertEquals(isServerShuttingDown(), true);
  });

  it("resets between tests via the test-only helper", () => {
    assertEquals(isServerShuttingDown(), false);
  });
});
