import "#veryfront/testing/init.ts";
import "#veryfront/schemas/_test-setup.ts";
/**
 * Auto-Discovery Integration Tests
 */

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { toolRegistry } from "#veryfront/tool";
import { promptRegistry } from "#veryfront/prompt";
import { resourceRegistry } from "#veryfront/resource";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { createMockAdapter } from "#veryfront/platform";
import { discoverSchedules } from "#veryfront/schedule";
import { discoverWebhooks } from "#veryfront/webhook";
import { join, resolve } from "#veryfront/compat/path";
import { cwd } from "#veryfront/compat/process.ts";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
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

    afterEach(() => {
      clearTranspileCache();
    });

    afterAll(async () => {
      await stopEsbuild();
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

    it("reports project-relative error locations", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-safe-error-" });
      try {
        await Deno.mkdir(`${tempDir}/tools`);
        await Deno.writeTextFile(`${tempDir}/tools/broken.ts`, "export default {;");

        const result = await discoverAll({ baseDir: tempDir });

        assertEquals(result.errors.length, 1);
        assertEquals(result.errors[0]?.file, "tools/broken.ts");
        assertEquals(result.errors[0]?.error.message.includes(tempDir), false);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("reports malformed source-defined tasks", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-invalid-task-" });
      try {
        await Deno.mkdir(`${tempDir}/tasks`);
        await Deno.writeTextFile(
          `${tempDir}/tasks/broken.ts`,
          'export default { run: "not-a-function" };',
        );

        const result = await discoverAll({
          baseDir: tempDir,
          agentDirs: [],
          skillDirs: [],
          toolDirs: [],
          resourceDirs: [],
          promptDirs: [],
          workflowDirs: [],
          taskDirs: ["tasks"],
          scheduleDirs: [],
          webhookDirs: [],
          evalDirs: [],
        });

        assertEquals(result.tasks.size, 0);
        assertEquals(result.errors.length, 1);
        assertEquals(result.errors[0]?.file, "tasks/broken.ts");
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("discovers source-defined schedules and webhooks", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-triggers-" });

      try {
        await Deno.mkdir(`${tempDir}/schedules`, { recursive: true });
        await Deno.mkdir(`${tempDir}/webhooks`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/schedules/daily-triage.ts`,
          [
            'import { schedule } from "veryfront/schedule";',
            "",
            "export default schedule({",
            '  id: "daily-triage",',
            '  cron: "0 8 * * 1-5",',
            '  target: { kind: "workflow", id: "escalate-ticket" },',
            "});",
          ].join("\n"),
        );
        await Deno.writeTextFile(
          `${tempDir}/schedules/triage-sweep.ts`,
          [
            'import { schedule } from "veryfront/schedule";',
            "",
            "export default schedule({",
            '  id: "triage-sweep",',
            '  name: "Triage sweep",',
            '  schedule: "0 */6 * * *",',
            '  timezone: "Etc/UTC",',
            '  target: { kind: "task", id: "run-triage-sweep" },',
            "  input: { windowHours: 6 },",
            '  concurrencyPolicy: "Forbid",',
            "});",
          ].join("\n"),
        );
        await Deno.writeTextFile(
          `${tempDir}/webhooks/ticket-created.ts`,
          [
            'import { webhook } from "veryfront/webhook";',
            "",
            "export default webhook({",
            '  id: "ticket-created",',
            '  target: { kind: "workflow", id: "escalate-ticket" },',
            "});",
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
          toolDirs: [],
          agentDirs: [],
          resourceDirs: [],
          promptDirs: [],
          workflowDirs: [],
          taskDirs: [],
          evalDirs: [],
          skillDirs: [],
        });

        assertEquals(result.errors, []);
        assertEquals(result.schedules.get("daily-triage")?.target, {
          kind: "workflow",
          id: "escalate-ticket",
        });
        assertEquals(result.schedules.get("triage-sweep"), {
          id: "triage-sweep",
          name: "Triage sweep",
          schedule: "0 */6 * * *",
          timezone: "Etc/UTC",
          target: { kind: "task", id: "run-triage-sweep" },
          input: { windowHours: 6 },
          concurrencyPolicy: "Forbid",
        });
        assertEquals(result.webhooks.get("ticket-created")?.target, {
          kind: "workflow",
          id: "escalate-ticket",
        });
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("reports invalid source-defined schedule files", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/project/schedules", { recursive: true });
      await adapter.fs.writeFile(
        "/project/schedules/daily.ts",
        [
          'import { schedule } from "veryfront/schedule";',
          "",
          "export default schedule({",
          '  id: "daily-triage",',
          '  cron: "0 8 * * 1-5",',
          '  target: { kind: "workflow", id: "escalate-ticket" },',
          "});",
        ].join("\n"),
      );
      await adapter.fs.writeFile(
        "/project/schedules/not-a-schedule.ts",
        "export default { id: 'not-a-schedule' };",
      );

      const result = await discoverSchedules({ projectDir: "/project", adapter });

      assertEquals(result.items.map((item) => item.id), ["daily-triage"]);
      assertEquals(result.errors.length, 1);
      assertEquals(result.errors[0]?.code, "invalid_definition");
      assertEquals(result.errors[0]?.sourceKind, "schedule");
    });

    it("reports duplicate source-defined webhook ids", async () => {
      const adapter = createMockAdapter();
      const webhookSource = (id: string) =>
        [
          'import { webhook } from "veryfront/webhook";',
          "",
          "export default webhook({",
          `  id: "${id}",`,
          '  target: { kind: "workflow", id: "escalate-ticket" },',
          "});",
        ].join("\n");

      await adapter.fs.mkdir("/project/webhooks", { recursive: true });
      await adapter.fs.writeFile("/project/webhooks/first.ts", webhookSource("ticket-created"));
      await adapter.fs.writeFile("/project/webhooks/second.ts", webhookSource("ticket-created"));

      const result = await discoverWebhooks({ projectDir: "/project", adapter });

      assertEquals(result.items.map((item) => item.id), ["ticket-created"]);
      assertEquals(result.errors.length, 1);
      assertEquals(result.errors[0]?.code, "duplicate_source_id");
      assertEquals(result.errors[0]?.sourceId, "ticket-created");
    });

    it("should discover all valid named exports from a single tool file", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-multi-export-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/many.ts`,
          [
            'import { tool } from "veryfront/tool";',
            'const inputSchema = { type: "object", properties: {}, additionalProperties: false };',
            'export const alpha = tool({ description: "Alpha", inputSchema, execute: async () => "alpha" });',
            'export const beta = tool({ description: "Beta", inputSchema, execute: async () => "beta" });',
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

    it("rejects modules with an excessive number of exported definitions", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-export-limit-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        const exports = Array.from(
          { length: 1_001 },
          (_, index) =>
            `export const tool${index} = { id: "tool-${index}", execute: async () => ${index} };`,
        );
        await Deno.writeTextFile(`${tempDir}/tools/generated.ts`, exports.join("\n"));

        const result = await discoverAll({ baseDir: tempDir, verbose: false });

        assertEquals(result.tools.size, 0);
        assertEquals(result.errors.length, 1);
        assertStringIncludes(result.errors[0]?.error.message ?? "", "export limit");
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("discovers supported JavaScript module files end to end", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-javascript-" });
      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/plain-js.js`,
          [
            'import { tool } from "veryfront/tool";',
            'export default tool({ description: "Plain JS", inputSchema: { type: "object", properties: {} }, execute: async () => "js" });',
          ].join("\n"),
        );
        await Deno.writeTextFile(
          `${tempDir}/tools/plain-mjs.mjs`,
          [
            'import { tool } from "veryfront/tool";',
            'export default tool({ description: "Plain MJS", inputSchema: { type: "object", properties: {} }, execute: async () => "mjs" });',
          ].join("\n"),
        );

        const result = await discoverAll({ baseDir: tempDir });

        assertEquals([...result.tools.keys()].sort(), ["plainJs", "plainMjs"]);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("discovers default and named definitions from the same module", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-default-named-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/mixed.ts`,
          [
            'import { tool } from "veryfront/tool";',
            'const inputSchema = { type: "object", properties: {}, additionalProperties: false };',
            'const primary = tool({ id: "primary", description: "Primary", inputSchema, execute: async () => "primary" });',
            'export const secondary = tool({ id: "secondary", description: "Secondary", inputSchema, execute: async () => "secondary" });',
            "export default primary;",
          ].join("\n"),
        );

        const result = await discoverAll({ baseDir: tempDir, verbose: false });

        assertEquals(Array.from(result.tools.keys()).sort(), ["primary", "secondary"]);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("reports duplicate ids from concrete discovery modules", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-duplicate-tool-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        const source = [
          'import { tool } from "veryfront/tool";',
          'export default tool({ id: "duplicate", description: "Duplicate", inputSchema: { type: "object", properties: {} }, execute: async () => "value" });',
        ].join("\n");
        await Deno.writeTextFile(`${tempDir}/tools/first.ts`, source);
        await Deno.writeTextFile(`${tempDir}/tools/second.ts`, source);

        const result = await discoverAll({ baseDir: tempDir, verbose: false });

        assertEquals(result.tools.size, 1);
        assertEquals(result.errors.length, 1);
        assertStringIncludes(result.errors[0]?.error.message ?? "", "Duplicate tool id");
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("keeps the first duplicate agent in both the result and registry", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-duplicate-agent-" });

      try {
        await Deno.mkdir(`${tempDir}/agents`, { recursive: true });
        for (
          const [file, system] of [["first.ts", "First definition"], [
            "second.ts",
            "Second definition",
          ]] as const
        ) {
          await Deno.writeTextFile(
            `${tempDir}/agents/${file}`,
            [
              'import { agent } from "veryfront/agent";',
              `export default agent({ id: "duplicate-agent", system: "${system}" });`,
            ].join("\n"),
          );
        }

        const result = await discoverAll({ baseDir: tempDir, verbose: false });

        assertEquals(result.errors.length, 1);
        assertEquals(result.agents.get("duplicate-agent")?.config.system, "First definition");
        assertEquals(agentRegistry.get("duplicate-agent")?.config.system, "First definition");
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("removes deleted definitions from project registries on rediscovery", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-stale-tool-" });
      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        const toolFile = `${tempDir}/tools/temporary.ts`;
        await Deno.writeTextFile(
          toolFile,
          [
            'import { tool } from "veryfront/tool";',
            'export default tool({ id: "temporary", description: "Temporary", inputSchema: { type: "object", properties: {} }, execute: async () => "value" });',
          ].join("\n"),
        );

        await discoverAll({ baseDir: tempDir });
        assertEquals(toolRegistry.has("temporary"), true);

        await Deno.remove(toolFile);
        const result = await discoverAll({ baseDir: tempDir });

        assertEquals(result.tools.has("temporary"), false);
        assertEquals(toolRegistry.has("temporary"), false);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("preserves named eval export metadata", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-named-eval-" });

      try {
        await Deno.mkdir(`${tempDir}/evals`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/evals/research.eval.ts`,
          [
            'import { datasets, evalAgent } from "veryfront/eval";',
            "",
            "export const researchEval = evalAgent({",
            '  target: "agent:researcher",',
            '  dataset: datasets.inline([{ id: "q1", input: "capital" }]),',
            "});",
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(
          result.evals.get("eval:research")?.source?.exportName,
          "researchEval",
        );
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

    it("rejects project tool ids in the reserved integration namespace", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-reserved-tool-id-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/list-emails.ts`,
          [
            'import { tool } from "veryfront/tool";',
            'import { defineSchema } from "veryfront/schemas";',
            "",
            "export default tool({",
            '  id: "gmail__list_emails",',
            '  description: "List Gmail emails",',
            "  inputSchema: defineSchema((v) => v.object({}))(),",
            "  execute: async () => [],",
            "});",
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(result.tools.has("gmail__list_emails"), false);
        assertEquals(toolRegistry.has("gmail__list_emails"), false);
        assertEquals(result.errors.length, 1);
        assertStringIncludes(
          result.errors[0]?.error.message ?? "",
          'Local tool "gmail__list_emails" cannot use the reserved integration tool namespace',
        );
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("rejects project modules that mutate shared registries", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-shared-tool-id-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/shared-shadow.ts`,
          [
            'import { tool, toolRegistry } from "veryfront/tool";',
            'import { defineSchema } from "veryfront/schemas";',
            "",
            "const localShadow = tool({",
            '  id: "project-shared-shadow",',
            '  description: "Local integration shadow",',
            "  inputSchema: defineSchema((v) => v.object({}))(),",
            "  execute: async () => [],",
            "});",
            "toolRegistry.registerShared(localShadow.id, localShadow);",
            "export default localShadow;",
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(result.tools.has("project-shared-shadow"), false);
        assertEquals(toolRegistry.has("project-shared-shadow"), false);
        assertEquals(result.errors.length, 1);
        assertEquals(
          result.errors[0]?.error.message,
          "Discovery module initialization failed",
        );
        assertEquals(
          result.errors[0]?.error.message.includes("project-shared-shadow"),
          false,
        );
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("rolls back project registry side effects from a module that fails to initialize", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-failed-module-" });

      try {
        await Deno.mkdir(`${tempDir}/agents`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/agents/broken.ts`,
          [
            'import { agent } from "veryfront/agent";',
            'import { tool } from "veryfront/tool";',
            "",
            "const hidden = tool({",
            '  id: "hidden-side-effect",',
            '  description: "Must not survive failed discovery",',
            '  inputSchema: { type: "object", properties: {} },',
            "  execute: async () => null,",
            "});",
            "const broken = agent({",
            '  id: "broken-side-effect",',
            '  system: "Never published.",',
            "  tools: { hidden },",
            "});",
            'throw new Error("module failed");',
            "export default broken;",
          ].join("\n"),
        );

        const result = await discoverAll({ baseDir: tempDir, verbose: false });

        assertEquals(result.agents.size, 0);
        assertEquals(result.errors.length, 1);
        assertEquals(agentRegistry.get("broken-side-effect"), undefined);
        assertEquals(toolRegistry.has("hidden-side-effect"), false);
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
          [
            'import { tool } from "veryfront/tool";',
            'export const foo = tool({ description: "Foo", inputSchema: { type: "object", properties: {} }, execute: async () => "foo" });',
          ].join("\n"),
        );
        await Deno.writeTextFile(
          `${tempDir}/tools/bar.ts`,
          [
            'import { tool } from "veryfront/tool";',
            'export const bar = tool({ description: "Bar", inputSchema: { type: "object", properties: {} }, execute: async () => "bar" });',
          ].join("\n"),
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

    it("discovers skill-enabled agents without granting project modules shared-registry access", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-skilled-agent-" });

      try {
        toolRegistry.clearAll();
        await Deno.mkdir(`${tempDir}/agents`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/agents/support.ts`,
          [
            'import { agent } from "veryfront/agent";',
            "",
            "export default agent({",
            '  id: "support",',
            '  system: "Help users.",',
            "  skills: true,",
            "});",
          ].join("\n"),
        );

        const result = await discoverAll({ baseDir: tempDir, verbose: false });

        assertEquals(result.errors, []);
        assertEquals(result.agents.has("support"), true);
        assertEquals(toolRegistry.has("load_skill"), true);
        assertEquals(toolRegistry.has("load_skill_reference"), true);
        assertEquals(toolRegistry.has("execute_skill_script"), true);
      } finally {
        toolRegistry.clearAll();
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("restores agent-owned tools when an unchanged project is rediscovered", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-agent-tool-refresh-" });

      try {
        await Deno.mkdir(`${tempDir}/agents`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/agents/researcher.ts`,
          [
            'import { agent } from "veryfront/agent";',
            'import { tool } from "veryfront/tool";',
            "",
            "const lookup = tool({",
            '  id: "lookup",',
            '  description: "Look up a record",',
            '  inputSchema: { type: "object", properties: {} },',
            "  execute: async () => ({ found: true }),",
            "});",
            "",
            "export default agent({",
            '  id: "researcher",',
            '  system: "Research carefully.",',
            "  tools: { lookup },",
            "});",
          ].join("\n"),
        );

        const first = await discoverAll({ baseDir: tempDir, verbose: false });
        assertEquals(first.errors, []);
        assertEquals(toolRegistry.has("lookup"), true);

        const second = await discoverAll({ baseDir: tempDir, verbose: false });
        assertEquals(second.errors, []);
        assertEquals(second.agents.has("researcher"), true);
        assertEquals(toolRegistry.has("lookup"), true);
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
