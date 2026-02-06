/**
 * Integration tests for deploy command
 *
 * Uses VCR for API recording/playback:
 *   Record:  VCR=record VERYFRONT_API_TOKEN=... VERYFRONT_PROJECT_SLUG=... deno test cli/commands/deploy.integration.ts
 *   Replay:  deno test cli/commands/deploy.integration.ts
 *
 * @module cli/commands/deploy.integration
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { initVCRTest, isRecording, type VCRTestContext } from "../../test-utils/vcr.ts";
import { createDeployment, createRelease, getEnvironmentByName } from "./index.ts";

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

      assertExists(response, "Response should exist");
      assertEquals(Array.isArray(response.data), true, "Response data should be an array");
    });

    it("should find production environment", async () => {
      const env = await getEnvironmentByName(ctx.client, ctx.projectSlug, "production");

      assertExists(env, "Production environment should exist in test project");
      assertExists(env.id, "Environment should have an id");
      assertEquals(env.name, "production", "Environment name should be 'production'");
    });

    it("should return null for nonexistent environment", async () => {
      const env = await getEnvironmentByName(ctx.client, ctx.projectSlug, "nonexistent-env-12345");

      assertEquals(env, null, "Nonexistent environment should return null");
    });
  });

  describe("createRelease", () => {
    it("should create a release with custom name", async () => {
      const releaseName = isRecording() ? `test-release-${Date.now()}` : "test-release-vcr";
      const release = await createRelease(ctx.client, ctx.projectSlug, { name: releaseName });

      assertExists(release, "Release should be created");
      assertExists(release.id, "Release should have an id");
      assertExists(release.version, "Release should have a version");

      testReleaseId = release.id;
    });

    it("should create release without custom name (auto-generated)", async () => {
      const release = await createRelease(ctx.client, ctx.projectSlug);

      assertExists(release, "Release should be created");
      assertExists(release.id, "Release should have an id");
      assertExists(release.version, "Release should have a version");
    });
  });

  describe("createDeployment", () => {
    it("should create deployment with valid release and environment", async () => {
      assertExists(testReleaseId, "Test release should exist from previous test");

      const env = await getEnvironmentByName(ctx.client, ctx.projectSlug, "production");
      assertExists(env, "Production environment should exist");

      const deployment = await createDeployment(ctx.client, ctx.projectSlug, testReleaseId, env.id);

      assertExists(deployment, "Deployment should be created");
      assertExists(deployment.id, "Deployment should have an id");
      assertExists(deployment.release, "Deployment should reference release");
      assertExists(deployment.environment, "Deployment should reference environment");
    });
  });
});
