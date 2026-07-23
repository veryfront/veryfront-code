import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hashString, sha256Short } from "./hash.ts";

describe("cache/hash", () => {
  describe("hashString", () => {
    it("should return a 128-bit lowercase hexadecimal string", () => {
      const hash = hashString("test");
      assertEquals(hash.length, 32);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });

    it("should be consistent", () => {
      assertEquals(hashString("foo"), hashString("foo"));
    });

    it("does not collapse distinct unpaired UTF-16 surrogates", () => {
      assertNotEquals(hashString("\ud800"), hashString("\ud801"));
    });
  });

  describe("sha256Short", () => {
    it("should retain 128 bits of the digest", async () => {
      assertEquals((await sha256Short("hello")).length, 32);
    });

    it("does not collapse distinct unpaired UTF-16 surrogates", async () => {
      assertNotEquals(await sha256Short("\ud800"), await sha256Short("\ud801"));
    });
  });
});
