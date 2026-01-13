/**
 * Integration tests for pull command
 *
 * Uses VCR for API recording/playback:
 *   Record:  VCR=record VERYFRONT_API_TOKEN=... VERYFRONT_PROJECT_SLUG=... deno test src/cli/commands/pull.integration.ts
 *   Replay:  deno test src/cli/commands/pull.integration.ts
 *
 * @module cli/commands/pull.integration
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it, beforeAll, afterAll } from "jsr:@std/testing@1/bdd";
import { createApiClient, resolveConfig, type ApiClient } from "../shared/config.ts";
import { createVCRClient, isRecording } from "../test-utils/vcr.ts";
import { listAllFiles, getFileContent, type PullSource } from "./pull.ts";

describe("pull command integration", () => {
  let client: ApiClient;
  let projectSlug: string;
  let saveVCR: () => Promise<void>;

  beforeAll(async () => {
    if (isRecording()) {
      const slug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
      if (!slug) {
        throw new Error("VCR=record requires VERYFRONT_PROJECT_SLUG");
      }
      const config = await resolveConfig(Deno.cwd());
      const realClient = createApiClient(config);
      const vcr = await createVCRClient("pull", realClient, slug);
      client = vcr.client;
      projectSlug = vcr.projectSlug;
      saveVCR = vcr.save;
    } else {
      const vcr = await createVCRClient("pull");
      client = vcr.client;
      projectSlug = vcr.projectSlug;
      saveVCR = vcr.save;
    }
  });

  afterAll(async () => {
    await saveVCR();
  });

  describe("listAllFiles", () => {
    it("should list files from main", async () => {
      const source: PullSource = { type: "main" };
      const files = await listAllFiles(client, projectSlug, source);

      assertExists(files);
      assertEquals(Array.isArray(files), true);
      if (files.length > 0) {
        assertExists(files[0]?.path);
        assertExists(files[0]?.size);
        assertExists(files[0]?.type);
      }
    });

    it("should handle empty project gracefully", async () => {
      const source: PullSource = { type: "main" };
      const files = await listAllFiles(client, projectSlug, source);

      assertEquals(Array.isArray(files), true);
    });
  });

  describe("getFileContent", () => {
    it("should get file content from main", async () => {
      const source: PullSource = { type: "main" };
      const files = await listAllFiles(client, projectSlug, source);

      if (files.length === 0) {
        console.log("Skipping: no files in project");
        return;
      }

      const content = await getFileContent(client, projectSlug, files[0]!.path, source);

      assertExists(content);
      assertEquals(typeof content, "string");
    });
  });
});
