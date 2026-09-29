import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDeferredExtensionState } from "#veryfront/extensions/deferred-extension.ts";
import { createServerBuiltinExtensions } from "./runtime-extensions.ts";

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function selectRedis(env: Record<string, string | undefined>, processSource = true) {
  return createServerBuiltinExtensions(
    (key) => env[key],
    () => processSource ? { source: "process" } : { source: "unset" },
  ).find((entry) => entry.extension.name === "ext-redis");
}

describe("server Redis extension selection", () => {
  it("selects a deferred Redis factory for the hosted runtime", async () => {
    const candidate = selectRedis({ PROXY_MODE: "1", REDIS_URL: "redis://localhost:6379" });
    assertExists(candidate);
    const deferred = getDeferredExtensionState(candidate);
    assertExists(deferred);
    const extension = await deferred.load(logger);
    assertExists(extension);
    assertEquals(extension.name, "ext-redis");
    assertEquals(extension.contracts?.provides, ["RedisRuntimeProvider"]);
  });

  it("does not select Redis for a local server or absent connection", () => {
    assertEquals(selectRedis({ REDIS_URL: "redis://localhost:6379" }), undefined);
    assertEquals(selectRedis({ PROXY_MODE: "0", REDIS_URL: "redis://localhost:6379" }), undefined);
    assertEquals(selectRedis({ PROXY_MODE: "1" }), undefined);
    assertEquals(selectRedis({ PROXY_MODE: "1", REDIS_URL: "" }), undefined);
  });

  it("honors only a process-sourced local CLI proxy marker", () => {
    const env = {
      PROXY_MODE: "1",
      REDIS_URL: "redis://localhost:6379",
      VERYFRONT_CLI_LOCAL_PROXY_MODE: "1",
    };
    assertEquals(selectRedis(env), undefined);
    assertExists(selectRedis(env, false));
  });
});
