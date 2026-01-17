/**
 * Integration tests for merge command
 *
 * Uses VCR for API recording/playback:
 *   Record:  VCR=record VERYFRONT_API_TOKEN=... VERYFRONT_PROJECT_SLUG=... deno test src/cli/commands/merge.integration.ts
 *   Replay:  deno test src/cli/commands/merge.integration.ts
 *
 * @module cli/commands/merge.integration
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { initVCRTest, isRecording, type VCRTestContext } from "../test-utils/vcr.ts";
import { getBranchByName } from "./merge.ts";

describe("merge command integration", () => {
  let ctx: VCRTestContext;
  let testBranchId: string | null = null;

  beforeAll(async () => {
    ctx = await initVCRTest("merge");

    // Create test branch (VCR replays recorded response in playback mode)
    const branchName = isRecording() ? `test-merge-${Date.now()}` : "test-merge-vcr";
    const branch = await ctx.client.post<{ id: string }>(
      `/projects/${ctx.projectSlug}/branches`,
      { name: branchName },
    );
    testBranchId = branch.id;
  });

  afterAll(async () => {
    await ctx.save();
  });

  describe("getBranchByName", () => {
    it("should return null for nonexistent branch", async () => {
      const branch = await getBranchByName(ctx.client, ctx.projectSlug, "nonexistent-branch-12345");

      assertEquals(branch, null, "Nonexistent branch should return null");
    });
  });

  describe("merge preview", () => {
    it("should fetch merge preview for branch", async () => {
      assertExists(testBranchId, "Test branch should exist from beforeAll setup");

      const preview = await ctx.client.get<{ diffs: unknown[] }>(
        `/projects/${ctx.projectSlug}/branches/${testBranchId}/merge-preview`,
      );

      assertExists(preview, "Merge preview should exist");
      assertEquals(Array.isArray(preview.diffs), true, "Preview should have diffs array");
    });
  });
});
