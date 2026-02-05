/**
 * Integration tests for pull command
 *
 * Uses VCR for API recording/playback:
 *   Record:  VCR=record VERYFRONT_API_TOKEN=... VERYFRONT_PROJECT_SLUG=... deno test src/cli/commands/pull.integration.ts
 *   Replay:  deno test src/cli/commands/pull.integration.ts
 *
 * @module cli/commands/pull.integration
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { initVCRTest, type VCRTestContext } from "../../test-utils/vcr.ts";
import { getFileContent, listAllFiles, type PullSource } from "./command.ts";

describe("pull command integration", () => {
  let ctx: VCRTestContext;

  beforeAll(async () => {
    ctx = await initVCRTest("pull");
  });

  afterAll(async () => {
    await ctx.save();
  });

  describe("listAllFiles", () => {
    it("should list files from main", async () => {
      const source: PullSource = { type: "main" };
      const files = await listAllFiles(ctx.client, ctx.projectSlug, source);

      assertEquals(Array.isArray(files), true);

      const first = files[0];
      if (!first) return;

      assertExists(first.path);
      assertExists(first.size);
      assertExists(first.type);
    });

    it("should handle empty project gracefully", async () => {
      const source: PullSource = { type: "main" };
      const files = await listAllFiles(ctx.client, ctx.projectSlug, source);

      assertEquals(Array.isArray(files), true);
    });
  });

  describe("getFileContent", () => {
    it("should get file content from main", async () => {
      const source: PullSource = { type: "main" };
      const files = await listAllFiles(ctx.client, ctx.projectSlug, source);

      const first = files[0];
      if (!first) return;

      const content = await getFileContent(ctx.client, ctx.projectSlug, first.path, source);

      assertExists(content);
      assertEquals(typeof content, "string");
    });
  });
});
