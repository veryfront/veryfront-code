import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontAPIOperations } from "./operations.ts";

function createOps(
  token: string | (() => string) = "token",
  projectId?: string,
): VeryfrontAPIOperations {
  return new VeryfrontAPIOperations(
    "https://api.example.com",
    token,
    { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
    projectId,
  );
}

function assertMethodExists<T extends object>(obj: T, key: keyof T): void {
  const value = obj[key];
  assertExists(value);
  assertEquals(typeof value, "function");
}

describe("VeryfrontAPIOperations", () => {
  describe("class", () => {
    it("should export VeryfrontAPIOperations class", () => {
      assertExists(VeryfrontAPIOperations);
      assertEquals(typeof VeryfrontAPIOperations, "function");
    });

    it("should be instantiable with string token", () => {
      assertExists(createOps("test-token"));
    });

    it("should be instantiable with token provider function", () => {
      assertExists(createOps(() => "dynamic-token"));
    });
  });

  describe("getToken", () => {
    it("should return token from string", () => {
      assertEquals(createOps("static-token").getToken(), "static-token");
    });

    it("should return token from provider function", () => {
      assertEquals(createOps(() => "provider-token").getToken(), "provider-token");
    });
  });

  describe("setTokenProvider", () => {
    it("should update the token provider", () => {
      const ops = createOps("old-token");
      assertEquals(ops.getToken(), "old-token");

      ops.setTokenProvider(() => "new-token");
      assertEquals(ops.getToken(), "new-token");
    });
  });

  describe("setProjectId/getProjectId", () => {
    it("should set and get project ID", () => {
      const ops = createOps("token", "initial-project-id");
      assertEquals(ops.getProjectId(), "initial-project-id");

      ops.setProjectId("new-project-id");
      assertEquals(ops.getProjectId(), "new-project-id");
    });

    it("should throw when getting project ID if not set", () => {
      const ops = createOps("token");

      assertThrows(
        () => ops.getProjectId(),
        Error,
        "Veryfront API client not initialized",
      );
    });
  });

  describe("methods exist", () => {
    it("should have listProjects method", () => {
      assertMethodExists(createOps(), "listProjects");
    });

    it("should have getProject method", () => {
      assertMethodExists(createOps(), "getProject");
    });

    it("should have listBranchFiles method", () => {
      assertMethodExists(createOps(), "listBranchFiles");
    });

    it("should have getBranchFile method", () => {
      assertMethodExists(createOps(), "getBranchFile");
    });

    it("should have listEnvironmentFiles method", () => {
      assertMethodExists(createOps(), "listEnvironmentFiles");
    });

    it("should have getEnvironmentFile method", () => {
      assertMethodExists(createOps(), "getEnvironmentFile");
    });

    it("should have listReleaseFiles method", () => {
      assertMethodExists(createOps(), "listReleaseFiles");
    });

    it("should have getReleaseFile method", () => {
      assertMethodExists(createOps(), "getReleaseFile");
    });

    it("should have lookupProjectByDomain method", () => {
      assertMethodExists(createOps(), "lookupProjectByDomain");
    });
  });
});
