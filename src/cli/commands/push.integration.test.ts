/**
 * Integration tests for push command
 *
 * Uses VCR for API recording/playback:
 *   Record:  VCR=record VERYFRONT_API_TOKEN=... VERYFRONT_PROJECT_SLUG=... deno test src/cli/commands/push.integration.ts
 *   Replay:  deno test src/cli/commands/push.integration.ts
 *
 * @module cli/commands/push.integration
 */

import { assertExists } from "jsr:@std/assert@1";
import { afterAll, beforeAll, describe, it } from "jsr:@std/testing@1/bdd";
import { initVCRTest, isRecording, type VCRTestContext } from "../test-utils/vcr.ts";
import { createBranch } from "./push.ts";

describe("push command integration", () => {
  let ctx: VCRTestContext;

  beforeAll(async () => {
    ctx = await initVCRTest("push");
  });

  afterAll(async () => {
    await ctx.save();
  });

  describe("createBranch", () => {
    it("should create a new branch", async () => {
      const branchName = isRecording() ? `test-push-${Date.now()}` : "test-push-vcr";
      const branch = await createBranch(ctx.client, ctx.projectSlug, branchName);

      assertExists(branch);
      assertExists(branch.id);
      assertExists(branch.name);
    });

    it("should create branch with special characters in name", async () => {
      const branchName = isRecording() ? `test/feature-${Date.now()}` : "test/feature-vcr";
      const branch = await createBranch(ctx.client, ctx.projectSlug, branchName);

      assertExists(branch);
      assertExists(branch.id);
      assertExists(branch.name);
    });
  });
});
