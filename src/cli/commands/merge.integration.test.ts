/**
 * Integration tests for merge command
 *
 * Uses VCR for API recording/playback:
 *   Record:  VCR=record VERYFRONT_API_TOKEN=... VERYFRONT_PROJECT_SLUG=... deno test src/cli/commands/merge.integration.ts
 *   Replay:  deno test src/cli/commands/merge.integration.ts
 *
 * @module cli/commands/merge.integration
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it, beforeAll, afterAll } from "jsr:@std/testing@1/bdd";
import { createApiClient, resolveConfig, type ApiClient } from "../shared/config.ts";
import { createVCRClient, isRecording } from "../test-utils/vcr.ts";
import { getBranchByName } from "./merge.ts";

describe("merge command integration", () => {
  let client: ApiClient;
  let projectSlug: string;
  let saveVCR: () => Promise<void>;
  let testBranchId: string | null = null;

  beforeAll(async () => {
    if (isRecording()) {
      const slug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
      if (!slug) {
        throw new Error("VCR=record requires VERYFRONT_PROJECT_SLUG");
      }
      const config = await resolveConfig(Deno.cwd());
      const realClient = createApiClient(config);
      const vcr = await createVCRClient("merge", realClient, slug);
      client = vcr.client;
      projectSlug = vcr.projectSlug;
      saveVCR = vcr.save;
    } else {
      const vcr = await createVCRClient("merge");
      client = vcr.client;
      projectSlug = vcr.projectSlug;
      saveVCR = vcr.save;
    }

    // Create test branch (VCR replays recorded response in playback mode)
    const branchName = isRecording() ? `test-merge-${Date.now()}` : "test-merge-vcr";
    try {
      const branch = await client.post<{ id: string }>(`/projects/${projectSlug}/branches`, { name: branchName });
      testBranchId = branch.id;
      if (isRecording()) {
        console.log(`Created test branch: ${branchName} (${testBranchId})`);
      }
    } catch (error) {
      console.error("Failed to create test branch:", error);
    }
  });

  afterAll(async () => {
    await saveVCR();
  });

  describe("getBranchByName", () => {
    it("should return null for nonexistent branch", async () => {
      const branch = await getBranchByName(client, projectSlug, "nonexistent-branch-12345");

      assertEquals(branch, null);
    });
  });

  describe("merge preview", () => {
    it("should fetch merge preview for branch", async () => {
      if (!testBranchId) {
        console.log("Skipping: no test branch available");
        return;
      }

      const preview = await client.get<{ diffs: unknown[] }>(
        `/projects/${projectSlug}/branches/${testBranchId}/merge-preview`,
      );

      assertExists(preview);
      assertEquals(Array.isArray(preview.diffs), true);
    });
  });
});
