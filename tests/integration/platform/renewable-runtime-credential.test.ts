import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { markEnvFileValue } from "#veryfront/platform/compat/process/env.ts";
import {
  _resetEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import {
  getVeryfrontCloudAuthToken,
  getVeryfrontCloudBootstrap,
  getVeryfrontCloudHostBootstrap,
} from "#veryfront/platform/cloud/resolver.ts";
import { __resetEnvLoaderForTests, markEnvLoaded } from "#veryfront/utils/env-loader.ts";
import { withTempDir, writeFile, writeTextFile } from "#veryfront/testing/deno-compat.ts";

const CREDENTIAL_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_TOKEN_FILE",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_URL",
] as const;

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
      assertEquals(getVeryfrontCloudHostBootstrap().apiToken, "first-run-token");

      await writeTextFile(path, "renewed-run-token\n");
      assertEquals(getVeryfrontCloudAuthToken(), "renewed-run-token");
      assertEquals(getVeryfrontCloudHostBootstrap().apiToken, "renewed-run-token");

      markEnvLoaded();
      _resetEnvironmentConfig();
      assertEquals(refreshEnvironmentConfig().apiToken, "renewed-run-token");
    }, { prefix: "vf-runtime-credential-" });
  });

  it("fails closed for an empty or missing configured credential file", () => {
    setEnv("VERYFRONT_API_TOKEN", "legacy-token-must-not-win");
    setEnv("VERYFRONT_API_TOKEN_FILE", "");
    assertThrows(() => getVeryfrontCloudAuthToken(), TypeError, "path is empty");
    assertThrows(() => getVeryfrontCloudHostBootstrap(), TypeError, "path is empty");

    setEnv("VERYFRONT_API_TOKEN_FILE", "/missing/veryfront-runtime-credential");
    assertThrows(() => getVeryfrontCloudAuthToken(), Error);
    assertThrows(() => getVeryfrontCloudHostBootstrap(), Error);
  });

  it("does not send a runtime file credential to a project env-file origin", async () => {
    await withTempDir(async (root) => {
      const path = `${root}/token`;
      await writeTextFile(path, "runtime-token\n");
      setEnv("VERYFRONT_API_TOKEN_FILE", path);
      setEnv("VERYFRONT_API_URL", "https://project-api.example");
      markEnvFileValue("VERYFRONT_API_URL");

      assertEquals(getVeryfrontCloudBootstrap().apiToken, "runtime-token");
      assertEquals(getVeryfrontCloudBootstrap().apiBaseUrl, "https://api.veryfront.com");
      assertEquals(getVeryfrontCloudHostBootstrap().apiToken, "runtime-token");
      assertEquals(getVeryfrontCloudHostBootstrap().apiBaseUrl, "https://api.veryfront.com");
    }, { prefix: "vf-runtime-credential-origin-" });
  });

  it("preserves host API base URL precedence for runtime file credentials", async () => {
    await withTempDir(async (root) => {
      const path = `${root}/token`;
      await writeTextFile(path, "runtime-token\n");
      setEnv("VERYFRONT_API_TOKEN_FILE", path);
      setEnv("VERYFRONT_API_BASE_URL", "https://host-base.example/graphql");
      setEnv("VERYFRONT_API_URL", "https://host-url.example");

      assertEquals(getVeryfrontCloudBootstrap().apiBaseUrl, "https://host-base.example/api");
      assertEquals(getVeryfrontCloudHostBootstrap().apiBaseUrl, "https://host-base.example/api");
    }, { prefix: "vf-runtime-credential-precedence-" });
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
