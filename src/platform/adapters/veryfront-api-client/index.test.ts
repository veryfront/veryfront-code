import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";

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
      GetFileContentResponseSchema,
      GetProjectResponseSchema,
      ListFilesResponseSchema,
      ListProjectsResponseSchema,
      ProjectFileSchema,
      ProjectSchema,
    } = await import("./index.ts");

    assertExists(GetFileContentResponseSchema);
    assertExists(GetProjectResponseSchema);
    assertExists(ListFilesResponseSchema);
    assertExists(ListProjectsResponseSchema);
    assertExists(ProjectFileSchema);
    assertExists(ProjectSchema);
  });
});
