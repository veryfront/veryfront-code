import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("fs/github/index.ts exports", () => {
  it("should export GitHubFSAdapter", async () => {
    const { GitHubFSAdapter } = await import("./index.ts");
    assertExists(GitHubFSAdapter);
    assertEquals(typeof GitHubFSAdapter, "function");
  });

  it("should export GitHubAPIClient", async () => {
    const { GitHubAPIClient } = await import("./index.ts");
    assertExists(GitHubAPIClient);
    assertEquals(typeof GitHubAPIClient, "function");
  });

  it("should export GitHubStatOperations", async () => {
    const { GitHubStatOperations } = await import("./index.ts");
    assertExists(GitHubStatOperations);
    assertEquals(typeof GitHubStatOperations, "function");
  });

  it("should export GitHubReadOperations", async () => {
    const { GitHubReadOperations } = await import("./index.ts");
    assertExists(GitHubReadOperations);
    assertEquals(typeof GitHubReadOperations, "function");
  });

  it("should export GitHubDirectoryOperations", async () => {
    const { GitHubDirectoryOperations } = await import("./index.ts");
    assertExists(GitHubDirectoryOperations);
    assertEquals(typeof GitHubDirectoryOperations, "function");
  });

  it("should export createGitHubConfig", async () => {
    const { createGitHubConfig } = await import("./index.ts");
    assertExists(createGitHubConfig);
    assertEquals(typeof createGitHubConfig, "function");
  });

  it("should export GITHUB_API_ENDPOINTS", async () => {
    const { GITHUB_API_ENDPOINTS } = await import("./index.ts");
    assertExists(GITHUB_API_ENDPOINTS);
    assertEquals(typeof GITHUB_API_ENDPOINTS, "object");
  });

  it("should export schema validators", async () => {
    const {
      GitHubBlobResponseSchema,
      GitHubContentItemSchema,
      GitHubContentsResponseSchema,
      GitHubTreeEntrySchema,
      GitHubTreeResponseSchema,
    } = await import("./index.ts");
    assertExists(GitHubBlobResponseSchema);
    assertExists(GitHubContentItemSchema);
    assertExists(GitHubContentsResponseSchema);
    assertExists(GitHubTreeEntrySchema);
    assertExists(GitHubTreeResponseSchema);
  });
});
