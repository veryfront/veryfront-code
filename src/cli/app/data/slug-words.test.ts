/**
 * Tests for slug words data
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ADJECTIVES, NOUNS } from "./slug-words.ts";

describe("slug-words", () => {
  describe("ADJECTIVES", () => {
    it("is a non-empty array", () => {
      assertExists(ADJECTIVES);
      assertEquals(Array.isArray(ADJECTIVES), true);
      assertEquals(ADJECTIVES.length > 0, true);
    });

    it("contains only lowercase strings", () => {
      for (const adj of ADJECTIVES) {
        assertEquals(typeof adj, "string");
        assertEquals(adj, adj.toLowerCase());
      }
    });

    it("contains expected adjectives", () => {
      assertEquals(ADJECTIVES.includes("amber"), true);
      assertEquals(ADJECTIVES.includes("bold"), true);
      assertEquals(ADJECTIVES.includes("cosmic"), true);
      assertEquals(ADJECTIVES.includes("zen"), true);
    });

    it("has no duplicates", () => {
      const unique = new Set(ADJECTIVES);
      assertEquals(unique.size, ADJECTIVES.length);
    });
  });

  describe("NOUNS", () => {
    it("is a non-empty array", () => {
      assertExists(NOUNS);
      assertEquals(Array.isArray(NOUNS), true);
      assertEquals(NOUNS.length > 0, true);
    });

    it("contains only lowercase strings", () => {
      for (const noun of NOUNS) {
        assertEquals(typeof noun, "string");
        assertEquals(noun, noun.toLowerCase());
      }
    });

    it("contains expected nouns", () => {
      assertEquals(NOUNS.includes("bay"), true);
      assertEquals(NOUNS.includes("canyon"), true);
      assertEquals(NOUNS.includes("galaxy"), true);
      assertEquals(NOUNS.includes("zenith"), true);
    });

    it("has no duplicates", () => {
      const unique = new Set(NOUNS);
      assertEquals(unique.size, NOUNS.length);
    });
  });
});
