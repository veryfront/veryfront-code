import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import {
  createTestEnvironmentConfig,
  type EnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import {
  deleteToken,
  getTokenLocation,
  LOGIN_CHECK_TTL_MS,
  readToken,
  rememberAcceptedLogin,
  saveToken,
  wasLoginAcceptedRecently,
} from "./token-store.ts";

describe("Token Store", () => {
  const testToken = "test-token-12345";
  let tempDir = "";
  let testEnv: EnvironmentConfig;

  async function safeDeleteToken(): Promise<void> {
    try {
      await deleteToken(testEnv);
    } catch {
      // Ignore if token doesn't exist
    }
  }

  beforeAll(async () => {
    tempDir = await makeTempDir({ prefix: "token-store-test-" });
    // Create isolated EnvironmentConfig for this test - avoids global state conflicts
    testEnv = createTestEnvironmentConfig({
      xdgConfigHome: tempDir,
      homeDir: tempDir,
    });
  });

  beforeEach(async () => {
    await safeDeleteToken();
  });

  afterAll(async () => {
    await safeDeleteToken();
    await remove(tempDir, { recursive: true });
  });

  describe("getTokenLocation", () => {
    it("should return a valid token path", () => {
      const tokenPath = getTokenLocation(testEnv);
      assertExists(tokenPath);
      assertEquals(tokenPath.includes("veryfront"), true);
      assertEquals(tokenPath.endsWith("token"), true);
    });
  });

  describe("saveToken", () => {
    it("should save a token successfully", async () => {
      await saveToken(testToken, testEnv);
      const savedToken = await readToken(testEnv);
      assertEquals(savedToken, testToken);
    });

    it("should overwrite existing token", async () => {
      await saveToken("old-token", testEnv);
      await saveToken("new-token", testEnv);
      const savedToken = await readToken(testEnv);
      assertEquals(savedToken, "new-token");
    });
  });

  describe("readToken", () => {
    it("should return null when no token exists", async () => {
      const token = await readToken(testEnv);
      assertEquals(token, null);
    });

    it("should read a saved token", async () => {
      await saveToken(testToken, testEnv);
      const token = await readToken(testEnv);
      assertEquals(token, testToken);
    });

    it("should trim whitespace from token", async () => {
      await saveToken("  token-with-spaces  \n", testEnv);
      const token = await readToken(testEnv);
      assertEquals(token, "token-with-spaces");
    });
  });

  describe("deleteToken", () => {
    it("should delete an existing token", async () => {
      await saveToken(testToken, testEnv);
      await deleteToken(testEnv);
      const token = await readToken(testEnv);
      assertEquals(token, null);
    });

    it("should not throw when deleting non-existent token", async () => {
      await deleteToken(testEnv);
    });
  });

  describe("accepted login check", () => {
    const API_URL = "https://api.example.test";
    const NOW = 1_800_000_000_000;

    it("trusts a login the API accepted within the TTL", async () => {
      await rememberAcceptedLogin(API_URL, "login-a", testEnv, NOW);

      assertEquals(await wasLoginAcceptedRecently(API_URL, "login-a", testEnv, NOW + 1_000), true);
    });

    it("checks a login again once the TTL has passed", async () => {
      await rememberAcceptedLogin(API_URL, "login-b", testEnv, NOW);

      assertEquals(
        await wasLoginAcceptedRecently(API_URL, "login-b", testEnv, NOW + LOGIN_CHECK_TTL_MS),
        false,
      );
    });

    it("checks again when the remembered time is in the future", async () => {
      // A clock moved back must not stretch the TTL.
      await rememberAcceptedLogin(API_URL, "login-e", testEnv, NOW);

      assertEquals(await wasLoginAcceptedRecently(API_URL, "login-e", testEnv, NOW - 1), false);
    });

    it("forgets an accepted login on logout", async () => {
      await rememberAcceptedLogin(API_URL, "login-f", testEnv, NOW);

      await deleteToken(testEnv);

      assertEquals(await wasLoginAcceptedRecently(API_URL, "login-f", testEnv, NOW), false);
    });

    it("does not carry an acceptance over to another login or API", async () => {
      await rememberAcceptedLogin(API_URL, "login-c", testEnv, NOW);

      assertEquals(await wasLoginAcceptedRecently(API_URL, "login-d", testEnv, NOW), false);
      assertEquals(
        await wasLoginAcceptedRecently("https://other.example.test", "login-c", testEnv, NOW),
        false,
      );
    });
  });
});
