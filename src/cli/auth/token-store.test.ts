/**
 * Token Store Tests
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "#veryfront/testing/bdd.ts";
import { deleteToken, getTokenLocation, readToken, saveToken } from "./token-store.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";

describe("Token Store", () => {
  const testToken = "test-token-12345";
  let tempDir: string;
  let originalXdgConfig: string | undefined;

  beforeAll(async () => {
    // Create isolated temp directory for this test file
    tempDir = await makeTempDir({ prefix: "token-store-test-" });
    // Save original XDG_CONFIG_HOME for per-test restore
    originalXdgConfig = getEnv("XDG_CONFIG_HOME");
  });

  beforeEach(async () => {
    // Isolate config home per test to avoid cross-test env clashes
    setEnv("XDG_CONFIG_HOME", tempDir);
    // Clean up any existing token before each test
    try {
      await deleteToken();
    } catch {
      // Ignore if token doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await deleteToken();
    } catch {
      // Ignore if token doesn't exist
    }
    // Restore original XDG_CONFIG_HOME
    if (originalXdgConfig !== undefined) {
      setEnv("XDG_CONFIG_HOME", originalXdgConfig);
    } else {
      deleteEnv("XDG_CONFIG_HOME");
    }
  });

  afterAll(async () => {
    // Clean up temp directory
    await remove(tempDir, { recursive: true });
  });

  describe("getTokenLocation", () => {
    it("should return a valid token path", () => {
      const tokenPath = getTokenLocation();
      assertExists(tokenPath);
      assertEquals(tokenPath.includes("veryfront"), true);
      assertEquals(tokenPath.endsWith("token"), true);
    });
  });

  describe("saveToken", () => {
    it("should save a token successfully", async () => {
      await saveToken(testToken);
      const savedToken = await readToken();
      assertEquals(savedToken, testToken);
    });

    it("should overwrite existing token", async () => {
      await saveToken("old-token");
      await saveToken("new-token");
      const savedToken = await readToken();
      assertEquals(savedToken, "new-token");
    });
  });

  describe("readToken", () => {
    it("should return null when no token exists", async () => {
      const token = await readToken();
      assertEquals(token, null);
    });

    it("should read a saved token", async () => {
      await saveToken(testToken);
      const token = await readToken();
      assertEquals(token, testToken);
    });

    it("should trim whitespace from token", async () => {
      await saveToken("  token-with-spaces  \n");
      const token = await readToken();
      assertEquals(token, "token-with-spaces");
    });
  });

  describe("deleteToken", () => {
    it("should delete an existing token", async () => {
      await saveToken(testToken);
      await deleteToken();
      const token = await readToken();
      assertEquals(token, null);
    });

    it("should not throw when deleting non-existent token", async () => {
      // Should not throw
      await deleteToken();
    });
  });
});
