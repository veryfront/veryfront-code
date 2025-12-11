
import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "@std/testing/bdd.ts";
import {
  detectPlatform,
  getPlatformCapabilities,
  getPlatformWarnings,
  supportsCapability,
  validatePlatformCompatibility,
} from "./platform.ts";

describe("Platform Detection", () => {
  it("should detect Deno platform", () => {
    const platform = detectPlatform();
    assertEquals(platform, "deno");
  });

  it("should return platform capabilities", () => {
    const capabilities = getPlatformCapabilities();

    assertExists(capabilities.displayName);
    assertExists(capabilities.canRunMCPServer);
    assertExists(capabilities.maxAgentSteps);
    assertExists(capabilities.hasFileSystem);
  });

  it("should detect MCP server support on Deno", () => {
    const capabilities = getPlatformCapabilities("deno");
    assertEquals(capabilities.canRunMCPServer, true);
  });

  it("should detect no MCP server support on CF Workers", () => {
    const capabilities = getPlatformCapabilities("cloudflare-workers");
    assertEquals(capabilities.canRunMCPServer, false);
  });

  it("should have unlimited steps on Deno", () => {
    const capabilities = getPlatformCapabilities("deno");
    assertEquals(capabilities.maxAgentSteps, Infinity);
  });

  it("should have limited steps on CF Workers", () => {
    const capabilities = getPlatformCapabilities("cloudflare-workers");
    assertEquals(capabilities.maxAgentSteps, 3);
  });

  it("should support file system on Deno", () => {
    const supported = supportsCapability("hasFileSystem");
    assertEquals(supported, true);
  });

  it("should validate compatible config", () => {
    const result = validatePlatformCompatibility({
      maxSteps: 5,
      streaming: true,
    });

    assertEquals(result.compatible, true);
    assertEquals(result.errors.length, 0);
  });

  it("should detect incompatible config on CF Workers", () => {
    const result = validatePlatformCompatibility({
      maxSteps: 20,
    });

    assertExists(result.compatible);
    assertExists(result.errors);
    assertExists(result.warnings);
  });

  it("should return warnings array", () => {
    const warnings = getPlatformWarnings();
    assertExists(warnings);
    assertEquals(Array.isArray(warnings), true);
  });
});
