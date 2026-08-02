import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createConfigShimModule,
  encodeConfigShimSource,
  VERYFRONT_CONFIG_SHIM_SOURCE,
  VERYFRONT_CONFIG_SHIM_URL,
} from "./config-shim.ts";
import { defineConfig, defineConfigWithEnv, mergeConfigs } from "./define-config.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

describe("config shim", () => {
  it("can be materialized more than once without bridge collisions", async () => {
    const first = await import(`./config-shim.ts?materialization=${crypto.randomUUID()}`);
    const second = await import(`./config-shim.ts?materialization=${crypto.randomUUID()}`);

    assert(first.VERYFRONT_CONFIG_SHIM_URL !== second.VERYFRONT_CONFIG_SHIM_URL);
  });

  it("matches the documented named root config exports", async () => {
    const module = await import(VERYFRONT_CONFIG_SHIM_URL);

    assertEquals(typeof module.defineConfig, "function");
    assertEquals(typeof module.defineConfigWithEnv, "function");
    assertEquals(typeof module.getEnv, "function");
    assertEquals(typeof module.mergeConfigs, "function");
    assertEquals(module.default, undefined);
    assertEquals("source" in module, false);
    assertEquals("url" in module, false);
    assert(!VERYFRONT_CONFIG_SHIM_URL.includes(VERYFRONT_CONFIG_SHIM_SOURCE));
    assert(!VERYFRONT_CONFIG_SHIM_URL.includes("__veryfrontConfigShimBridge"));
  });

  it("encodes UTF-8 source as deterministic executable base64", async () => {
    const source = 'export const label = "räksmörgås 🦊";';
    const encoded = encodeConfigShimSource(source);
    const decodedBytes = Uint8Array.from(
      atob(encoded),
      (character) => character.charCodeAt(0),
    );
    const module = await import(`data:text/javascript;base64,${encoded}`);

    assertEquals(new TextDecoder().decode(decodedBytes), source);
    assertEquals(module.label, "räksmörgås 🦊");
  });

  it("rejects names that cannot form an isolated bridge identifier", () => {
    const bridge = { defineConfig, defineConfigWithEnv, getEnv, mergeConfigs };

    for (const name of ["", "Loader", "loader name", "loader:name", "../loader"]) {
      assertThrows(
        () => createConfigShimModule(name, bridge),
        TypeError,
        `Invalid config shim name "${name}"`,
      );
    }
  });
});
