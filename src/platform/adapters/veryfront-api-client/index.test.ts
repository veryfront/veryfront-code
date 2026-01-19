import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("veryfront-api-client/index.ts exports", () => {
  it("should export VeryfrontAPIClient", async () => {
    const { VeryfrontAPIClient } = await import("./index.ts");
    assertExists(VeryfrontAPIClient);
    assertEquals(typeof VeryfrontAPIClient, "function");
  });

  it("should export VeryfrontAPIOperations", async () => {
    const { VeryfrontAPIOperations } = await import("./index.ts");
    assertExists(VeryfrontAPIOperations);
    assertEquals(typeof VeryfrontAPIOperations, "function");
  });

  it("should export requestWithRetry", async () => {
    const { requestWithRetry } = await import("./index.ts");
    assertExists(requestWithRetry);
    assertEquals(typeof requestWithRetry, "function");
  });

  it("should export VeryfrontAPIError", async () => {
    const { VeryfrontAPIError } = await import("./index.ts");
    assertExists(VeryfrontAPIError);
    assertEquals(typeof VeryfrontAPIError, "function");
  });

  it("should export API_ENDPOINTS", async () => {
    const { API_ENDPOINTS } = await import("./index.ts");
    assertExists(API_ENDPOINTS);
    assertEquals(typeof API_ENDPOINTS, "object");
  });

  it("should export schema validators", async () => {
    const {
      BranchFileDetailSchema,
      EnvironmentFileDetailSchema,
      ListBranchFilesResponseSchema,
      ListEnvironmentFilesResponseSchema,
      ListProjectsResponseSchema,
      ProjectFileSchema,
      ProjectSchema,
    } = await import("./index.ts");

    assertExists(BranchFileDetailSchema);
    assertExists(EnvironmentFileDetailSchema);
    assertExists(ListBranchFilesResponseSchema);
    assertExists(ListEnvironmentFilesResponseSchema);
    assertExists(ListProjectsResponseSchema);
    assertExists(ProjectFileSchema);
    assertExists(ProjectSchema);
  });
});
