/**
 * Auto-Discovery Integration Tests
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { beforeEach, describe, it } from "@std/testing/bdd.ts";
import { discoverAll } from "../../../src/cli/discovery/index.ts";
import { toolRegistry } from "@veryfront/tool";
import { promptRegistry, resourceRegistry } from "@veryfront/mcp";

describe("Auto-Discovery Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  beforeEach(() => {
    // Clear registries
    toolRegistry.clear();
    resourceRegistry.clear();
    promptRegistry.clear();
  });

  it("should discover tools from tools/ directory", async () => {
    const result = await discoverAll({
      baseDir: new URL("../../../examples/autodiscovery/", import.meta.url).pathname,
      verbose: false,
    });

    // Should discover greet and searchWeb tools
    assertEquals(result.tools.size >= 2, true);
    assertExists(result.tools.get("greet") || result.tools.get("searchWeb"));
  });

  it("should discover resources from resources/ directory", async () => {
    const result = await discoverAll({
      baseDir: new URL("../../../examples/autodiscovery/", import.meta.url).pathname,
      verbose: false,
    });

    // Should discover user profile resource
    assertEquals(result.resources.size >= 1, true);
  });

  it("should discover prompts from prompts/ directory", async () => {
    const result = await discoverAll({
      baseDir: new URL("../../../examples/autodiscovery/", import.meta.url).pathname,
      verbose: false,
    });

    // Should discover support prompt
    assertEquals(result.prompts.size >= 1, true);
  });

  it("should register discovered tools in registry", async () => {
    await discoverAll({
      baseDir: new URL("../../../examples/autodiscovery/", import.meta.url).pathname,
      verbose: false,
    });

    // Tools should be in global registry
    const toolIds = toolRegistry.getAllIds();
    assertEquals(toolIds.length >= 2, true);
  });

  it("should handle discovery errors gracefully", async () => {
    const result = await discoverAll({
      baseDir: "/nonexistent/path",
      verbose: false,
    });

    // Should not crash, just return empty results
    assertExists(result);
    assertExists(result.errors);
  });
});
