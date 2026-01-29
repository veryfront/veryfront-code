/**
 * Test: 013.2 Agent Cache Project Isolation
 *
 * Validates the fix for issue 013.2 from the architecture audit:
 * - Agent cache now includes projectId in cache keys
 * - Different projects cannot share cached agent responses
 * - Multi-tenant isolation is enforced
 *
 * @see plans/architecture-audit/013.2-agent-cache-project-isolation.md
 */

import { assertEquals, assertNotEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { createCache } from "../../../src/agent/middleware/cache/cache.ts";

const makeResponse = (text: string) => ({
  text,
  messages: [],
  toolCalls: [],
  status: "completed" as const,
  metadata: {},
});

describe("013.2 Agent Cache Project Isolation", () => {
  describe("Default Key Generator", () => {
    it("should generate different keys for same input with different projectIds", () => {
      const cache = createCache({ strategy: "memory" });

      const input = "What is the weather?";
      const contextA = { projectId: "project-a" };
      const contextB = { projectId: "project-b" };

      // Set response for project A
      cache.set(input, makeResponse("Response for A"), contextA);

      // Project B should not see project A's cached response
      const cachedForB = cache.get(input, contextB);
      assertEquals(cachedForB, null, "Project B should not get Project A's cache");

      // Project A should still see its own response
      const cachedForA = cache.get(input, contextA);
      assertNotEquals(cachedForA, null, "Project A should get its own cache");
      assertEquals(cachedForA?.text, "Response for A");
    });

    it("should support projectId in nested context.project.id", () => {
      const cache = createCache({ strategy: "memory" });

      const input = "Hello";
      const contextA = { project: { id: "project-a" } };
      const contextB = { project: { id: "project-b" } };

      cache.set(input, makeResponse("A"), contextA);

      assertEquals(cache.get(input, contextB), null);
      assertEquals(cache.get(input, contextA)?.text, "A");
    });

    it("should support projectId in nested context.renderContext.projectId", () => {
      const cache = createCache({ strategy: "memory" });

      const input = "Hello";
      const contextA = { renderContext: { projectId: "project-a" } };
      const contextB = { renderContext: { projectId: "project-b" } };

      cache.set(input, makeResponse("A"), contextA);

      assertEquals(cache.get(input, contextB), null);
      assertEquals(cache.get(input, contextA)?.text, "A");
    });

    it("should still work without projectId (backwards compatible)", () => {
      const cache = createCache({ strategy: "memory" });

      const input = "Hello";
      const contextEmpty = {};

      cache.set(input, makeResponse("No project"), contextEmpty);

      // Same input without project context should hit cache
      const cached = cache.get(input, {});
      assertEquals(cached?.text, "No project");
    });
  });

  describe("Custom Key Generator Override", () => {
    it("should allow custom key generator to override default behavior", () => {
      const customKeyGenerator = (input: string) => `custom_${input}`;
      const cache = createCache({
        strategy: "memory",
        keyGenerator: customKeyGenerator,
      });

      const input = "test";
      const contextA = { projectId: "project-a" };
      const contextB = { projectId: "project-b" };

      cache.set(input, makeResponse("Custom"), contextA);

      // Custom key generator ignores projectId, so both projects share cache
      const cachedForB = cache.get(input, contextB);
      assertEquals(
        cachedForB?.text,
        "Custom",
        "Custom key generator can override isolation",
      );
    });
  });

  describe("Cache Strategies", () => {
    it("should maintain isolation with LRU strategy", () => {
      const cache = createCache({ strategy: "lru", maxSize: 10 });

      const input = "Same input";
      cache.set(input, makeResponse("A"), { projectId: "a" });
      cache.set(input, makeResponse("B"), { projectId: "b" });

      assertEquals(cache.get(input, { projectId: "a" })?.text, "A");
      assertEquals(cache.get(input, { projectId: "b" })?.text, "B");
    });

    it("should maintain isolation with TTL strategy", () => {
      // Use ttl: 0 to disable cleanup interval (avoids resource leak in tests)
      const cache = createCache({ strategy: "ttl", ttl: 0 });

      const input = "Same input";
      cache.set(input, makeResponse("A"), { projectId: "a" });
      cache.set(input, makeResponse("B"), { projectId: "b" });

      assertEquals(cache.get(input, { projectId: "a" })?.text, "A");
      assertEquals(cache.get(input, { projectId: "b" })?.text, "B");
    });
  });
});
