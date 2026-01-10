import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { VeryfrontAPIOperations } from "./operations.ts";

describe("VeryfrontAPIOperations", () => {
  describe("class", () => {
    it("should export VeryfrontAPIOperations class", () => {
      assertExists(VeryfrontAPIOperations);
      assertEquals(typeof VeryfrontAPIOperations, "function");
    });

    it("should be instantiable with string token", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "test-token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertExists(ops);
    });

    it("should be instantiable with token provider function", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        () => "dynamic-token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertExists(ops);
    });
  });

  describe("getToken", () => {
    it("should return token from string", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "static-token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertEquals(ops.getToken(), "static-token");
    });

    it("should return token from provider function", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        () => "provider-token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertEquals(ops.getToken(), "provider-token");
    });
  });

  describe("setTokenProvider", () => {
    it("should update the token provider", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "old-token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertEquals(ops.getToken(), "old-token");

      ops.setTokenProvider(() => "new-token");
      assertEquals(ops.getToken(), "new-token");
    });
  });

  describe("setProjectId/getProjectId", () => {
    it("should set and get project ID", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
        "initial-project-id",
      );
      assertEquals(ops.getProjectId(), "initial-project-id");

      ops.setProjectId("new-project-id");
      assertEquals(ops.getProjectId(), "new-project-id");
    });

    it("should throw when getting project ID if not set", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );

      assertThrows(
        () => ops.getProjectId(),
        Error,
        "Veryfront API client not initialized",
      );
    });
  });

  describe("methods exist", () => {
    it("should have listProjects method", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertExists(ops.listProjects);
      assertEquals(typeof ops.listProjects, "function");
    });

    it("should have getProject method", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertExists(ops.getProject);
      assertEquals(typeof ops.getProject, "function");
    });

    it("should have listFiles method", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertExists(ops.listFiles);
      assertEquals(typeof ops.listFiles, "function");
    });

    it("should have getFileContent method", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertExists(ops.getFileContent);
      assertEquals(typeof ops.getFileContent, "function");
    });

    it("should have listPublishedFiles method", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertExists(ops.listPublishedFiles);
      assertEquals(typeof ops.listPublishedFiles, "function");
    });

    it("should have lookupProjectByDomain method", () => {
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
      );
      assertExists(ops.lookupProjectByDomain);
      assertEquals(typeof ops.lookupProjectByDomain, "function");
    });
  });
});
