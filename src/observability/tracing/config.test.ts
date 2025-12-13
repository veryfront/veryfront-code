import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { loadConfig } from "./config.ts";

describe("tracing/config", () => {
  it("should export loadConfig function", () => {
    assertExists(loadConfig);
    assertEquals(typeof loadConfig, "function");
  });

  it("should return config with defaults", () => {
    const config = loadConfig({});
    assertExists(config);
    assertEquals(typeof config.enabled, "boolean");
    assertEquals(typeof config.serviceName, "string");
  });

  it("should merge provided config with defaults", () => {
    const config = loadConfig({ enabled: true, serviceName: "test" });
    assertEquals(config.enabled, true);
    assertEquals(config.serviceName, "test");
  });
});
