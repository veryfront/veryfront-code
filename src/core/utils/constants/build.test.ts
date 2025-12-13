import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { DEFAULT_BUILD_CONCURRENCY, IMAGE_OPTIMIZATION } from "./build.ts";

describe("utils/constants/build", () => {
  it("should export DEFAULT_BUILD_CONCURRENCY", () => {
    assertEquals(DEFAULT_BUILD_CONCURRENCY, 4);
  });

  it("should export IMAGE_OPTIMIZATION constants", () => {
    assert(Array.isArray(IMAGE_OPTIMIZATION.DEFAULT_SIZES));
    assertEquals(IMAGE_OPTIMIZATION.DEFAULT_QUALITY, 80);
  });
});
