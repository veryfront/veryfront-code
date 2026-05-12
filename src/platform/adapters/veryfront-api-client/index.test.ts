import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("veryfront-api-client/index.ts exports", () => {
  it("should export expected members", async () => {
    const mod = await import("./index.ts");

    const expected: Array<[string, string]> = [
      ["VeryfrontApiClient", "function"],
      ["VeryfrontAPIOperations", "function"],
      ["requestWithRetry", "function"],
      ["API_CLIENT_ERROR", "object"],
      ["VeryfrontError", "function"],
      ["API_ENDPOINTS", "object"],
    ];

    for (const [key, type] of expected) {
      assertExists(mod[key as keyof typeof mod]);
      assertEquals(typeof mod[key as keyof typeof mod], type);
    }

    const schemas = [
      "getBranchFileDetailSchema",
      "getEnvironmentFileDetailSchema",
      "getListBranchFilesResponseSchema",
      "getListEnvironmentFilesResponseSchema",
      "getListProjectsResponseSchema",
      "getProjectFileSchema",
      "getProjectSchema",
    ] as const;

    for (const key of schemas) {
      assertExists(mod[key]);
    }
  });
});
