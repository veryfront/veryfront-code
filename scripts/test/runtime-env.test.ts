import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildRuntimeTestProcessEnv,
  PROVIDER_ENV_KEYS,
} from "./runtime-env.mjs";

describe("runtime test process environment", () => {
  it("scrubs provider env names case-insensitively", () => {
    const env = buildRuntimeTestProcessEnv({
      OpenAI_Api_Key: "test-only-provider-key",
      anthropic_base_url: "https://provider.example.test",
      Google_Generative_Ai_Api_Key: "test-only-provider-key",
      PATH: "/test/bin",
    });

    assertEquals(env.OpenAI_Api_Key, undefined);
    assertEquals(env.anthropic_base_url, undefined);
    assertEquals(env.Google_Generative_Ai_Api_Key, undefined);
    assertEquals(env.PATH, "/test/bin");
  });

  it("applies the runtime test contract", () => {
    const parentEnv = Object.fromEntries([
      ...PROVIDER_ENV_KEYS.map((key) => [key, "test-only-provider-key"]),
      ["PATH", "/test/bin"],
    ]);
    const env = buildRuntimeTestProcessEnv(parentEnv);

    assertEquals(env.PATH, "/test/bin");
    assertEquals(env.DENO_TESTING, "1");
    assertEquals(env.VF_DISABLE_LRU_INTERVAL, "1");
    assertEquals(env.NODE_ENV, "production");
    assertEquals(env.LOG_FORMAT, "text");
    assertEquals(env.VF_TEST_TIME_SCALE, "1");
    for (const key of PROVIDER_ENV_KEYS) {
      assertEquals(env[key], undefined);
    }
  });
});
