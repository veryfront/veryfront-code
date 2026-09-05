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
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
import {
  __resetEnvLoaderForTests,
  loadEnv,
  markEnvFileSource,
  markProcessEnvSource,
} from "#veryfront/utils/env-loader.ts";
import {
  requireHostPrivateApiHttps,
  resolveHostOwnedApiBaseUrl,
} from "../../../../../src/config/host-api-base.ts";

describe("host API base", () => {
  it("rejects cleartext host API endpoints even with internal egress enabled", () => {
    const keys = [
      "VERYFRONT_API_URL",
      "VERYFRONT_API_BASE_URL",
      "VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS",
    ];
    const originals = keys.map(getEnv);
    try {
      setEnv("VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS", "1");
      for (const key of ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL"]) {
        deleteEnv("VERYFRONT_API_URL");
        deleteEnv("VERYFRONT_API_BASE_URL");
        setEnv(key, "http://api.example.test/api");
        assertThrows(
          () => requireHostPrivateApiHttps(resolveHostOwnedApiBaseUrl()),
          Error,
          "HTTPS",
        );
      }
    } finally {
      keys.forEach((key, index) => {
        const original = originals[index];
        if (original === undefined) deleteEnv(key);
        else setEnv(key, original);
      });
    }
  });

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

  it("preserves API URL precedence over API base URL", () => {
    const originalBase = getEnv("VERYFRONT_API_BASE_URL");
    const originalUrl = getEnv("VERYFRONT_API_URL");
    try {
      setEnv("VERYFRONT_API_URL", "https://preferred.example/graphql");
      setEnv("VERYFRONT_API_BASE_URL", "https://fallback.example/api");
      assertEquals(resolveHostOwnedApiBaseUrl(), "https://preferred.example/api");
    } finally {
      if (originalBase === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
      else setEnv("VERYFRONT_API_BASE_URL", originalBase);
      if (originalUrl === undefined) deleteEnv("VERYFRONT_API_URL");
      else setEnv("VERYFRONT_API_URL", originalUrl);
    }
  });

  it("tracks derived env-file API base provenance when a stored login is registered", () => {
    const originalBase = getEnv("VERYFRONT_API_BASE_URL");
    try {
      setEnv("VERYFRONT_API_BASE_URL", "https://project-controlled.example/api");
      markEnvFileSource("VERYFRONT_API_BASE_URL", ".env");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

      assertEquals(resolveHostOwnedApiBaseUrl(), "https://api.veryfront.com");

      deleteHostSecret("VERYFRONT_API_TOKEN");
      markProcessEnvSource("VERYFRONT_API_BASE_URL");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      assertEquals(
        resolveHostOwnedApiBaseUrl(),
        "https://project-controlled.example/api",
      );
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
      __resetEnvLoaderForTests();
      if (originalBase === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
      else setEnv("VERYFRONT_API_BASE_URL", originalBase);
    }
  });

  it("rewrites only a terminal GraphQL API path", () => {
    const originalBase = getEnv("VERYFRONT_API_BASE_URL");
    const originalUrl = getEnv("VERYFRONT_API_URL");
    try {
      deleteEnv("VERYFRONT_API_BASE_URL");
      setEnv("VERYFRONT_API_URL", "https://graphql.example/graphql/");
      assertEquals(resolveHostOwnedApiBaseUrl(), "https://graphql.example/api");

      setEnv("VERYFRONT_API_URL", "https://graphql.example/graphql/v2/");
      assertEquals(resolveHostOwnedApiBaseUrl(), "https://graphql.example/graphql/v2");

      deleteEnv("VERYFRONT_API_URL");
      setEnv("VERYFRONT_API_BASE_URL", "https://api.example/api///");
      assertEquals(resolveHostOwnedApiBaseUrl(), "https://api.example/api");
    } finally {
      if (originalBase === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
      else setEnv("VERYFRONT_API_BASE_URL", originalBase);
      if (originalUrl === undefined) deleteEnv("VERYFRONT_API_URL");
      else setEnv("VERYFRONT_API_URL", originalUrl);
    }
  });
});
