import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { computeEtag } from "./etag.ts";

function assertWeakEtagFormat(etag: string): void {
  assert(etag.startsWith('W/"'));
  assert(etag.endsWith('"'));
}

describe("security/http/middleware/etag", () => {
  describe("computeEtag", () => {
    it("should return a weak ETag string", () => {
      assertWeakEtagFormat(computeEtag("hello"));
    });

    it("should return consistent results for the same input", () => {
      const a = computeEtag("test content");
      const b = computeEtag("test content");
      assertEquals(a, b);
    });

    it("should return different results for different input", () => {
      const a = computeEtag("hello");
      const b = computeEtag("world");
      assert(a !== b, "Expected different ETags for different inputs");
    });

    it("should handle empty string", () => {
      assertWeakEtagFormat(computeEtag(""));
    });

    it("should handle long strings", () => {
      assertWeakEtagFormat(computeEtag("a".repeat(10000)));
    });

    it("should produce a hex hash value", () => {
      const etag = computeEtag("test");
      const hex = etag.slice(3, -1); // strip W/" and "
      assert(/^[0-9a-f]+$/.test(hex), `Expected hex hash, got: ${hex}`);
    });
  });
});
