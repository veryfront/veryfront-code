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
import { afterAll, beforeAll, describe, it } from "jsr:@std/testing@1/bdd";
import { initVCRTest, isRecording, type VCRTestContext } from "../test-utils/vcr.ts";
import { getBranchByName } from "./merge.ts";

describe("merge command integration", () => {
  let ctx: VCRTestContext;
  let testBranchId: string | null = null;

  beforeAll(async () => {
    ctx = await initVCRTest("merge");

    // Create test branch (VCR replays recorded response in playback mode)
    const branchName = isRecording() ? `test-merge-${Date.now()}` : "test-merge-vcr";
    try {
      const branch = await ctx.client.post<{ id: string }>(
        `/projects/${ctx.projectSlug}/branches`,
        { name: branchName },
      );
      testBranchId = branch.id;
    } catch {
      // Branch creation may fail in playback if not recorded
    }
  });

  afterAll(async () => {
    await ctx.save();
  });

  describe("getBranchByName", () => {
    it("should return null for nonexistent branch", async () => {
      const branch = await getBranchByName(ctx.client, ctx.projectSlug, "nonexistent-branch-12345");

      assertEquals(branch, null);
    });
  });

  describe("merge preview", () => {
    it("should fetch merge preview for branch", async () => {
      if (!testBranchId) return;

      const preview = await ctx.client.get<{ diffs: unknown[] }>(
        `/projects/${ctx.projectSlug}/branches/${testBranchId}/merge-preview`,
      );

      assertExists(preview);
      assertEquals(Array.isArray(preview.diffs), true);
    });
  });
});
