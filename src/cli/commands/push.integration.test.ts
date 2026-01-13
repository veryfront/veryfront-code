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
import { type ApiClient, createApiClient, resolveConfig } from "../shared/config.ts";
import { createVCRClient, isRecording } from "../test-utils/vcr.ts";
import { createBranch } from "./push.ts";

describe("push command integration", () => {
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
      const vcr = await createVCRClient("push", realClient, slug);
      client = vcr.client;
      projectSlug = vcr.projectSlug;
      saveVCR = vcr.save;
    } else {
      const vcr = await createVCRClient("push");
      client = vcr.client;
      projectSlug = vcr.projectSlug;
      saveVCR = vcr.save;
    }
  });

  afterAll(async () => {
    await saveVCR();
  });

  describe("createBranch", () => {
    it("should create a new branch", async () => {
      const branchName = isRecording() ? `test-push-${Date.now()}` : "test-push-vcr";
      const branch = await createBranch(client, projectSlug, branchName);

      assertExists(branch);
      assertExists(branch.id);
      assertExists(branch.name);
    });

    it("should create branch with special characters in name", async () => {
      const branchName = isRecording() ? `test/feature-${Date.now()}` : "test/feature-vcr";
      const branch = await createBranch(client, projectSlug, branchName);

      assertExists(branch);
      assertExists(branch.id);
      assertExists(branch.name);
    });
  });
});
