import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearSnippetCache,
  clearSnippetCacheForProject,
  getCompiledSnippet,
  rememberCompiledSnippet,
  renderSnippet,
} from "./snippet-renderer.ts";
import { MAX_STUDIO_CONFIG_ID_LENGTH } from "#veryfront/studio/limits.ts";

describe("rendering/snippet-renderer", () => {
  describe("getCompiledSnippet", () => {
    it("should return undefined for non-existent hash", () => {
      assertEquals(getCompiledSnippet("nonexistent-hash", "project-a"), undefined);
    });

    it("should return undefined for empty hash", () => {
      assertEquals(getCompiledSnippet("", "project-a"), undefined);
    });

    it("returns executable code only to the project scope that stored it", () => {
      const hash = "a".repeat(64);
      rememberCompiledSnippet({
        hash,
        code: "export default null",
        projectScope: "project-a",
      });

      assertEquals(getCompiledSnippet(hash, "project-a"), "export default null");
      assertEquals(getCompiledSnippet(hash, "project-b"), undefined);
      clearSnippetCache();
    });
  });

  describe("clearSnippetCache", () => {
    it("should clear without error", () => {
      clearSnippetCache();
      // After clearing, no snippets should be cached
      assertEquals(getCompiledSnippet("any-key", "project-a"), undefined);
    });

    it("should be idempotent", () => {
      clearSnippetCache();
      clearSnippetCache();
      assertEquals(getCompiledSnippet("any-key", "project-a"), undefined);
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

  it("returns a Studio-aware HTML shell when rendering fails", async () => {
    const result = await renderSnippet("# Broken snippet", {
      mode: "development",
      projectId: "project-a",
      projectDir: ".",
      filePath: "components/broken.snippet.mdx",
      pageId: "page-1",
      moduleServerUrl: "ftp://invalid.example.test",
      config: {},
    });

    assertStringIncludes(result.html, "Snippet render error");
    assertStringIncludes(result.html, "studio-bridge.js");
    assertStringIncludes(result.html, '"projectId":"project-a"');
    assertStringIncludes(result.html, '"pageId":"page-1"');
    assertStringIncludes(result.html, '"pagePath":"components/broken.snippet.mdx"');
  });

  it("rejects a project identity that the Studio bridge cannot initialize", async () => {
    await assertRejects(
      () =>
        renderSnippet("# Snippet", {
          mode: "development",
          projectId: "p".repeat(MAX_STUDIO_CONFIG_ID_LENGTH + 1),
          projectDir: ".",
          filePath: "components/example.snippet.mdx",
          moduleServerUrl: "http://localhost:3002",
        }),
      TypeError,
      "projectId",
    );
  });
});
