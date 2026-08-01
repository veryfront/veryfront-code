import "#veryfront/schemas/_test-setup.ts";
/**
 * Integration tests for the deploy control plane
 *
 * Uses VCR for API recording/playback:
 *   Record:  VCR=record VERYFRONT_API_TOKEN=... VERYFRONT_PROJECT_SLUG=... deno test cli/commands/deploy.integration.ts
 *   Replay:  deno test cli/commands/deploy.integration.ts
 *
 * @module cli/commands/deploy.integration
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { initVCRTest, isRecording, type VCRTestContext } from "../../../tests/support/cli-vcr.ts";
import {
  createHttpDeployControlPlane,
  type DeployControlPlane,
} from "../../shared/deployment/control-plane.ts";

describe("deploy command integration", () => {
  let ctx: VCRTestContext;
  let controlPlane: DeployControlPlane;
  let testReleaseId: string | null = null;

  beforeAll(async () => {
    ctx = await initVCRTest("deploy");
    controlPlane = createHttpDeployControlPlane(
      {
        apiUrl: "https://api.veryfront.com/api",
        apiToken: "vcr-token",
        projectSlug: ctx.projectSlug,
      },
      ctx.client,
    );
  });

  afterAll(async () => {
    await ctx.save();
  });

  describe("getEnvironment", () => {
    it("should list environments", async () => {
      const response = await ctx.client.get<{ data: unknown[] }>(
        `/projects/${ctx.projectSlug}/environments`,
      );

      assertExists(response, "Response should exist");
      assertEquals(Array.isArray(response.data), true, "Response data should be an array");
    });

    it("should find production environment", async () => {
      const env = await controlPlane.getEnvironment(ctx.projectSlug, "production");

      assertExists(env, "Production environment should exist in test project");
      assertExists(env.id, "Environment should have an id");
      assertEquals(env.name, "production", "Environment name should be 'production'");
    });

    it("should return null for nonexistent environment", async () => {
      const env = await controlPlane.getEnvironment(ctx.projectSlug, "nonexistent-env-12345");

      assertEquals(env, null, "Nonexistent environment should return null");
    });
  });

  describe("createRelease", () => {
    // branch: "" keeps the request body identical to the recorded cassettes —
    // the control plane omits branch_reference for empty branches, matching
    // the legacy no-branch requests these recordings were made with.
    it("should create a release with custom name", async () => {
      const releaseName = isRecording() ? `test-release-${Date.now()}` : "test-release-vcr";
      const release = await controlPlane.createRelease(ctx.projectSlug, {
        name: releaseName,
        branch: "",
      });

      assertExists(release, "Release should be created");
      assertExists(release.id, "Release should have an id");
      assertExists(release.version, "Release should have a version");

      testReleaseId = release.id;
    });

    it("should create release without custom name (auto-generated)", async () => {
      const release = await controlPlane.createRelease(ctx.projectSlug, { branch: "" });

      assertExists(release, "Release should be created");
      assertExists(release.id, "Release should have an id");
      assertExists(release.version, "Release should have a version");
    });
  });

  describe("createDeployment", () => {
    it("should create deployment with valid release and environment", async () => {
      assertExists(testReleaseId, "Test release should exist from previous test");

      const env = await controlPlane.getEnvironment(ctx.projectSlug, "production");
      assertExists(env, "Production environment should exist");

      const deployment = await controlPlane.createDeployment(ctx.projectSlug, {
        releaseId: testReleaseId,
        environmentId: env.id,
      });

      assertExists(deployment, "Deployment should be created");
      assertExists(deployment.id, "Deployment should have an id");
      assertEquals(deployment.releaseId, testReleaseId);
      assertEquals(deployment.environmentId, env.id);
    });
  });
});
