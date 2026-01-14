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
import { initVCRTest, isRecording, type VCRTestContext } from "../test-utils/vcr.ts";
import { createDeployment, createRelease, getEnvironmentByName } from "./deploy.ts";

describe("deploy command integration", () => {
  let ctx: VCRTestContext;
  let testReleaseId: string | null = null;

  beforeAll(async () => {
    ctx = await initVCRTest("deploy");
  });

  afterAll(async () => {
    await ctx.save();
  });

  describe("getEnvironmentByName", () => {
    it("should list environments", async () => {
      const response = await ctx.client.get<{ data: unknown[] }>(
        `/projects/${ctx.projectSlug}/environments`,
      );

      assertExists(response);
      assertEquals(Array.isArray(response.data), true);
    });

    it("should find production environment", async () => {
      const env = await getEnvironmentByName(ctx.client, ctx.projectSlug, "production");

      if (env) {
        assertExists(env.id);
        assertEquals(env.name, "production");
      }
    });

    it("should return null for nonexistent environment", async () => {
      const env = await getEnvironmentByName(ctx.client, ctx.projectSlug, "nonexistent-env-12345");

      assertEquals(env, null);
    });
  });

  describe("createRelease", () => {
    it("should create a release", async () => {
      const releaseName = isRecording() ? `test-release-${Date.now()}` : "test-release-vcr";
      const release = await createRelease(ctx.client, ctx.projectSlug, { name: releaseName });

      assertExists(release);
      assertExists(release.id);
      assertExists(release.version);

      testReleaseId = release.id;
    });

    it("should create release without custom name", async () => {
      const release = await createRelease(ctx.client, ctx.projectSlug);

      assertExists(release);
      assertExists(release.id);
      assertExists(release.version);
    });
  });

  describe("createDeployment", () => {
    it("should create deployment with valid release and environment", async () => {
      if (!testReleaseId) return;

      const env = await getEnvironmentByName(ctx.client, ctx.projectSlug, "production");
      if (!env) return;

      const deployment = await createDeployment(ctx.client, ctx.projectSlug, testReleaseId, env.id);

      assertExists(deployment);
      assertExists(deployment.id);
      assertExists(deployment.release);
      assertExists(deployment.environment);
    });
  });
});
