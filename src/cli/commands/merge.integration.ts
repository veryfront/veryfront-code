/**
 * Integration tests for merge command
 * These tests require a real API connection and valid credentials.
 * Run with: deno task test:integration src/cli/commands/merge.integration.ts
 *
 * WARNING: These tests create and merge real branches in the project.
 * Use with caution in production environments.
 *
 * @module cli/commands/merge.integration
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it, beforeAll, afterAll } from "jsr:@std/testing@1/bdd";
import { createApiClient, resolveConfig, type ApiClient } from "../shared/config.ts";
import { getBranchByName, mergeBranch } from "./merge.ts";

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

describe("merge command integration", () => {
  let client: ApiClient;
  let projectSlug: string;
  let testBranchId: string | null = null;
  const testBranchName = `test-merge-${Date.now()}`;

  beforeAll(async () => {
    if (skipIfNoCredentials()) return;

    const config = await resolveConfig(Deno.cwd());
    client = createApiClient(config);
    projectSlug = config.projectSlug;

    // Create a test branch for merging
    try {
      const branch = await client.post<{ id: string; name: string }>(
        `/projects/${projectSlug}/branches`,
        { name: testBranchName },
      );
      testBranchId = branch.id;
      console.log(`Created test branch: ${testBranchName} (${testBranchId})`);
    } catch (error) {
      console.error("Failed to create test branch:", error);
    }
  });

  afterAll(async () => {
    // Cleanup: delete test branch if it exists and wasn't merged
    if (testBranchId && client) {
      try {
        await client.delete(`/projects/${projectSlug}/branches/${testBranchId}`);
        console.log(`Cleaned up test branch: ${testBranchId}`);
      } catch {
        // Ignore cleanup errors - branch might have been merged/deleted
      }
    }
  });

  describe("getBranchByName", () => {
    it("should find branch by name", async () => {
      if (skipIfNoCredentials()) return;
      if (!testBranchId) return;

      const branch = await getBranchByName(client, projectSlug, testBranchName);

      assertExists(branch);
      assertEquals(branch.id, testBranchId);
      assertEquals(branch.name, testBranchName);
    });

    it("should return null for nonexistent branch", async () => {
      if (skipIfNoCredentials()) return;

      const branch = await getBranchByName(client, projectSlug, "nonexistent-branch-12345");

      assertEquals(branch, null);
    });
  });

  describe("mergeBranch", () => {
    it("should fetch merge preview", async () => {
      if (skipIfNoCredentials()) return;
      if (!testBranchId) return;

      // Get merge preview
      const preview = await client.get<{ diffs: unknown[] }>(
        `/projects/${projectSlug}/branches/${testBranchId}/merge-preview`,
      );

      assertExists(preview);
      assertEquals(Array.isArray(preview.diffs), true);
    });

    it("should merge branch to main", async () => {
      if (skipIfNoCredentials()) return;
      if (!testBranchId) return;

      const result = await mergeBranch(client, projectSlug, testBranchId);

      assertExists(result);
      assertEquals(result.success, true);

      // Branch is now merged, clear the ID so cleanup doesn't try to delete it
      testBranchId = null;
    });
  });
});
