import "#veryfront/testing/init.ts";
import "#veryfront/schemas/_test-setup.ts";
/**
 * Auto-Discovery Integration Tests
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { beforeEach, describe, it } from "#veryfront/testing/bdd";
import { toolRegistry } from "#veryfront/tool";
import { promptRegistry } from "#veryfront/prompt";
import { resourceRegistry } from "#veryfront/resource";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { join, resolve } from "#veryfront/compat/path";
import { cwd } from "#veryfront/compat/process.ts";
import { discoverAll } from "./index.ts";

function getFixturePath(): string {
  return resolve(join(cwd(), "src", "discovery", "__fixtures__", "autodiscovery"));
}

describe(
  "Auto-Discovery Integration",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    beforeEach(() => {
      toolRegistry.clear();
      resourceRegistry.clear();
      promptRegistry.clear();
      agentRegistry.clear();
    });

    it("should discover tools from tools/ directory", async () => {
      const result = await discoverAll({
        baseDir: getFixturePath(),
        verbose: false,
      });

      assertEquals(result.tools.size >= 2, true);
      assertExists(result.tools.get("greet") ?? result.tools.get("searchWeb"));
    });

    it("should discover project-authored tools with raw JSON schemas", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-json-schema-tool-" });
      try {
        await Deno.mkdir(`${tempDir}/tools`);
        await Deno.writeTextFile(
          `${tempDir}/tools/number-generator.ts`,
          `
          import { tool } from "veryfront/tool";

          export default tool({
            id: "number-generator",
            description: "Generates a random number within a specified range.",
            inputSchema: {
              type: "object",
              properties: {
                min: { type: "number" },
                max: { type: "number" },
              },
              required: ["min", "max"],
              additionalProperties: false,
            },
            outputSchema: {
              type: "object",
              properties: {
                randomNumber: { type: "number" },
              },
              required: ["randomNumber"],
              additionalProperties: false,
            },
            execute: async (input) => {
              const { min, max } = input;
              return { randomNumber: min + max };
            },
          });
        `,
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
          agentDirs: [],
          resourceDirs: [],
          promptDirs: [],
          workflowDirs: [],
          taskDirs: [],
          skillDirs: [],
        });

        const discoveredTool = result.tools.get("number-generator");
        assertExists(discoveredTool);
        assertEquals(result.errors, []);
        assertEquals(discoveredTool.inputSchemaJson, {
          type: "object",
          properties: {
            min: { type: "number" },
            max: { type: "number" },
          },
          required: ["min", "max"],
          additionalProperties: false,
        });
        assertEquals(await discoveredTool.execute({ min: 3, max: 9 }), { randomNumber: 12 });
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("should discover resources from resources/ directory", async () => {
      const result = await discoverAll({
        baseDir: getFixturePath(),
        verbose: false,
      });

      assertEquals(result.resources.size >= 1, true);
    });

    it("should discover prompts from prompts/ directory", async () => {
      const result = await discoverAll({
        baseDir: getFixturePath(),
        verbose: false,
      });

      assertEquals(result.prompts.size >= 1, true);
    });

    it("should register discovered tools in registry", async () => {
      await discoverAll({
        baseDir: getFixturePath(),
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

    it("should discover all valid named exports from a single tool file", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-multi-export-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/many.ts`,
          [
            'export const alpha = { execute: async () => "alpha" };',
            'export const beta = { execute: async () => "beta" };',
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(Array.from(result.tools.keys()).sort(), ["alpha", "beta"]);
        assertEquals(toolRegistry.getAllIds().sort(), ["alpha", "beta"]);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("preserves an explicit tool id instead of forcing the filename-derived id", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-explicit-tool-id-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/write-report.ts`,
          [
            'import { tool } from "veryfront/tool";',
            'import { defineSchema } from "veryfront/schemas";',
            "",
            "export default tool({",
            '  id: "write-report",',
            '  description: "Write a markdown report",',
            "  inputSchema: defineSchema((v) => v.object({ markdown: v.string() }))(),",
            "  execute: async ({ markdown }) => ({ ok: true, markdown }),",
            "});",
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(result.tools.has("write-report"), true);
        assertEquals(toolRegistry.has("write-report"), true);
        assertEquals(result.tools.has("writeReport"), false);
        assertEquals(toolRegistry.has("writeReport"), false);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("preserves explicit ids even when they look like autogenerated placeholders", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-explicit-generated-shape-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/write-report.ts`,
          [
            'import { tool } from "veryfront/tool";',
            'import { defineSchema } from "veryfront/schemas";',
            "",
            "export default tool({",
            '  id: "tool_2024_01",',
            '  description: "Write a markdown report",',
            "  inputSchema: defineSchema((v) => v.object({ markdown: v.string() }))(),",
            "  execute: async ({ markdown }) => ({ ok: true, markdown }),",
            "});",
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(result.tools.has("tool_2024_01"), true);
        assertEquals(toolRegistry.has("tool_2024_01"), true);
        assertEquals(result.tools.has("writeReport"), false);
        assertEquals(toolRegistry.has("writeReport"), false);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("preserves an explicit id assigned by object spread after tool() creation", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-spread-override-id-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/write-report.ts`,
          [
            'import { tool } from "veryfront/tool";',
            'import { defineSchema } from "veryfront/schemas";',
            "",
            "const generated = tool({",
            '  description: "Write a markdown report",',
            "  inputSchema: defineSchema((v) => v.object({ markdown: v.string() }))(),",
            "  execute: async ({ markdown }) => ({ ok: true, markdown }),",
            "});",
            "",
            'export default { ...generated, id: "my-tool" };',
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(result.tools.has("my-tool"), true);
        assertEquals(toolRegistry.has("my-tool"), true);
        assertEquals(result.tools.has("writeReport"), false);
        assertEquals(toolRegistry.has("writeReport"), false);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("should keep concrete tool files over index barrel re-exports", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-barrel-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/foo.ts`,
          'export const foo = { execute: async () => "foo" };\n',
        );
        await Deno.writeTextFile(
          `${tempDir}/tools/bar.ts`,
          'export const bar = { execute: async () => "bar" };\n',
        );
        await Deno.writeTextFile(
          `${tempDir}/tools/index.ts`,
          [
            'export { foo } from "./foo.ts";',
            'export { bar } from "./bar.ts";',
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(Array.from(result.tools.keys()).sort(), ["bar", "foo"]);
        assertEquals(toolRegistry.getAllIds().sort(), ["bar", "foo"]);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("should register agents by filename when config.id is omitted", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-agent-filename-id-" });

      try {
        await Deno.mkdir(`${tempDir}/agents`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/agents/researcher.ts`,
          [
            'import { agent } from "veryfront/agent";',
            "",
            "export default agent({",
            '  system: "Research deeply.",',
            "});",
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(result.agents.has("researcher"), true);
        assertExists(agentRegistry.get("researcher"));
        assertEquals(agentRegistry.getAllIds(), ["researcher"]);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });
    it("discovers markdown agents from agents directory", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-markdown-agent-" });

      try {
        await Deno.mkdir(`${tempDir}/agents`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/agents/support.md`,
          [
            "---",
            "name: Support",
            "description: Helps users",
            "model: openai/gpt-5.4",
            "max-steps: 4",
            "---",
            "",
            "Help users from markdown.",
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        const discoveredAgent = result.agents.get("support");
        assertExists(discoveredAgent);
        assertEquals(discoveredAgent.config.system, "Help users from markdown.");
        assertEquals(discoveredAgent.config.model, "openai/gpt-5.4");
        assertEquals(discoveredAgent.config.maxSteps, 4);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });
  },
);
