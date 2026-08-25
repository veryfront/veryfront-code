import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileCache } from "./factory.ts";
import { FileCache } from "./file-cache.ts";

describe("createFileCache", () => {
  it("should export createFileCache function", () => {
    assertExists(createFileCache);
    assertEquals(typeof createFileCache, "function");
  });

  it("should create a FileCache instance with default options", () => {
    const cache = createFileCache();
    assertExists(cache);
    assertEquals(cache instanceof FileCache, true);
  });

  it("should create a FileCache instance with custom options", () => {
    const cache = createFileCache({ maxSize: 1000, ttl: 60000 });
    assertExists(cache);
    assertEquals(cache instanceof FileCache, true);

    const disabled = createFileCache({ enabled: false });
    disabled.set("k", "v");
    assertEquals(
      disabled.get<string>("k"),
      undefined,
      "enabled:false must reach the FileCache instance so reads miss",
    );

    const enabled = createFileCache({ enabled: true });
    enabled.set("k", "v");
    assertEquals(
      enabled.get<string>("k"),
      "v",
      "an enabled cache round-trips the value",
    );
  });

  it("should create independent cache instances", () => {
    const cache1 = createFileCache();
    const cache2 = createFileCache();
    assertEquals(cache1 !== cache2, true);
  });
});
