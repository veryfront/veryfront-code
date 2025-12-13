import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert, assertExists } from "std/assert/mod.ts";
import {
  aiSDKModel,
  isAISDKModel,
  useAISDK,
  toAISDKTool,
  toAISDKTools,
  AI_SDK_ADAPTER_VERSION,
  AI_SDK_SUPPORTED_VERSION,
} from "./ai-sdk.ts";
import type { Tool } from "../types/tool.ts";
import { z } from "zod";

describe("ai-sdk adapter", () => {
  describe("aiSDKModel", () => {
    it("should wrap a model with AI SDK brand", () => {
      const model = { name: "test-model" };
      const wrapped = aiSDKModel(model);

      assertExists(wrapped.__type);
      assertEquals(wrapped.__type, "ai-sdk-model");
      assertEquals(wrapped.model, model);
    });

    it("should preserve model properties", () => {
      const model = { id: "gpt-4", temperature: 0.7 };
      const wrapped = aiSDKModel(model);

      assertEquals(wrapped.model.id, "gpt-4");
      assertEquals(wrapped.model.temperature, 0.7);
    });
  });

  describe("isAISDKModel", () => {
    it("should return true for valid AI SDK model", () => {
      const model = aiSDKModel({ name: "test" });
      assert(isAISDKModel(model));
    });

    it("should return false for non-AI SDK models", () => {
      assert(!isAISDKModel({ model: "test" }));
      assert(!isAISDKModel(null));
      assert(!isAISDKModel(undefined));
      assert(!isAISDKModel("string"));
      assert(!isAISDKModel(123));
    });

    it("should return false for objects without correct brand", () => {
      assert(!isAISDKModel({ __type: "wrong-brand", model: {} }));
      assert(!isAISDKModel({ model: {} }));
    });
  });

  describe("useAISDK", () => {
    it("should be an alias for aiSDKModel", () => {
      assertEquals(useAISDK, aiSDKModel);
    });
  });

  describe("toAISDKTool", () => {
    it("should convert tool with JSON schema", () => {
      const tool: Tool = {
        id: "test-tool",
        description: "A test tool",
        inputSchema: z.object({ input: z.string() }),
        inputSchemaJson: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
        },
        execute: async () => ({ result: "success" }),
      };

      const converted = toAISDKTool(tool);

      assertEquals(converted.type, "function");
      assertEquals(converted.function.name, "test-tool");
      assertEquals(converted.function.description, "A test tool");
      assertEquals(converted.function.parameters, tool.inputSchemaJson);
    });

    it("should convert tool with Zod schema", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const tool: Tool = {
        id: "zod-tool",
        description: "Tool with Zod schema",
        inputSchema: schema,
        execute: async () => ({ result: "success" }),
      };

      const converted = toAISDKTool(tool);

      assertEquals(converted.type, "function");
      assertEquals(converted.function.name, "zod-tool");
      assertExists(converted.function.parameters);
      assertEquals(converted.function.parameters.type, "object");
    });

    it("should fallback to empty schema for tool without JSON schema", () => {
      const tool: Tool = {
        id: "no-json-schema",
        description: "Tool without JSON schema",
        inputSchema: z.object({}),
        execute: async () => ({ result: "success" }),
      };

      const converted = toAISDKTool(tool);

      assertEquals(converted.function.parameters.type, "object");
      assertExists(converted.function.parameters.properties);
    });
  });

  describe("toAISDKTools", () => {
    it("should convert multiple tools", () => {
      const tools: Record<string, Tool> = {
        tool1: {
          id: "tool1",
          description: "First tool",
          inputSchema: z.object({}),
          inputSchemaJson: { type: "object", properties: {} },
          execute: async () => ({ result: "tool1" }),
        },
        tool2: {
          id: "tool2",
          description: "Second tool",
          inputSchema: z.object({}),
          inputSchemaJson: { type: "object", properties: {} },
          execute: async () => ({ result: "tool2" }),
        },
      };

      const converted = toAISDKTools(tools);

      assertEquals(Object.keys(converted).length, 2);
      assertExists(converted.tool1);
      assertExists(converted.tool2);
      assertEquals(converted.tool1.description, "First tool");
      assertEquals(converted.tool2.description, "Second tool");
      assertEquals(typeof converted.tool1.execute, "function");
      assertEquals(typeof converted.tool2.execute, "function");
    });

    it("should preserve execute function", async () => {
      const executeFn = async (args: unknown) => ({ result: "success", args });

      const tools: Record<string, Tool> = {
        test: {
          id: "test",
          description: "Test",
          inputSchema: z.object({}),
          inputSchemaJson: { type: "object", properties: {} },
          execute: executeFn,
        },
      };

      const converted = toAISDKTools(tools);
      const testTool = converted.test;
      assertExists(testTool);
      const result = await testTool.execute({ input: "test" });

      assertEquals(result.result, "success");
      assertEquals(result.args, { input: "test" });
    });

    it("should handle empty tools object", () => {
      const converted = toAISDKTools({});
      assertEquals(Object.keys(converted).length, 0);
    });
  });

  describe("version constants", () => {
    it("should export adapter version", () => {
      assertEquals(AI_SDK_ADAPTER_VERSION, "1.0.0");
    });

    it("should export supported AI SDK version", () => {
      assertEquals(AI_SDK_SUPPORTED_VERSION, "3.x");
    });
  });
});
