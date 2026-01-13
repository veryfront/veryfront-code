/**
 * Integration tests for deploy command
 *
 * Uses VCR for API recording/playback:
 *   Record:  VCR=record VERYFRONT_API_TOKEN=... VERYFRONT_PROJECT_SLUG=... deno test src/cli/commands/deploy.integration.ts
 *   Replay:  deno test src/cli/commands/deploy.integration.ts
 *
 * @module cli/commands/deploy.integration
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { afterAll, beforeAll, describe, it } from "jsr:@std/testing@1/bdd";
import { type ApiClient, createApiClient, resolveConfig } from "../shared/config.ts";
import { createVCRClient, isRecording } from "../test-utils/vcr.ts";
import { createDeployment, createRelease, getEnvironmentByName } from "./deploy.ts";

describe("deploy command integration", () => {
  let client: ApiClient;
  let projectSlug: string;
  let saveVCR: () => Promise<void>;
  let testReleaseId: string | null = null;

  beforeAll(async () => {
    if (isRecording()) {
      const slug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
      if (!slug) {
        throw new Error("VCR=record requires VERYFRONT_PROJECT_SLUG");
      }
      const config = await resolveConfig(Deno.cwd());
      const realClient = createApiClient(config);
      const vcr = await createVCRClient("deploy", realClient, slug);
      client = vcr.client;
      projectSlug = vcr.projectSlug;
      saveVCR = vcr.save;
    } else {
      // Playback - projectSlug is extracted from cassette
      const vcr = await createVCRClient("deploy");
      client = vcr.client;
      projectSlug = vcr.projectSlug;
      saveVCR = vcr.save;
    }
  });

  afterAll(async () => {
    await saveVCR();
  });

  describe("getEnvironmentByName", () => {
    it("should list environments", async () => {
      const response = await client.get<{ data: unknown[] }>(
        `/projects/${projectSlug}/environments`,
      );

      assertExists(response);
      assertEquals(Array.isArray(response.data), true);
    });

    it("should find production environment", async () => {
      const env = await getEnvironmentByName(client, projectSlug, "production");

      if (env) {
        assertExists(env.id);
        assertEquals(env.name, "production");
      }
    });

    it("should return null for nonexistent environment", async () => {
      const env = await getEnvironmentByName(client, projectSlug, "nonexistent-env-12345");

      assertEquals(env, null);
    });
  });

  describe("createRelease", () => {
    it("should create a release", async () => {
      const releaseName = isRecording() ? `test-release-${Date.now()}` : "test-release-vcr";
      const release = await createRelease(client, projectSlug, { name: releaseName });

      assertExists(release);
      assertExists(release.id);
      assertExists(release.version);

      testReleaseId = release.id;
    });

    it("should create release without custom name", async () => {
      const release = await createRelease(client, projectSlug);

      assertExists(release);
      assertExists(release.id);
      assertExists(release.version);
    });
  });

  describe("createDeployment", () => {
    it("should create deployment with valid release and environment", async () => {
      if (!testReleaseId) return;

      const env = await getEnvironmentByName(client, projectSlug, "production");
      if (!env) {
        console.log("Skipping: production environment not found");
        return;
      }

      const deployment = await createDeployment(client, projectSlug, testReleaseId, env.id);

      assertExists(deployment);
      assertExists(deployment.id);
      assertExists(deployment.release);
      assertExists(deployment.environment);
    });
  });
});
