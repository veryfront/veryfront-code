import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  API_KEYS_URL,
  CONFIG_DIR_NAME,
  DEFAULT_API_URL,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_LOGIN_TIMEOUT_MS,
  getApiUrl,
  MAX_PORT_ATTEMPTS,
  TOKEN_FILE_NAME,
  TOKEN_FILE_PERMISSIONS,
} from "./constants.ts";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";

describe("cli/shared/constants", () => {
  describe("exported constants", () => {
    it("should have correct DEFAULT_API_URL", () => {
      assertEquals(DEFAULT_API_URL, "https://api.veryfront.com");
    });

    it("should have numeric DEFAULT_CALLBACK_PORT", () => {
      assertEquals(typeof DEFAULT_CALLBACK_PORT, "number");
      assertEquals(DEFAULT_CALLBACK_PORT, 9876);
    });

    it("should have DEFAULT_LOGIN_TIMEOUT_MS of 120 seconds", () => {
      assertEquals(DEFAULT_LOGIN_TIMEOUT_MS, 120000);
    });

    it("should have MAX_PORT_ATTEMPTS", () => {
      assertEquals(MAX_PORT_ATTEMPTS, 100);
    });

    it("should have TOKEN_FILE_PERMISSIONS for owner read/write only", () => {
      assertEquals(TOKEN_FILE_PERMISSIONS, 0o600);
    });

    it("should have CONFIG_DIR_NAME", () => {
      assertEquals(CONFIG_DIR_NAME, "veryfront");
    });

    it("should have TOKEN_FILE_NAME", () => {
      assertEquals(TOKEN_FILE_NAME, "token");
    });
  });

  describe("API_KEYS_URL", () => {
    // Regression: the token prompts printed veryfront.com/settings/api-keys,
    // which 301-redirects to veryfront.com/account/api-keys.
    it("points at the current dashboard API keys page", () => {
      assertEquals(API_KEYS_URL, "veryfront.com/account/api-keys");
    });

    it("is the only API keys URL cited by the interactive token prompts", async () => {
      const promptSources = ["../auth/login.ts", "../commands/demo/demo.ts"];

      for (const source of promptSources) {
        const contents = await readTextFile(
          new URL(source, import.meta.url).pathname,
        );

        assertStringIncludes(
          contents,
          "You can get a token from ",
          `${source} should still print the API token hint`,
        );
        assertEquals(
          contents.includes("veryfront.com/settings/api-keys"),
          false,
          `${source} must not cite the redirecting veryfront.com/settings/api-keys path`,
        );
      }
    });
  });

  describe("getApiUrl", () => {
    it("should return default API URL when env has no override", () => {
      const env = {} as EnvironmentConfig;
      assertEquals(getApiUrl(env), DEFAULT_API_URL);
    });

    it("should return custom API URL from env", () => {
      const env = { apiUrl: "http://localhost:4000" } as EnvironmentConfig;
      assertEquals(getApiUrl(env), "http://localhost:4000");
    });

    it("should prefer env apiUrl over default", () => {
      const env = { apiUrl: "https://custom.api.com" } as EnvironmentConfig;
      assertEquals(getApiUrl(env), "https://custom.api.com");
    });

    it("should fall back to env apiBaseUrl when apiUrl is unset", () => {
      const env = { apiBaseUrl: "https://api.veryfront.org" } as EnvironmentConfig;
      assertEquals(getApiUrl(env), "https://api.veryfront.org");
    });

    it("should prefer env apiUrl over apiBaseUrl", () => {
      const env = {
        apiUrl: "https://custom.api.com",
        apiBaseUrl: "https://api.veryfront.org",
      } as EnvironmentConfig;
      assertEquals(getApiUrl(env), "https://custom.api.com");
    });
  });
});
