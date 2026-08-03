import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import {
  createTestEnvironmentConfig,
  type EnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import {
  deleteProviderToken,
  listProviderTokens,
  type ProviderCredential,
  type ProviderName,
  readProviderToken,
  saveProviderToken,
} from "./provider-store.ts";

describe("Provider Store", () => {
  let tempDir = "";
  let testEnv: EnvironmentConfig;

  beforeAll(async () => {
    tempDir = await makeTempDir({ prefix: "provider-store-test-" });
    testEnv = createTestEnvironmentConfig({
      homeDir: tempDir,
      xdgConfigHome: tempDir,
    });
  });

  beforeEach(async () => {
    await Promise.all([
      deleteProviderToken("anthropic", testEnv),
      deleteProviderToken("openai", testEnv),
    ]);
  });

  afterAll(async () => {
    await remove(tempDir, { recursive: true });
  });

  it("ProviderCredential has required fields", () => {
    const cred: ProviderCredential = {
      apiKey: "<API_KEY>",
      validatedAt: "2026-03-31T00:00:00Z",
      provider: "anthropic",
    };
    assertEquals(typeof cred.apiKey, "string");
    assertEquals(typeof cred.validatedAt, "string");
    assertEquals(cred.provider, "anthropic");
  });

  it("ProviderName supports anthropic and openai", () => {
    const names: ProviderName[] = ["anthropic", "openai"];
    assertEquals(names.length, 2);
  });

  it("listProviderTokens returns empty when no tokens", async () => {
    assertEquals(await listProviderTokens(testEnv), []);
  });

  it("stores, lists, reads, and deletes a provider credential", async () => {
    const credential: ProviderCredential = {
      apiKey: "<API_KEY>",
      validatedAt: "2026-03-31T00:00:00Z",
      provider: "anthropic",
    };

    await saveProviderToken("anthropic", credential, testEnv);

    assertEquals(await listProviderTokens(testEnv), ["anthropic"]);
    assertEquals(await readProviderToken("anthropic", testEnv), credential);

    await deleteProviderToken("anthropic", testEnv);
    assertEquals(await readProviderToken("anthropic", testEnv), null);
  });
});
