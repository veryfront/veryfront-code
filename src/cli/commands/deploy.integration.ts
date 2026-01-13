/**
 * Integration tests for deploy command
 * These tests require a real API connection and valid credentials.
 * Run with: deno task test:integration src/cli/commands/deploy.integration.ts
 *
 * WARNING: These tests may create real releases and deployments.
 * Use with caution in production environments.
 *
 * @module cli/commands/deploy.integration
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it, beforeAll, afterAll } from "jsr:@std/testing@1/bdd";
import { createApiClient, resolveConfig, type ApiClient } from "../shared/config.ts";
import { getEnvironmentByName, createRelease, createDeployment } from "./deploy.ts";

// Skip integration tests if no API token
const API_TOKEN = Deno.env.get("VERYFRONT_API_TOKEN");
const PROJECT_SLUG = Deno.env.get("VERYFRONT_PROJECT_SLUG");

// Helper to skip tests when no credentials
function skipIfNoCredentials() {
  if (!API_TOKEN || !PROJECT_SLUG) {
    console.log("Skipping integration tests: VERYFRONT_API_TOKEN or VERYFRONT_PROJECT_SLUG not set");
    return true;
  }
  return false;
}

describe("deploy command integration", () => {
  let client: ApiClient;
  let projectSlug: string;
  let testReleaseId: string | null = null;

  beforeAll(async () => {
    if (skipIfNoCredentials()) return;

    const config = await resolveConfig(Deno.cwd());
    client = createApiClient(config);
    projectSlug = config.projectSlug;
  });

  afterAll(async () => {
    // Note: Releases typically can't be deleted, so we just log for reference
    if (testReleaseId) {
      console.log(`Test release created: ${testReleaseId}`);
    }
  });

  describe("getEnvironmentByName", () => {
    it("should list environments", async () => {
      if (skipIfNoCredentials()) return;

      // Test that we can list environments
      const response = await client.get<{ data: unknown[] }>(
        `/projects/${projectSlug}/environments`,
      );

      assertExists(response);
      assertEquals(Array.isArray(response.data), true);
    });

    it("should find production environment", async () => {
      if (skipIfNoCredentials()) return;

      const env = await getEnvironmentByName(client, projectSlug, "production");

      // Production environment should exist in most projects
      if (env) {
        assertExists(env.id);
        assertEquals(env.name, "production");
      }
    });

    it("should return null for nonexistent environment", async () => {
      if (skipIfNoCredentials()) return;

      const env = await getEnvironmentByName(client, projectSlug, "nonexistent-env-12345");

      assertEquals(env, null);
    });
  });

  describe("createRelease", () => {
    it("should create a release", async () => {
      if (skipIfNoCredentials()) return;

      const releaseName = `test-release-${Date.now()}`;
      const release = await createRelease(client, projectSlug, releaseName);

      assertExists(release);
      assertExists(release.id);
      assertExists(release.version);

      // Store for reference
      testReleaseId = release.id;
    });

    it("should create release without custom name", async () => {
      if (skipIfNoCredentials()) return;

      const release = await createRelease(client, projectSlug);

      assertExists(release);
      assertExists(release.id);
      assertExists(release.version);
    });
  });

  describe("createDeployment", () => {
    it("should create deployment with valid release and environment", async () => {
      if (skipIfNoCredentials()) return;
      if (!testReleaseId) return;

      // Get production environment
      const env = await getEnvironmentByName(client, projectSlug, "production");
      if (!env) {
        console.log("Skipping: production environment not found");
        return;
      }

      const deployment = await createDeployment(client, projectSlug, testReleaseId, env.id);

      assertExists(deployment);
      assertExists(deployment.id);
      assertEquals(deployment.release_id, testReleaseId);
      assertEquals(deployment.environment_id, env.id);
    });
  });
});
