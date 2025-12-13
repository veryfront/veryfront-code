import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  SECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  HOURS_PER_DAY,
  MS_PER_SECOND,
  DEFAULT_LRU_MAX_ENTRIES,
  ONE_DAY_MS,
  LRU_DEFAULT_MAX_ENTRIES,
  LRU_DEFAULT_MAX_SIZE_BYTES,
} from "./cache.ts";

describe("utils/constants/cache", () => {
  it("should export time constants", () => {
    assertEquals(SECONDS_PER_MINUTE, 60);
    assertEquals(MINUTES_PER_HOUR, 60);
    assertEquals(HOURS_PER_DAY, 24);
    assertEquals(MS_PER_SECOND, 1000);
  });

  it("should calculate ONE_DAY_MS correctly", () => {
    assertEquals(ONE_DAY_MS, 24 * 60 * 60 * 1000);
    assertEquals(ONE_DAY_MS, 86400000);
  });

  it("should export LRU constants", () => {
    assertEquals(DEFAULT_LRU_MAX_ENTRIES, 100);
    assertEquals(LRU_DEFAULT_MAX_ENTRIES, 1000);
    assert(LRU_DEFAULT_MAX_SIZE_BYTES > 0);
  });
});
