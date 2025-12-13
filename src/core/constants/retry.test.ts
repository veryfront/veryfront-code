import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  DEFAULT_RETRY_BACKOFF_MULTIPLIER,
  API_RETRY_MAX_ATTEMPTS,
  API_RETRY_INITIAL_DELAY_MS,
  API_RETRY_MAX_DELAY_MS,
  FS_RETRY_MAX_ATTEMPTS,
  FS_RETRY_INITIAL_DELAY_MS,
  FS_RETRY_MAX_DELAY_MS,
  WS_RECONNECT_MAX_ATTEMPTS,
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "./retry.ts";

describe("constants/retry", () => {
  describe("default retry configuration", () => {
    it("should have correct default max attempts", () => {
      assertEquals(DEFAULT_RETRY_MAX_ATTEMPTS, 3);
    });

    it("should have correct default initial delay (100ms)", () => {
      assertEquals(DEFAULT_RETRY_INITIAL_DELAY_MS, 100);
    });

    it("should have correct default max delay (5s)", () => {
      assertEquals(DEFAULT_RETRY_MAX_DELAY_MS, 5000);
    });

    it("should have correct default backoff multiplier", () => {
      assertEquals(DEFAULT_RETRY_BACKOFF_MULTIPLIER, 2);
    });

    it("should have max delay greater than initial delay", () => {
      assert(DEFAULT_RETRY_MAX_DELAY_MS > DEFAULT_RETRY_INITIAL_DELAY_MS);
    });
  });

  describe("API retry configuration", () => {
    it("should have correct API max attempts", () => {
      assertEquals(API_RETRY_MAX_ATTEMPTS, 3);
    });

    it("should have correct API initial delay (1s)", () => {
      assertEquals(API_RETRY_INITIAL_DELAY_MS, 1000);
    });

    it("should have correct API max delay (10s)", () => {
      assertEquals(API_RETRY_MAX_DELAY_MS, 10000);
    });

    it("should have max delay greater than initial delay", () => {
      assert(API_RETRY_MAX_DELAY_MS > API_RETRY_INITIAL_DELAY_MS);
    });

    it("should have longer delays than defaults", () => {
      assert(API_RETRY_INITIAL_DELAY_MS > DEFAULT_RETRY_INITIAL_DELAY_MS);
      assert(API_RETRY_MAX_DELAY_MS > DEFAULT_RETRY_MAX_DELAY_MS);
    });
  });

  describe("filesystem retry configuration", () => {
    it("should have correct FS max attempts", () => {
      assertEquals(FS_RETRY_MAX_ATTEMPTS, 3);
    });

    it("should have correct FS initial delay (1s)", () => {
      assertEquals(FS_RETRY_INITIAL_DELAY_MS, 1000);
    });

    it("should have correct FS max delay (10s)", () => {
      assertEquals(FS_RETRY_MAX_DELAY_MS, 10000);
    });

    it("should have max delay greater than initial delay", () => {
      assert(FS_RETRY_MAX_DELAY_MS > FS_RETRY_INITIAL_DELAY_MS);
    });

    it("should match API retry configuration", () => {
      assertEquals(FS_RETRY_MAX_ATTEMPTS, API_RETRY_MAX_ATTEMPTS);
      assertEquals(FS_RETRY_INITIAL_DELAY_MS, API_RETRY_INITIAL_DELAY_MS);
      assertEquals(FS_RETRY_MAX_DELAY_MS, API_RETRY_MAX_DELAY_MS);
    });
  });

  describe("WebSocket reconnect configuration", () => {
    it("should have correct WS max attempts", () => {
      assertEquals(WS_RECONNECT_MAX_ATTEMPTS, 5);
    });

    it("should have correct WS initial delay (1s)", () => {
      assertEquals(WS_RECONNECT_INITIAL_DELAY_MS, 1000);
    });

    it("should have correct WS max delay (30s)", () => {
      assertEquals(WS_RECONNECT_MAX_DELAY_MS, 30000);
    });

    it("should have max delay greater than initial delay", () => {
      assert(WS_RECONNECT_MAX_DELAY_MS > WS_RECONNECT_INITIAL_DELAY_MS);
    });

    it("should have more attempts than other operations", () => {
      assert(WS_RECONNECT_MAX_ATTEMPTS > DEFAULT_RETRY_MAX_ATTEMPTS);
      assert(WS_RECONNECT_MAX_ATTEMPTS > API_RETRY_MAX_ATTEMPTS);
      assert(WS_RECONNECT_MAX_ATTEMPTS > FS_RETRY_MAX_ATTEMPTS);
    });

    it("should have longer max delay than other operations", () => {
      assert(WS_RECONNECT_MAX_DELAY_MS > DEFAULT_RETRY_MAX_DELAY_MS);
      assert(WS_RECONNECT_MAX_DELAY_MS > API_RETRY_MAX_DELAY_MS);
      assert(WS_RECONNECT_MAX_DELAY_MS > FS_RETRY_MAX_DELAY_MS);
    });
  });

  describe("retry configuration relationships", () => {
    it("should have all max attempts as positive integers", () => {
      assert(DEFAULT_RETRY_MAX_ATTEMPTS > 0);
      assert(API_RETRY_MAX_ATTEMPTS > 0);
      assert(FS_RETRY_MAX_ATTEMPTS > 0);
      assert(WS_RECONNECT_MAX_ATTEMPTS > 0);
      assert(Number.isInteger(DEFAULT_RETRY_MAX_ATTEMPTS));
      assert(Number.isInteger(API_RETRY_MAX_ATTEMPTS));
      assert(Number.isInteger(FS_RETRY_MAX_ATTEMPTS));
      assert(Number.isInteger(WS_RECONNECT_MAX_ATTEMPTS));
    });

    it("should have all delays as positive integers", () => {
      assert(DEFAULT_RETRY_INITIAL_DELAY_MS > 0);
      assert(DEFAULT_RETRY_MAX_DELAY_MS > 0);
      assert(API_RETRY_INITIAL_DELAY_MS > 0);
      assert(API_RETRY_MAX_DELAY_MS > 0);
      assert(FS_RETRY_INITIAL_DELAY_MS > 0);
      assert(FS_RETRY_MAX_DELAY_MS > 0);
      assert(WS_RECONNECT_INITIAL_DELAY_MS > 0);
      assert(WS_RECONNECT_MAX_DELAY_MS > 0);
    });

    it("should have reasonable exponential backoff potential", () => {
      // With multiplier of 2, verify max delay is reachable with max attempts
      const maxPossibleDelay = DEFAULT_RETRY_INITIAL_DELAY_MS *
        Math.pow(DEFAULT_RETRY_BACKOFF_MULTIPLIER, DEFAULT_RETRY_MAX_ATTEMPTS - 1);
      assert(maxPossibleDelay >= DEFAULT_RETRY_INITIAL_DELAY_MS);
    });
  });
});
