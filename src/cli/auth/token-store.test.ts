import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import {
  createTestEnvironmentConfig,
  type EnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { deleteToken, getTokenLocation, readToken, saveToken } from "./token-store.ts";

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
});
