import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
  });

  describe("sha256Short", () => {
    it("should return 8 character string", async () => {
      assertEquals((await sha256Short("hello")).length, 8);
    });
  });
});
