import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERYFRONT_CONFIG_SHIM_SOURCE } from "./config-shim.ts";

describe("config shim", () => {
  it("can be materialized more than once without bridge collisions", async () => {
    const first = await import(`./config-shim.ts?materialization=${crypto.randomUUID()}`);
    const second = await import(`./config-shim.ts?materialization=${crypto.randomUUID()}`);

    assert(first.VERYFRONT_CONFIG_SHIM_URL !== second.VERYFRONT_CONFIG_SHIM_URL);
  });

  it("matches the documented named root config exports", async () => {
    const module = await import(
      `data:text/javascript,${encodeURIComponent(VERYFRONT_CONFIG_SHIM_SOURCE)}`
    );

    assertEquals(typeof module.defineConfig, "function");
    assertEquals(typeof module.defineConfigWithEnv, "function");
    assertEquals(typeof module.getEnv, "function");
    assertEquals(typeof module.mergeConfigs, "function");
    assertEquals(module.default, undefined);
  });
});
