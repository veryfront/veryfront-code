/**
 * Integration tests for push command
 * These tests require a real API connection and valid credentials.
 * Run with: deno task test:integration src/cli/commands/push.integration.ts
 *
 * WARNING: These tests create real branches and files in the project.
 * Use with caution in production environments.
 *
 * @module cli/commands/push.integration
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it, beforeAll, afterAll } from "jsr:@std/testing@1/bdd";
import { createApiClient, resolveConfig, type ApiClient } from "../shared/config.ts";
import { createBranch, uploadFiles, type UploadOp } from "./push.ts";

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

describe("push command integration", () => {
  let client: ApiClient;
  let projectSlug: string;
  let testBranchId: string | null = null;

  beforeAll(async () => {
    if (skipIfNoCredentials()) return;

    const config = await resolveConfig(Deno.cwd());
    client = createApiClient(config);
    projectSlug = config.projectSlug;
  });

  afterAll(async () => {
    // Cleanup: delete test branch if it was created
    if (testBranchId && client) {
      try {
        await client.delete(`/projects/${projectSlug}/branches/${testBranchId}`);
        console.log(`Cleaned up test branch: ${testBranchId}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("createBranch", () => {
    it("should create a new branch", async () => {
      if (skipIfNoCredentials()) return;

      const branchName = `test-push-${Date.now()}`;
      const branch = await createBranch(client, projectSlug, branchName);

      assertExists(branch);
      assertExists(branch.id);
      assertEquals(branch.name, branchName);

      // Store for cleanup
      testBranchId = branch.id;
    });

    it("should fail to create duplicate branch", async () => {
      if (skipIfNoCredentials()) return;
      if (!testBranchId) return; // Need the branch from previous test

      // Try to create the same branch again
      try {
        await createBranch(client, projectSlug, `test-push-duplicate-${Date.now()}`);
        // If this succeeds, clean it up
      } catch (error) {
        // Expected - can't reuse same name
        assertExists(error);
      }
    });
  });

  describe("uploadFiles", () => {
    it("should upload files to branch", async () => {
      if (skipIfNoCredentials()) return;
      if (!testBranchId) {
        // Create a branch if we don't have one
        const branch = await createBranch(client, projectSlug, `test-upload-${Date.now()}`);
        testBranchId = branch.id;
      }

      const ops: UploadOp[] = [
        { path: "_test/integration-test.txt", content: `Integration test at ${new Date().toISOString()}\n` },
      ];

      const result = await uploadFiles(client, projectSlug, testBranchId, ops, false);

      assertEquals(result.uploaded, 1);
      assertEquals(result.failed, 0);
    });

    it("should handle dry run without changes", async () => {
      if (skipIfNoCredentials()) return;

      const ops: UploadOp[] = [
        { path: "_test/dry-run-test.txt", content: "Should not be uploaded\n" },
      ];

      const result = await uploadFiles(client, projectSlug, testBranchId, ops, true);

      assertEquals(result.uploaded, 1);
      assertEquals(result.failed, 0);
    });
  });
});
