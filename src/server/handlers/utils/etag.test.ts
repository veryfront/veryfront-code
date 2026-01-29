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
    it("should produce a weak ETag by default", () => {
      const etag = computeEtag("hello");
      assertEquals(etag.startsWith('W/"'), true);
      assertEquals(etag.endsWith('"'), true);
    });

    it("should produce deterministic output", () => {
      assertEquals(computeEtag("test"), computeEtag("test"));
    });

    it("should produce different output for different input", () => {
      const a = computeEtag("foo");
      const b = computeEtag("bar");
      assertEquals(a !== b, true);
    });

    it("should accept Uint8Array", () => {
      const etag = computeEtag(new Uint8Array([72, 101, 108, 108, 111]));
      assertEquals(etag.startsWith('W/"'), true);
    });

    it("should produce strong ETag when weak=false", () => {
      const etag = computeEtag("hello", false);
      assertEquals(etag.startsWith('"'), true);
      assertEquals(etag.startsWith("W/"), false);
    });
  });

  describe("computeStrongEtag", () => {
    it("should produce a strong ETag without W/ prefix", () => {
      const etag = computeStrongEtag("content");
      assertEquals(etag.startsWith('"'), true);
      assertEquals(etag.startsWith("W/"), false);
    });
  });

  describe("hasMatchingEtag", () => {
    it("should return true when If-None-Match matches", () => {
      const etag = computeEtag("data");
      const req = new Request("http://localhost/", {
        headers: { "If-None-Match": etag },
      });
      assertEquals(hasMatchingEtag(req, etag), true);
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

    it("should handle wildcard", () => {
      assertEquals(parseIfNoneMatch("*"), ["*"]);
    });

    it("should filter empty entries", () => {
      assertEquals(parseIfNoneMatch('"a",,,"b"'), ['"a"', '"b"']);
    });
  });

  describe("matchesAnyEtag", () => {
    it("should match wildcard", () => {
      assertEquals(matchesAnyEtag('"anything"', "*"), true);
    });

    it("should match exact etag", () => {
      assertEquals(matchesAnyEtag('"abc"', '"abc", "def"'), true);
    });

    it("should return false on no match", () => {
      assertEquals(matchesAnyEtag('"xyz"', '"abc", "def"'), false);
    });

    it("should return false for null header", () => {
      assertEquals(matchesAnyEtag('"abc"', null), false);
    });
  });
});
