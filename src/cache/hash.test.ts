import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hashString, sha256Short } from "./hash.ts";

describe("cache/hash", () => {
  describe("hashString", () => {
    it("should return a string", () => {
      assertEquals(typeof hashString("test"), "string");
    });

    it("should be consistent", () => {
      assertEquals(hashString("foo"), hashString("foo"));
    });

    it("should stay FNV-1a 64-bit", () => {
      assertEquals(
        hashString("foo"),
        "3ctmc9neelldj",
        "hashString must stay FNV-1a 64-bit: a narrower fold collides in module-response cache keys",
      );
    });

    it("should not collide across near-identical module keys", () => {
      const keys = Array.from({ length: 5000 }, (_, i) => `module-${i}.tsx`);

      assertEquals(
        new Set(keys.map(hashString)).size,
        keys.length,
        "near-identical module keys must not collide",
      );
    });
  });

  describe("sha256Short", () => {
    it("should return 8 character string", async () => {
      assertEquals((await sha256Short("hello")).length, 8);
    });

    it("should be the leading hex of the SHA-256 digest", async () => {
      assertEquals(
        await sha256Short("hello"),
        "2cf24dba",
        "sha256Short must be the first 8 hex chars of the SHA-256 digest",
      );
    });

    it("should not echo or alias its input", async () => {
      assertNotEquals(
        await sha256Short("hello"),
        await sha256Short("hellp"),
        "inputs sharing a prefix must not share a hash",
      );
      assertEquals(
        (await sha256Short("hello")).startsWith("hello"),
        false,
        "the hash must not echo the input",
      );
    });
  });
});
