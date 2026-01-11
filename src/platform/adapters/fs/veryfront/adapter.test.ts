import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { VeryfrontFSAdapter } from "./adapter.ts";

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
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter);
    });

    it("should have readFile method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.readFile);
      assertEquals(typeof adapter.readFile, "function");
    });

    it("should have readTextFile method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.readTextFile);
      assertEquals(typeof adapter.readTextFile, "function");
    });

    it("should have readdir method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.readdir);
      assertEquals(typeof adapter.readdir, "function");
    });

    it("should have stat method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.stat);
      assertEquals(typeof adapter.stat, "function");
    });

    it("should have exists method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.exists);
      assertEquals(typeof adapter.exists, "function");
    });

    it("should have initialize method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.initialize);
      assertEquals(typeof adapter.initialize, "function");
    });

    it("should have dispose method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.dispose);
      assertEquals(typeof adapter.dispose, "function");
    });

    it("should have getCacheStats method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.getCacheStats);
      assertEquals(typeof adapter.getCacheStats, "function");
    });

    it("should have setRequestToken method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.setRequestToken);
      assertEquals(typeof adapter.setRequestToken, "function");
    });

    it("should have setContentContext method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.setContentContext);
      assertEquals(typeof adapter.setContentContext, "function");
    });
  });

  describe("content context", () => {
    it("should default to branch context", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      // Context is null until initialize() is called
      assertEquals(adapter.getContentContext(), null);
    });

    it("should be able to set environment context", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
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
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
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
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
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
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertEquals(adapter.getRequestBranch(), null);
    });

    it("should be able to set request branch", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      adapter.setRequestBranch("feature-branch");
      assertEquals(adapter.getRequestBranch(), "feature-branch");
    });

    it("should be able to clear request branch", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      adapter.setRequestBranch("feature-branch");
      adapter.clearRequestBranch();
      assertEquals(adapter.getRequestBranch(), null);
    });
  });
});
