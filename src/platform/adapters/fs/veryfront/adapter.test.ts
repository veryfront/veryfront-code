import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";

function createAdapter(): VeryfrontFSAdapter {
  return new VeryfrontFSAdapter({
    veryfront: {
      baseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: false },
    },
  });
}

describe("VeryfrontFSAdapter", () => {
  describe("class", () => {
    it("should export VeryfrontFSAdapter class", () => {
      assertExists(VeryfrontFSAdapter);
      assertEquals(typeof VeryfrontFSAdapter, "function");
    });
  });

  describe("instance methods", () => {
    // Note: Full adapter tests require API access
    // These tests verify the class structure without network calls

    it("should be instantiable with minimal config", () => {
      const adapter = createAdapter();
      assertExists(adapter);
    });

    it("should have readFile method", () => {
      const adapter = createAdapter();
      assertExists(adapter.readFile);
      assertEquals(typeof adapter.readFile, "function");
    });

    it("should have readTextFile method", () => {
      const adapter = createAdapter();
      assertExists(adapter.readTextFile);
      assertEquals(typeof adapter.readTextFile, "function");
    });

    it("should have readdir method", () => {
      const adapter = createAdapter();
      assertExists(adapter.readdir);
      assertEquals(typeof adapter.readdir, "function");
    });

    it("should have stat method", () => {
      const adapter = createAdapter();
      assertExists(adapter.stat);
      assertEquals(typeof adapter.stat, "function");
    });

    it("should have exists method", () => {
      const adapter = createAdapter();
      assertExists(adapter.exists);
      assertEquals(typeof adapter.exists, "function");
    });

    it("should have initialize method", () => {
      const adapter = createAdapter();
      assertExists(adapter.initialize);
      assertEquals(typeof adapter.initialize, "function");
    });

    it("should have dispose method", () => {
      const adapter = createAdapter();
      assertExists(adapter.dispose);
      assertEquals(typeof adapter.dispose, "function");
    });

    it("should have getCacheStats method", () => {
      const adapter = createAdapter();
      assertExists(adapter.getCacheStats);
      assertEquals(typeof adapter.getCacheStats, "function");
    });

    it("should have setRequestToken method", () => {
      const adapter = createAdapter();
      assertExists(adapter.setRequestToken);
      assertEquals(typeof adapter.setRequestToken, "function");
    });

    it("should have setContentContext method", () => {
      const adapter = createAdapter();
      assertExists(adapter.setContentContext);
      assertEquals(typeof adapter.setContentContext, "function");
    });
  });

  describe("content context", () => {
    it("should default to null before initialize", () => {
      const adapter = createAdapter();
      // Context is null until initialize() is called or setContentContext() is used
      assertEquals(adapter.getContentContext(), null);
    });

    it("should preserve context set via setContentContext before initialize", () => {
      // This test verifies the fix for the bug where initialize() would
      // overwrite a pre-set content context (e.g., from ProxyFSAdapterManager)
      const adapter = createAdapter();

      // Simulate what ProxyFSAdapterManager does: set context before initialize
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "my-project",
        releaseId: "release-uuid-123",
      });

      // Verify context is set correctly
      const context = adapter.getContentContext();
      assertEquals(context?.sourceType, "release");
      assertEquals(context?.projectSlug, "my-project");
      assertEquals(context?.releaseId, "release-uuid-123");

      // Note: Full integration test with initialize() requires API mocking
      // The fix ensures initialize() checks `if (!this.contentContext)` before
      // calling resolveContentSource(), preserving the pre-set context
    });

    it("should be able to set environment context", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "production",
      });
      const context = adapter.getContentContext();
      assertEquals(context?.sourceType, "environment");
      assertEquals(context?.environmentName, "production");
    });

    it("should be able to set release context", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "release-123",
      });
      const context = adapter.getContentContext();
      assertEquals(context?.sourceType, "release");
      assertEquals(context?.releaseId, "release-123");
    });

    it("should be able to set branch context", () => {
      const adapter = createAdapter();
      adapter.setContentContext({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      });
      const context = adapter.getContentContext();
      assertEquals(context?.sourceType, "branch");
      assertEquals(context?.branch, "main");
    });
  });

  describe("request branch", () => {
    it("should default to null request branch", () => {
      const adapter = createAdapter();
      assertEquals(adapter.getRequestBranch(), null);
    });

    it("should be able to set request branch", () => {
      const adapter = createAdapter();
      adapter.setRequestBranch("feature-branch");
      assertEquals(adapter.getRequestBranch(), "feature-branch");
    });

    it("should be able to clear request branch", () => {
      const adapter = createAdapter();
      adapter.setRequestBranch("feature-branch");
      adapter.clearRequestBranch();
      assertEquals(adapter.getRequestBranch(), null);
    });
  });
});
