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
  deleteTokenRejectedBy,
  getTokenLocation,
  isTokenSavedForOtherApi,
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

  describe("deleteTokenRejectedBy", () => {
    const PROD = "https://api.prod.example.test/api";
    const STAGING = "https://api.staging.example.test/api";

    it("keeps a login saved for a different API", async () => {
      await saveToken(testToken, { ...testEnv, apiUrl: PROD });

      assertEquals(await deleteTokenRejectedBy(STAGING, testEnv), false);
      assertEquals(await readToken(testEnv), testToken);
    });

    it("removes a login the API it was saved for rejects", async () => {
      await saveToken(testToken, { ...testEnv, apiUrl: PROD });

      assertEquals(
        await deleteTokenRejectedBy("https://API.prod.example.test:443/api/", testEnv),
        true,
      );
      assertEquals(await readToken(testEnv), null);
    });

    it("removes a login saved before its API was recorded", async () => {
      await saveToken(testToken, { ...testEnv, apiUrl: PROD });
      await Deno.remove(getTokenLocation(testEnv).replace(/token$/, "token-api.json"));

      assertEquals(await deleteTokenRejectedBy(STAGING, testEnv), true);
      assertEquals(await readToken(testEnv), null);
    });

    it("forgets the recorded API on logout", async () => {
      await saveToken(testToken, { ...testEnv, apiUrl: PROD });
      await deleteToken(testEnv);
      await Deno.writeTextFile(getTokenLocation(testEnv), `${testToken}\n`);

      assertEquals(await deleteTokenRejectedBy(STAGING, testEnv), true);
    });

    it("names the login in its record by SHA-256, never by the token itself", async () => {
      const recordPath = getTokenLocation(testEnv).replace(/token$/, "token-api.json");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(testToken));
      const tokenSha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      await saveToken(testToken, { ...testEnv, apiUrl: PROD });

      await Deno.writeTextFile(recordPath, JSON.stringify({ apiUrl: PROD, tokenSha256 }));
      assertEquals(await deleteTokenRejectedBy(STAGING, testEnv), false);

      await Deno.writeTextFile(
        recordPath,
        JSON.stringify({ apiUrl: PROD, tokenSha256: testToken }),
      );
      assertEquals(await deleteTokenRejectedBy(STAGING, testEnv), true);
    });

    it("treats a record describing a replaced login as unrecorded", async () => {
      // An older CLI, or a concurrent login, rewrites the token without
      // touching the record, which then describes a login that is gone.
      await saveToken(testToken, { ...testEnv, apiUrl: PROD });
      await Deno.writeTextFile(getTokenLocation(testEnv), "replaced-token\n");

      assertEquals(await isTokenSavedForOtherApi("replaced-token", STAGING, testEnv), false);
      assertEquals(await deleteTokenRejectedBy(STAGING, testEnv), true);
      assertEquals(await readToken(testEnv), null);
    });

    it("treats a record without a fingerprint as unrecorded", async () => {
      await saveToken(testToken, { ...testEnv, apiUrl: PROD });
      await Deno.writeTextFile(
        getTokenLocation(testEnv).replace(/token$/, "token-api.json"),
        JSON.stringify({ apiUrl: PROD }),
      );

      assertEquals(await isTokenSavedForOtherApi(testToken, STAGING, testEnv), false);
      assertEquals(await deleteTokenRejectedBy(STAGING, testEnv), true);
      assertEquals(await readToken(testEnv), null);
    });

    it("says whether a login was saved for a different API", async () => {
      await saveToken(testToken, { ...testEnv, apiUrl: PROD });

      assertEquals(await isTokenSavedForOtherApi(testToken, STAGING, testEnv), true);
      assertEquals(await isTokenSavedForOtherApi(testToken, `${PROD}/`, testEnv), false);
      assertEquals(await isTokenSavedForOtherApi("other-token", STAGING, testEnv), false);
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

    it("forgets an accepted login on logout even when the token cannot be removed", async () => {
      // A non-empty directory where the token file belongs makes its removal fail.
      const tokenPath = getTokenLocation(testEnv);
      await Deno.mkdir(tokenPath, { recursive: true });
      await Deno.writeTextFile(`${tokenPath}/blocker`, "");
      await rememberAcceptedLogin(API_URL, "login-g", testEnv, NOW);

      try {
        await deleteToken(testEnv);

        assertEquals(await wasLoginAcceptedRecently(API_URL, "login-g", testEnv, NOW), false);
      } finally {
        await Deno.remove(tokenPath, { recursive: true });
      }
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
