/**
 * Host-owned API base resolution.
 *
 * These cases mutate the process environment and write a project `.env` to
 * disk to prove that neither a project-supplied value nor the wrong precedence
 * can steer a request carrying a host-private stored login token. Both are
 * process-global effects, so this lives in the semantic integration suite
 * rather than beside the module.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import {
  resolveHostOwnedApiBaseUrl,
  resolveHostOwnedCliApiUrl,
} from "../../../../../src/config/host-api-base.ts";

describe("host API base", () => {
  it("does not trust an API base copied from a project env file", async () => {
    const originalBase = getEnv("VERYFRONT_API_BASE_URL");
    const originalUrl = getEnv("VERYFRONT_API_URL");
    try {
      deleteEnv("VERYFRONT_API_BASE_URL");
      deleteEnv("VERYFRONT_API_URL");
      __resetEnvLoaderForTests();
      await withTempDir(async (dir) => {
        await writeTextFile(
          `${dir}/.env`,
          "VERYFRONT_API_BASE_URL=https://project-controlled.example/api\n",
        );
        await loadEnv({ cwd: dir });

        assertEquals(resolveHostOwnedApiBaseUrl(), "https://api.veryfront.com");
      });
    } finally {
      __resetEnvLoaderForTests();
      if (originalBase === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
      else setEnv("VERYFRONT_API_BASE_URL", originalBase);
      if (originalUrl === undefined) deleteEnv("VERYFRONT_API_URL");
      else setEnv("VERYFRONT_API_URL", originalUrl);
    }
  });

  it("keeps VERYFRONT_API_URL ahead of VERYFRONT_API_BASE_URL for CLI callers", () => {
    const originalBase = getEnv("VERYFRONT_API_BASE_URL");
    const originalUrl = getEnv("VERYFRONT_API_URL");
    try {
      setEnv("VERYFRONT_API_BASE_URL", "https://base.example.com");
      setEnv("VERYFRONT_API_URL", "https://api-url.example.com");

      // `resolveCliApiUrl()` in cli/shared/constants.ts gives VERYFRONT_API_URL
      // precedence, and the CLI preload has to keep following it when the
      // credential comes from the token store.
      assertEquals(resolveHostOwnedCliApiUrl(), "https://api-url.example.com");
      // The REST API base keeps the EnvironmentConfig ordering it mirrors.
      assertEquals(resolveHostOwnedApiBaseUrl(), "https://base.example.com");

      deleteEnv("VERYFRONT_API_URL");
      assertEquals(resolveHostOwnedCliApiUrl(), "https://base.example.com");
    } finally {
      if (originalBase === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
      else setEnv("VERYFRONT_API_BASE_URL", originalBase);
      if (originalUrl === undefined) deleteEnv("VERYFRONT_API_URL");
      else setEnv("VERYFRONT_API_URL", originalUrl);
    }
  });

  it("treats blank host API URLs as unset", () => {
    const originalBase = getEnv("VERYFRONT_API_BASE_URL");
    const originalUrl = getEnv("VERYFRONT_API_URL");
    try {
      setEnv("VERYFRONT_API_BASE_URL", "   ");
      setEnv("VERYFRONT_API_URL", "\t");
      assertEquals(resolveHostOwnedApiBaseUrl(), "https://api.veryfront.com");
    } finally {
      if (originalBase === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
      else setEnv("VERYFRONT_API_BASE_URL", originalBase);
      if (originalUrl === undefined) deleteEnv("VERYFRONT_API_URL");
      else setEnv("VERYFRONT_API_URL", originalUrl);
    }
  });
});
