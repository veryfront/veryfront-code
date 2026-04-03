import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { z } from "zod";
import { tool, toolRegistry } from "#veryfront/tool";
import {
  executeConfiguredTool,
  getAvailableTools,
  parseToolArgs,
  resolveConfiguredTool,
} from "./tool-helpers.ts";

describe("tool-helpers", () => {
  describe("parseToolArgs", () => {
    it("parses a valid JSON string into args", () => {
      const result = parseToolArgs('{"key": "value", "num": 42}');
      assertEquals(result.args, { key: "value", num: 42 });
      assertEquals(result.error, undefined);
    });

    it("passes through an object directly", () => {
      const input = { foo: "bar", nested: { a: 1 } };
      const result = parseToolArgs(input);
      assertEquals(result.args, input);
      assertEquals(result.error, undefined);
    });

    it("returns error for invalid JSON string", () => {
      const result = parseToolArgs("not-valid-json");
      assertEquals(result.args, {});
      assertEquals(typeof result.error, "string");
    });

    it("returns error for JSON array", () => {
      const result = parseToolArgs("[1, 2, 3]");
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("returns error for JSON primitive string", () => {
      const result = parseToolArgs('"hello"');
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("returns error for JSON null", () => {
      const result = parseToolArgs("null");
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("handles empty object", () => {
      const result = parseToolArgs("{}");
      assertEquals(result.args, {});
      assertEquals(result.error, undefined);
    });

    it("handles empty object passed directly", () => {
      const result = parseToolArgs({});
      assertEquals(result.args, {});
      assertEquals(result.error, undefined);
    });
  });

  describe("resolveConfiguredTool", () => {
    it("returns an inline configured tool without requiring registry registration", () => {
      const injectedTool = tool({
        id: "studio_invoke_agent",
        description: "Invoke another project agent",
        inputSchema: z.object({ prompt: z.string() }),
        execute: async ({ prompt }) => ({ echoed: prompt }),
      });

      const resolvedTool = resolveConfiguredTool(
        {
          studio_invoke_agent: injectedTool,
        },
        "studio_invoke_agent",
      );

      assertEquals(resolvedTool, injectedTool);
    });

    it("falls back to the shared registry when the config entry is true", () => {
      toolRegistry.clearAll();

      const sharedTool = tool({
        id: "shared-search",
        description: "Shared search",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => ({ query }),
      });
      toolRegistry.register("shared-search", sharedTool);

      const resolvedTool = resolveConfiguredTool(
        {
          "shared-search": true,
        },
        "shared-search",
      );

      assertEquals(resolvedTool, sharedTool);
      toolRegistry.clearAll();
    });
  });

  describe("executeConfiguredTool", () => {
    it("executes an inline configured tool before consulting the registry", async () => {
      toolRegistry.clearAll();

      const injectedTool = tool({
        id: "studio_invoke_agent",
        description: "Invoke another project agent",
        inputSchema: z.object({ prompt: z.string() }),
        execute: async ({ prompt }) => ({ text: prompt.toUpperCase() }),
      });

      const result = await executeConfiguredTool(
        "studio_invoke_agent",
        { prompt: "childself" },
        {
          studio_invoke_agent: injectedTool,
        },
        { toolCallId: "tool-1" },
      );

      assertEquals(result, { text: "CHILDSELF" });
    });

    it("falls back to the registry when no inline tool is configured", async () => {
      toolRegistry.clearAll();

      const sharedTool = tool({
        id: "shared-search",
        description: "Shared search",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => ({ source: "registry", query }),
      });
      toolRegistry.register("shared-search", sharedTool);

      const result = await executeConfiguredTool(
        "shared-search",
        { query: "docs" },
        undefined,
        { toolCallId: "tool-2" },
      );

      assertEquals(result, { source: "registry", query: "docs" });
      toolRegistry.clearAll();
    });

    it("preserves the missing-tool error when nothing is configured", async () => {
      toolRegistry.clearAll();

      await assertRejects(
        () => executeConfiguredTool("studio_invoke_agent", { prompt: "test" }, undefined),
        Error,
        'Tool "studio_invoke_agent" not found',
      );
    });

    it("rejects remote integration tools excluded by the runtime allowlist", async () => {
      await assertRejects(
        () =>
          executeConfiguredTool(
            "gmail:list-emails",
            {},
            undefined,
            { toolCallId: "tool-3" },
            ["gmail:get-email"],
          ),
        Error,
        'Tool "gmail:list-emails" is not allowed for this run',
      );
    });
  });

  describe("getAvailableTools", () => {
    it("filters remote integration tool definitions by the runtime allowlist", async () => {
      const originalFetch = globalThis.fetch;
      const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_URL");
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      globalThis.fetch = async () =>
        Response.json({
          tools: [
            {
              name: "gmail:list-emails",
              description: "List emails",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "gmail:get-email",
              description: "Get email",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        });

      try {
        Deno.env.set("VERYFRONT_API_URL", "https://api.test");
        Deno.env.set("VERYFRONT_API_TOKEN", "token");

        const defs = await getAvailableTools(true, {
          allowedRemoteToolNames: ["gmail:get-email"],
        });

        assertEquals(defs.map((def) => def.name), ["gmail:get-email"]);
      } finally {
        if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
        else Deno.env.set("VERYFRONT_API_URL", originalApiBaseUrl);
        if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
        else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
        globalThis.fetch = originalFetch;
      }
    });
  });
});
