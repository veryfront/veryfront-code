import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  _resetEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { __resetEnvLoaderForTests, markEnvLoaded } from "#veryfront/utils/env-loader.ts";
import { withTempDir, writeFile, writeTextFile } from "#veryfront/testing/deno-compat.ts";

const CREDENTIAL_ENV_KEYS = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_TOKEN_FILE"] as const;

function clearCredentialEnv(): void {
  for (const key of CREDENTIAL_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // Environment variable was already absent.
    }
  }
}

describe("renewable runtime credential files", () => {
  afterEach(() => {
    clearCredentialEnv();
    __resetEnvLoaderForTests();
    _resetEnvironmentConfig();
  });

  it("rereads the credential file instead of retaining the launch token", async () => {
    await withTempDir(async (root) => {
      const path = `${root}/token`;
      await writeTextFile(path, "first-run-token\n");
      setEnv("VERYFRONT_API_TOKEN", "expired-environment-token");
      setEnv("VERYFRONT_API_TOKEN_FILE", path);
      assertEquals(getVeryfrontCloudAuthToken(), "first-run-token");

      await writeTextFile(path, "renewed-run-token\n");
      assertEquals(getVeryfrontCloudAuthToken(), "renewed-run-token");

      markEnvLoaded();
      _resetEnvironmentConfig();
      assertEquals(refreshEnvironmentConfig().apiToken, "renewed-run-token");
    }, { prefix: "vf-runtime-credential-" });
  });

  it("fails closed for an empty or missing configured credential file", () => {
    setEnv("VERYFRONT_API_TOKEN", "legacy-token-must-not-win");
    setEnv("VERYFRONT_API_TOKEN_FILE", "");
    assertThrows(() => getVeryfrontCloudAuthToken(), TypeError, "path is empty");

    setEnv("VERYFRONT_API_TOKEN_FILE", "/missing/veryfront-runtime-credential");
    assertThrows(() => getVeryfrontCloudAuthToken(), Error);
  });

  it("rejects empty, malformed UTF-8, and oversized credential contents", async () => {
    await withTempDir(async (root) => {
      const path = `${root}/token`;
      setEnv("VERYFRONT_API_TOKEN", "legacy-token-must-not-win");
      setEnv("VERYFRONT_API_TOKEN_FILE", path);

      await writeTextFile(path, "");
      assertThrows(() => getVeryfrontCloudAuthToken(), TypeError, "file is empty");

      await writeFile(path, new Uint8Array([0xff]));
      assertThrows(() => getVeryfrontCloudAuthToken(), TypeError);

      await writeFile(path, new Uint8Array(65_537));
      assertThrows(() => getVeryfrontCloudAuthToken(), RangeError, "size limit");
    }, { prefix: "vf-runtime-credential-invalid-" });
  });
});
