import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("veryfront-api-client/index.ts exports", () => {
  it("should export expected members", async () => {
    const mod = await import("./index.ts");

    const expected: Array<[string, string]> = [
      ["VeryfrontAPIClient", "function"],
      ["VeryfrontAPIOperations", "function"],
      ["requestWithRetry", "function"],
      ["VeryfrontAPIError", "function"],
      ["API_ENDPOINTS", "object"],
    ];

    for (const [key, type] of expected) {
      assertExists(mod[key as keyof typeof mod]);
      assertEquals(typeof mod[key as keyof typeof mod], type);
    }

    const schemas = [
      "BranchFileDetailSchema",
      "EnvironmentFileDetailSchema",
      "ListBranchFilesResponseSchema",
      "ListEnvironmentFilesResponseSchema",
      "ListProjectsResponseSchema",
      "ProjectFileSchema",
      "ProjectSchema",
    ] as const;

    for (const key of schemas) {
      assertExists(mod[key]);
    }
  });
});
