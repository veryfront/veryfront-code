import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("veryfront-api-client/index.ts exports", () => {
  it("should export expected members", async () => {
    const mod = await import("./index.ts");

    assertExists(mod.VeryfrontAPIClient);
    assertEquals(typeof mod.VeryfrontAPIClient, "function");

    assertExists(mod.VeryfrontAPIOperations);
    assertEquals(typeof mod.VeryfrontAPIOperations, "function");

    assertExists(mod.requestWithRetry);
    assertEquals(typeof mod.requestWithRetry, "function");

    assertExists(mod.VeryfrontAPIError);
    assertEquals(typeof mod.VeryfrontAPIError, "function");

    assertExists(mod.API_ENDPOINTS);
    assertEquals(typeof mod.API_ENDPOINTS, "object");

    assertExists(mod.BranchFileDetailSchema);
    assertExists(mod.EnvironmentFileDetailSchema);
    assertExists(mod.ListBranchFilesResponseSchema);
    assertExists(mod.ListEnvironmentFilesResponseSchema);
    assertExists(mod.ListProjectsResponseSchema);
    assertExists(mod.ProjectFileSchema);
    assertExists(mod.ProjectSchema);
  });
});
