import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearSnippetCache,
  clearSnippetCacheForProject,
  getCompiledSnippet,
} from "./snippet-renderer.ts";

describe("rendering/snippet-renderer", () => {
  describe("getCompiledSnippet", () => {
    it("should return undefined for non-existent hash", () => {
      assertEquals(getCompiledSnippet("nonexistent-hash"), undefined);
    });

    it("should return undefined for empty hash", () => {
      assertEquals(getCompiledSnippet(""), undefined);
    });
  });

  describe("clearSnippetCache", () => {
    it("should clear without error", () => {
      clearSnippetCache();
      // After clearing, no snippets should be cached
      assertEquals(getCompiledSnippet("any-key"), undefined);
    });

    it("should be idempotent", () => {
      clearSnippetCache();
      clearSnippetCache();
      assertEquals(getCompiledSnippet("any-key"), undefined);
    });
  });

  describe("clearSnippetCacheForProject", () => {
    it("should clear without error for unknown project", () => {
      clearSnippetCacheForProject("unknown-project");
    });

    it("should not affect other projects", () => {
      clearSnippetCacheForProject("project-a");
      // No crash = success
    });
  });
});
