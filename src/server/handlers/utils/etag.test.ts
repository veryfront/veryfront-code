import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  computeEtag,
  computeStrongEtag,
  hasMatchingEtag,
  matchesAnyEtag,
  parseIfNoneMatch,
} from "./etag.ts";

describe("server/handlers/utils/etag", () => {
  describe("computeEtag", () => {
    it("should produce a weak ETag by default", async () => {
      const etag = await computeEtag("hello");
      assertEquals(etag.startsWith('W/"'), true);
      assertEquals(etag.endsWith('"'), true);
    });

    it("should produce deterministic output", async () => {
      assertEquals(await computeEtag("test"), await computeEtag("test"));
    });

    it("should produce different output for different input", async () => {
      const a = await computeEtag("foo");
      const b = await computeEtag("bar");
      assertEquals(a !== b, true);
    });

    it("should not collide for inputs that collide under the legacy 32-bit hash", async () => {
      const first = await computeEtag("0000r");
      const second = await computeEtag("00020");

      assertEquals(first === second, false);
    });

    it("should accept Uint8Array", async () => {
      const etag = await computeEtag(new Uint8Array([72, 101, 108, 108, 111]));
      assertEquals(etag.startsWith('W/"'), true);
    });

    it("should produce strong ETag when weak=false", async () => {
      const etag = await computeEtag("hello", false);
      assertEquals(etag.startsWith('"'), true);
      assertEquals(etag.startsWith("W/"), false);
      assertEquals(etag.length, 66);
    });
  });

  describe("computeStrongEtag", () => {
    it("should produce a strong ETag without W/ prefix", async () => {
      const etag = await computeStrongEtag("content");
      assertEquals(etag.startsWith('"'), true);
      assertEquals(etag.startsWith("W/"), false);
    });

    it("should use the standard SHA-256 digest", async () => {
      assertEquals(
        await computeStrongEtag("hello"),
        '"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"',
      );
    });
  });

  describe("hasMatchingEtag", () => {
    it("should return true when If-None-Match matches", async () => {
      const etag = await computeEtag("data");
      const req = new Request("http://localhost/", {
        headers: { "If-None-Match": etag },
      });
      assertEquals(hasMatchingEtag(req, etag), true);
    });

    it("should match a list member using weak comparison", () => {
      const req = new Request("http://localhost/", {
        headers: { "If-None-Match": '"old", W/"current", "other"' },
      });

      assertEquals(hasMatchingEtag(req, '"current"'), true);
    });

    it("should match the wildcard validator", () => {
      const req = new Request("http://localhost/", {
        headers: { "If-None-Match": "*" },
      });

      assertEquals(hasMatchingEtag(req, 'W/"current"'), true);
    });

    it("should return false when no If-None-Match header", () => {
      const req = new Request("http://localhost/");
      assertEquals(hasMatchingEtag(req, '"abc"'), false);
    });

    it("should return false on mismatch", () => {
      const req = new Request("http://localhost/", {
        headers: { "If-None-Match": '"old"' },
      });
      assertEquals(hasMatchingEtag(req, '"new"'), false);
    });
  });

  describe("parseIfNoneMatch", () => {
    it("should return empty array for null", () => {
      assertEquals(parseIfNoneMatch(null), []);
    });

    it("should parse comma-separated tags", () => {
      assertEquals(parseIfNoneMatch('"a", "b", "c"'), ['"a"', '"b"', '"c"']);
    });

    it("should not split commas inside an opaque tag", () => {
      assertEquals(parseIfNoneMatch('W/"a,b", "c"'), ['W/"a,b"', '"c"']);
    });

    it("should handle wildcard", () => {
      assertEquals(parseIfNoneMatch("*"), ["*"]);
    });

    it("should filter empty entries", () => {
      assertEquals(parseIfNoneMatch('"a",,,"b"'), ['"a"', '"b"']);
    });

    it("rejects oversized validator lists before parsing them", () => {
      const oversized = '"current",' + '"stale",'.repeat(1_024);

      assertEquals(parseIfNoneMatch(oversized), []);
      assertEquals(matchesAnyEtag('"current"', oversized), false);
    });
  });

  describe("matchesAnyEtag", () => {
    it("should match wildcard", () => {
      assertEquals(matchesAnyEtag('"anything"', "*"), true);
    });

    it("should match exact etag", () => {
      assertEquals(matchesAnyEtag('"abc"', '"abc", "def"'), true);
    });

    it("should use weak comparison for If-None-Match", () => {
      assertEquals(matchesAnyEtag('"abc"', 'W/"abc"'), true);
      assertEquals(matchesAnyEtag('W/"abc"', '"abc"'), true);
    });

    it("should not match malformed entity tags", () => {
      assertEquals(matchesAnyEtag('"abc"', "abc"), false);
      assertEquals(matchesAnyEtag('"abc"', 'W/"abc'), false);
      assertEquals(matchesAnyEtag('"abc"', '*, "abc"'), false);
      assertEquals(matchesAnyEtag('"abc"', '"\u0100"'), false);
    });

    it("should return false on no match", () => {
      assertEquals(matchesAnyEtag('"xyz"', '"abc", "def"'), false);
    });

    it("should return false for null header", () => {
      assertEquals(matchesAnyEtag('"abc"', null), false);
    });
  });
});
