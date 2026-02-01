/**
 * Auto-Discovery Integration Tests
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { beforeEach, describe, it } from "#veryfront/testing/bdd";
import { toolRegistry } from "#veryfront/tool";
import { promptRegistry, resourceRegistry } from "#veryfront/mcp";
import { join, resolve } from "#veryfront/compat/path";
import { cwd } from "#veryfront/compat/process.ts";
import { discoverAll } from "../../../src/cli/discovery/index.ts";

function getExamplesPath(): string {
  return resolve(join(cwd(), "examples", "autodiscovery"));
}

describe(
  "Auto-Discovery Integration",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    beforeEach(() => {
      toolRegistry.clear();
      resourceRegistry.clear();
      promptRegistry.clear();
    });

    it("should discover tools from tools/ directory", async () => {
      const result = await discoverAll({
        baseDir: getExamplesPath(),
        verbose: false,
      });

      assertEquals(result.tools.size >= 2, true);
      assertExists(result.tools.get("greet") ?? result.tools.get("searchWeb"));
    });

    it("should discover resources from resources/ directory", async () => {
      const result = await discoverAll({
        baseDir: getExamplesPath(),
        verbose: false,
      });

      assertEquals(result.resources.size >= 1, true);
    });

    it("should discover prompts from prompts/ directory", async () => {
      const result = await discoverAll({
        baseDir: getExamplesPath(),
        verbose: false,
      });

      assertEquals(result.prompts.size >= 1, true);
    });

    it("should register discovered tools in registry", async () => {
      await discoverAll({
        baseDir: getExamplesPath(),
        verbose: false,
      });

      const toolIds = toolRegistry.getAllIds();
      assertEquals(toolIds.length >= 2, true);
    });

    it("should handle discovery errors gracefully", async () => {
      const result = await discoverAll({
        baseDir: "/nonexistent/path",
        verbose: false,
      });

      assertExists(result);
      assertExists(result.errors);
    });
  },
);
