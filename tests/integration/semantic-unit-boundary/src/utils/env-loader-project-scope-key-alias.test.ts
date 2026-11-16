/**
 * The `VERYFRONT_API_KEY` alias and project environment scopes.
 *
 * Copying the key into `VERYFRONT_API_TOKEN` is a host-process rule. An
 * installed HTTP application bootstraps inside `runWithTrustedProjectEnv`, so
 * an env load there reads the project's own variables: the project's key is
 * project data and must never become the token the framework caches as its
 * control-plane credential, nor settle the host process's alias. Proving that
 * needs a real env load in a temp directory, a project scope, and the
 * process-wide environment config cache, so it lives in the semantic
 * integration suite.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";
import { deleteEnv, getEnv, setEnv, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { runWithTrustedProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { __resetEnvLoaderForTests, loadEnv, markEnvLoaded } from "#veryfront/utils/env-loader.ts";

const ENV_KEYS = ["VERYFRONT_API_KEY", "VERYFRONT_API_TOKEN", "VERYFRONT_API_TOKEN_FILE"] as const;

function clearHostCredentials(): void {
  for (const key of ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

describe("env-loader key alias in project environment scopes", () => {
  afterEach(() => {
    clearHostCredentials();
    __resetEnvLoaderForTests();
    refreshEnvironmentConfig();
  });

  it("leaves the token slot and cached apiToken unset when a scoped bootstrap load sees only a project key", async () => {
    clearHostCredentials();
    __resetEnvLoaderForTests();

    const scoped = await withTempDir((dir) =>
      runWithTrustedProjectEnv(
        { VERYFRONT_API_KEY: "project-key" },
        { projectSlug: "installed-project" },
        async () => {
          // What bootstrapProd's ensureEnvLoaded does inside the scope.
          await loadEnv({ cwd: dir });
          const config = refreshEnvironmentConfig();
          markEnvLoaded();
          return { token: getEnv("VERYFRONT_API_TOKEN"), apiToken: config.apiToken };
        },
      )
    );

    assertEquals(scoped, { token: undefined, apiToken: undefined });
    assertEquals(refreshEnvironmentConfig().apiToken, undefined);
    assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), undefined);

    // The scoped load did not settle the host alias: a host key set afterwards
    // still reaches the token slot the way it does in an unloaded process.
    setEnv("VERYFRONT_API_KEY", "host-key");
    assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "host-key");
  });

  it("still copies the host process's key into the token slot outside a project scope", async () => {
    clearHostCredentials();
    __resetEnvLoaderForTests();
    setEnv("VERYFRONT_API_KEY", "host-key");

    await withTempDir((dir) => loadEnv({ cwd: dir }));

    assertEquals(getEnv("VERYFRONT_API_TOKEN"), "host-key");
    assertEquals(refreshEnvironmentConfig().apiToken, "host-key");
  });
});
