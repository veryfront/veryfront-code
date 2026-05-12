import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for shared config
 * @module cli/shared/config.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveConfig, resolveConfigWithAuth } from "./config.ts";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { join } from "veryfront/platform/path";

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

  it("uses tenant project context when explicit project slug is absent", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");

    try {
      Deno.env.set("TENANT_PROJECT_SLUG", "tenant-project");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth("/tmp/test-dir", env);

      assertEquals(config.projectSlug, "tenant-project");
    } finally {
      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });

  it("prefers repo config projectSlug over tenant fallback", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");
    const tempDir = await Deno.makeTempDir();

    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "repo-config-project" }),
      );
      Deno.env.set("TENANT_PROJECT_SLUG", "tenant-project");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth(tempDir, env);

      assertEquals(config.projectSlug, "repo-config-project");
    } finally {
      await Deno.remove(tempDir, { recursive: true });

      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });

  it("uses tenant project id when no project slug is available", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");

    try {
      Deno.env.delete("TENANT_PROJECT_SLUG");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth("/tmp/test-dir", env);

      assertEquals(config.projectSlug, "tenant-project-id");
    } finally {
      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });
});
