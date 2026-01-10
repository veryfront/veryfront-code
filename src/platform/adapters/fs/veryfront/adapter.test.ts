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

    it("should have setProductionMode method", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.setProductionMode);
      assertEquals(typeof adapter.setProductionMode, "function");
    });
  });

  describe("production mode", () => {
    it("should default to non-production mode", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertEquals(adapter.isProductionMode(), false);
    });

    it("should be able to set production mode", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      adapter.setProductionMode(true, "release-123");
      assertEquals(adapter.isProductionMode(), true);
      assertEquals(adapter.getReleaseId(), "release-123");
    });

    it("should be able to clear production mode", () => {
      const adapter = new VeryfrontFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      adapter.setProductionMode(true, "release-123");
      adapter.clearProductionMode();
      assertEquals(adapter.isProductionMode(), false);
      assertEquals(adapter.getReleaseId(), null);
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
