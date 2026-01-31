import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CACHE_DURATIONS, CONTENT_TYPES } from "./constants.ts";

describe("HTTP response constants", () => {
  describe("CONTENT_TYPES", () => {
    const cases: Array<[keyof typeof CONTENT_TYPES, string]> = [
      ["JSON", "application/json; charset=utf-8"],
      ["HTML", "text/html; charset=utf-8"],
      ["TEXT", "text/plain; charset=utf-8"],
      ["JAVASCRIPT", "application/javascript; charset=utf-8"],
      ["CSS", "text/css; charset=utf-8"],
      ["XML", "application/xml; charset=utf-8"],
    ];

    for (const [key, expected] of cases) {
      it(`should define ${key} content type`, () => {
        assertEquals(CONTENT_TYPES[key], expected);
      });
    }

    it("should include charset in all content types", () => {
      for (const [key, value] of Object.entries(CONTENT_TYPES)) {
        assert(value.includes("charset=utf-8"), `${key} should include charset`);
      }
    });
  });

  describe("CACHE_DURATIONS", () => {
    it("should define SHORT as 60 seconds", () => {
      assertEquals(CACHE_DURATIONS.SHORT, 60);
    });

    it("should define MEDIUM as 3600 seconds (1 hour)", () => {
      assertEquals(CACHE_DURATIONS.MEDIUM, 3600);
    });

    it("should define LONG as 31536000 seconds (1 year)", () => {
      assertEquals(CACHE_DURATIONS.LONG, 31536000);
    });

    it("should be in ascending order", () => {
      assert(CACHE_DURATIONS.SHORT < CACHE_DURATIONS.MEDIUM);
      assert(CACHE_DURATIONS.MEDIUM < CACHE_DURATIONS.LONG);
    });
  });
});
