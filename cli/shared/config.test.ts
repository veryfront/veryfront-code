/**
 * Unit tests for shared config
 * @module cli/shared/config.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveConfig, resolveConfigWithAuth } from "./config.ts";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";

function createMockEnv(overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig {
  return {
    apiUrl: overrides.apiUrl,
    apiToken: overrides.apiToken,
    projectSlug: overrides.projectSlug,
    isDev: false,
    isProduction: true,
    ...overrides,
  } as EnvironmentConfig;
}

describe("resolveConfig", () => {
  it("should throw when no token is available", async () => {
    const env = createMockEnv({ projectSlug: "test-project" });

    await assertRejects(
      () => resolveConfig("/tmp/test-dir", env),
      Error,
      "Missing API token",
    );
  });

  it("should use token from environment", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiToken, "env-token");
    assertEquals(config.projectSlug, "test-project");
  });

  it("should use default API URL", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://api.veryfront.com");
  });

  it("should use custom API URL from environment", async () => {
    const env = createMockEnv({
      apiUrl: "https://custom.api.com",
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://custom.api.com");
  });
});

describe("resolveConfigWithAuth", () => {
  it("should use token from environment without prompting", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfigWithAuth("/tmp/test-dir", env);

    assertEquals(config.apiToken, "env-token");
    assertEquals(config.projectSlug, "test-project");
  });

  it("should throw when auth fails in non-TTY", async () => {
    // In non-TTY mode without a token, ensureAuthenticated returns null
    const env = createMockEnv({ projectSlug: "test-project" });

    await assertRejects(
      () => resolveConfigWithAuth("/tmp/test-dir", env),
      Error,
      "Authentication required",
    );
  });

  it("should use default API URL", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfigWithAuth("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://api.veryfront.com");
  });
});
