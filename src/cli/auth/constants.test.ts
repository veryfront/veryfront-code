import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CONFIG_DIR_NAME,
  DEFAULT_API_URL,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_LOGIN_TIMEOUT_MS,
  getApiUrl,
  MAX_PORT_ATTEMPTS,
  TOKEN_FILE_NAME,
  TOKEN_FILE_PERMISSIONS,
} from "./constants.ts";
import type { RuntimeEnv } from "#veryfront/config/runtime-env.ts";

describe("cli/auth/constants", () => {
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

  describe("getApiUrl", () => {
    it("should return default API URL when env has no override", () => {
      const env = {} as RuntimeEnv;
      assertEquals(getApiUrl(env), "https://api.veryfront.com");
    });

    it("should return custom API URL from env", () => {
      const env = { apiUrl: "http://localhost:4000" } as RuntimeEnv;
      assertEquals(getApiUrl(env), "http://localhost:4000");
    });

    it("should prefer env apiUrl over default", () => {
      const env = { apiUrl: "https://custom.api.com" } as RuntimeEnv;
      assertEquals(getApiUrl(env), "https://custom.api.com");
    });
  });
});
