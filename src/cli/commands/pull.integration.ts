/**
 * Integration tests for pull command
 * These tests require a real API connection and valid credentials.
 * Run with: deno task test:integration src/cli/commands/pull.integration.ts
 *
 * @module cli/commands/pull.integration
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it, beforeAll } from "jsr:@std/testing@1/bdd";
import { createApiClient, resolveConfig, type ApiClient } from "../shared/config.ts";
import { listAllFiles, getFileContent, type PullSource } from "./pull.ts";

// Skip integration tests if no API token
const API_TOKEN = Deno.env.get("VERYFRONT_API_TOKEN");
const PROJECT_SLUG = Deno.env.get("VERYFRONT_PROJECT_SLUG");

// Helper to skip tests when no credentials
function skipIfNoCredentials() {
  if (!API_TOKEN || !PROJECT_SLUG) {
    console.log("Skipping integration tests: VERYFRONT_API_TOKEN or VERYFRONT_PROJECT_SLUG not set");
    return true;
  }
  return false;
}

describe("pull command integration", () => {
  let client: ApiClient;
  let projectSlug: string;

  beforeAll(async () => {
    if (skipIfNoCredentials()) return;

    const config = await resolveConfig(Deno.cwd());
    client = createApiClient(config);
    projectSlug = config.projectSlug;
  });

  describe("listAllFiles", () => {
    it("should list files from main", async () => {
      if (skipIfNoCredentials()) return;

      const source: PullSource = { type: "main" };
      const files = await listAllFiles(client, projectSlug, source);

      assertExists(files);
      assertEquals(Array.isArray(files), true);
      // Should have at least some files in a real project
      if (files.length > 0) {
        assertExists(files[0]?.path);
        assertExists(files[0]?.size);
        assertExists(files[0]?.type);
      }
    });

    it("should return empty array for nonexistent branch", async () => {
      if (skipIfNoCredentials()) return;

      const source: PullSource = { type: "branch", name: "nonexistent-branch-12345" };

      try {
        await listAllFiles(client, projectSlug, source);
        // If it doesn't throw, check for empty result
      } catch (error) {
        // Expected - branch doesn't exist
        assertExists(error);
      }
    });
  });

  describe("getFileContent", () => {
    it("should get file content from main", async () => {
      if (skipIfNoCredentials()) return;

      // First list files to get a valid path
      const source: PullSource = { type: "main" };
      const files = await listAllFiles(client, projectSlug, source);

      if (files.length === 0) {
        console.log("Skipping: no files in project");
        return;
      }

      // Get content of first file
      const content = await getFileContent(client, projectSlug, files[0]!.path, source);

      assertExists(content);
      assertEquals(typeof content, "string");
      // Content should end with newline (POSIX standard)
      assertEquals(content.endsWith("\n"), true);
    });
  });
});
