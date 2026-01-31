import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("fs/github/index.ts exports", () => {
  async function getModule(): Promise<Record<string, unknown>> {
    return (await import("./index.ts")) as Record<string, unknown>;
  }

  async function assertExport(
    name: string,
    expectedType?: "function" | "object",
  ): Promise<void> {
    const mod = await getModule();
    const value = mod[name];
    assertExists(value);

    if (!expectedType) return;
    assertEquals(typeof value, expectedType);
  }

  it("should export GitHubFSAdapter", () => assertExport("GitHubFSAdapter", "function"));
  it("should export GitHubAPIClient", () => assertExport("GitHubAPIClient", "function"));
  it("should export GitHubStatOperations", () => assertExport("GitHubStatOperations", "function"));
  it("should export GitHubReadOperations", () => assertExport("GitHubReadOperations", "function"));
  it("should export GitHubDirectoryOperations", () =>
    assertExport("GitHubDirectoryOperations", "function"));
  it("should export createGitHubConfig", () => assertExport("createGitHubConfig", "function"));
  it("should export GITHUB_API_ENDPOINTS", () => assertExport("GITHUB_API_ENDPOINTS", "object"));

  it("should export schema validators", async () => {
    const mod = await getModule();
    const schemaNames = [
      "GitHubBlobResponseSchema",
      "GitHubContentItemSchema",
      "GitHubContentsResponseSchema",
      "GitHubTreeEntrySchema",
      "GitHubTreeResponseSchema",
    ] as const;

    for (const name of schemaNames) {
      assertExists(mod[name]);
    }
  });
});
