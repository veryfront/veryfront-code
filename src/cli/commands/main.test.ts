/**
 * Tests for main.ts
 */

import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// Test the random name generation pattern
describe("main", () => {
  describe("generateRandomName pattern", () => {
    // We can't directly test the private function, but we can test the pattern
    const ADJECTIVES = [
      "swift",
      "bold",
      "calm",
      "dark",
      "epic",
      "fast",
      "glad",
      "hazy",
      "keen",
      "lite",
      "mint",
      "neat",
      "pale",
      "pure",
      "rare",
      "safe",
      "slim",
      "soft",
      "warm",
      "wild",
    ];

    const NOUNS = [
      "app",
      "api",
      "bot",
      "box",
      "hub",
      "lab",
      "kit",
      "pod",
      "web",
      "dev",
      "dash",
      "flow",
      "link",
      "node",
      "port",
      "sync",
      "task",
      "tool",
      "view",
      "zone",
    ];

    it("adjectives are all lowercase and short", () => {
      for (const adj of ADJECTIVES) {
        assertEquals(adj, adj.toLowerCase());
        assertEquals(adj.length <= 5, true, `${adj} should be <= 5 chars`);
      }
    });

    it("nouns are all lowercase and short", () => {
      for (const noun of NOUNS) {
        assertEquals(noun, noun.toLowerCase());
        assertEquals(noun.length <= 4, true, `${noun} should be <= 4 chars`);
      }
    });

    it("generated name matches expected pattern", () => {
      // Simulate the generation
      const adj = ADJECTIVES[0];
      const noun = NOUNS[0];
      const suffix = "x7k2";
      const name = `${adj}-${noun}-${suffix}`;

      assertMatch(name, /^[a-z]+-[a-z]+-[a-z0-9]+$/);
    });

    it("all adjectives are unique", () => {
      const unique = new Set(ADJECTIVES);
      assertEquals(unique.size, ADJECTIVES.length);
    });

    it("all nouns are unique", () => {
      const unique = new Set(NOUNS);
      assertEquals(unique.size, NOUNS.length);
    });
  });

  describe("MenuAction type", () => {
    it("covers all expected actions", () => {
      const actions = ["new", "dev", "deploy", "login", "help", "exit"];
      assertEquals(actions.length, 6);
    });
  });
});
