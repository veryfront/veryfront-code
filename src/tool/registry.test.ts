import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "./factory.ts";
import { toolRegistry, toolToProviderDefinition } from "./registry.ts";
import type { Tool } from "./types.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { runWithRegistryTransaction } from "#veryfront/registry/project-scoped-registry-manager.ts";

describe("tool registry", () => {
  afterEach(() => {
    toolRegistry.clearAll();
  });

  it("should prefer pre-converted schemas for provider definitions", () => {
    const registeredTool = tool({
      id: "registered-tool",
      description: "desc",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: async () => null,
    });

    assertEquals(toolToProviderDefinition(registeredTool), {
      name: "registered-tool",
      description: "desc",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    });
  });

  it("should convert schemas at runtime when a tool has no cached JSON schema", () => {
    const runtimeOnlyTool: Tool<{ enabled: boolean }, unknown> = {
      id: "runtime-tool",
      type: "function",
      description: "desc",
      inputSchema: defineSchema((v) => v.object({ enabled: v.boolean() }))(),
      execute: async () => null,
    };

    assertEquals(toolToProviderDefinition(runtimeOnlyTool), {
      name: "runtime-tool",
      description: "desc",
      parameters: {
        type: "object",
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
      },
    });
  });

  it("should return provider definitions for all registered tools", () => {
    toolRegistry.register(
      "first-tool",
      tool({
        id: "first-tool",
        description: "first",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      }),
    );
    toolRegistry.register(
      "second-tool",
      tool({
        id: "second-tool",
        description: "second",
        inputSchema: defineSchema((v) => v.object({ value: v.number() }))(),
        execute: async () => null,
      }),
    );

    assertEquals(toolRegistry.getToolsForProvider(), [
      {
        name: "first-tool",
        description: "first",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "second-tool",
        description: "second",
        parameters: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
        },
      },
    ]);
  });

  describe("collision detection", () => {
    it("re-registering the same definition (same object reference) is a no-op", () => {
      const myTool = tool({
        id: "my-tool",
        description: "does something",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      });

      toolRegistry.register("my-tool", myTool);
      // Second call with the exact same object — must not throw
      toolRegistry.register("my-tool", myTool);

      assertEquals(toolRegistry.has("my-tool"), true);
    });

    it("re-registering an equivalent definition (same id + description) replaces it with the latest", () => {
      const schema = defineSchema((v) => v.object({}))();
      const first = tool({
        id: "dup-tool",
        description: "shared description",
        inputSchema: schema,
        execute: async () => null,
      });
      const second = tool({
        id: "dup-tool",
        description: "shared description",
        inputSchema: schema,
        execute: async () => null,
      });

      toolRegistry.register("dup-tool", first);
      // Different object but same id + description — equivalent, so the
      // latest definition wins (HMR must pick up an edited execute/schema).
      toolRegistry.register("dup-tool", second);

      assertEquals(toolRegistry.get("dup-tool") === second, true);
    });

    it("registering a conflicting definition under an existing ID throws a VeryfrontError with slug tool-id-conflict", () => {
      const original = tool({
        id: "conflict-tool",
        description: "original description",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      });
      const conflicting = tool({
        id: "conflict-tool",
        description: "DIFFERENT description",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      });

      toolRegistry.register("conflict-tool", original);

      assertThrows(
        () => toolRegistry.register("conflict-tool", conflicting),
        VeryfrontError,
        "conflict-tool",
      );

      // Original definition must remain intact
      assertEquals(toolRegistry.get("conflict-tool")?.description, "original description");
    });

    it("allows a project tool to shadow a shared/framework tool with the same ID", () => {
      const sharedTool = tool({
        id: "shadowed-tool",
        description: "framework version",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      });
      const projectTool = tool({
        id: "shadowed-tool",
        description: "project version",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      });

      toolRegistry.registerShared("shadowed-tool", sharedTool);
      // Project-scoped registration with a different definition must NOT
      // conflict with the shared entry — projects shadow shared tools.
      toolRegistry.register("shadowed-tool", projectTool);

      assertEquals(toolRegistry.get("shadowed-tool")?.description, "project version");
    });

    it("two agents created concurrently with the same-named but different tools — second registration throws", async () => {
      const schema = defineSchema((v) => v.object({}))();

      const toolA: Tool = {
        id: "shared-name",
        type: "function",
        description: "Agent A version",
        inputSchema: schema,
        execute: async () => "A",
      };
      const toolB: Tool = {
        id: "shared-name",
        type: "function",
        description: "Agent B version",
        inputSchema: schema,
        execute: async () => "B",
      };

      let errorFromB: unknown;

      await Promise.all([
        Promise.resolve().then(() => toolRegistry.register("shared-name", toolA)),
        Promise.resolve().then(() => {
          try {
            toolRegistry.register("shared-name", toolB);
          } catch (e) {
            errorFromB = e;
          }
        }),
      ]);

      // One registration succeeded; the conflicting one threw
      const winner = toolRegistry.get("shared-name");
      assertEquals(
        winner?.description === "Agent A version" || winner?.description === "Agent B version",
        true,
      );
      // The losing registration must have thrown a VeryfrontError
      assertEquals(errorFromB instanceof VeryfrontError, true);
      assertEquals((errorFromB as VeryfrontError).slug, "tool-id-conflict");
    });

    it("rejects a live conflict that arrives after a staged registration", async () => {
      const schema = defineSchema((v) => v.object({}))();
      const staged = tool({
        id: "interleaved-tool",
        description: "discovery version",
        inputSchema: schema,
        execute: async () => "discovery",
      });
      const live = tool({
        id: "interleaved-tool",
        description: "route version",
        inputSchema: schema,
        execute: async () => "route",
      });
      const stageReady = Promise.withResolvers<void>();
      const releaseStage = Promise.withResolvers<void>();

      const transaction = runWithRegistryTransaction(async () => {
        toolRegistry.clear();
        toolRegistry.register("interleaved-tool", staged);
        stageReady.resolve();
        await releaseStage.promise;
      });

      await stageReady.promise;
      toolRegistry.register("interleaved-tool", live);
      releaseStage.resolve();

      await assertRejects(() => transaction, VeryfrontError, "interleaved-tool");
      assertEquals(toolRegistry.get("interleaved-tool"), live);
    });

    it("rejects a staged conflict that follows a live registration", async () => {
      const schema = defineSchema((v) => v.object({}))();
      const live = tool({
        id: "reverse-interleaved-tool",
        description: "route version",
        inputSchema: schema,
        execute: async () => "route",
      });
      const staged = tool({
        id: "reverse-interleaved-tool",
        description: "discovery version",
        inputSchema: schema,
        execute: async () => "discovery",
      });
      const stageReady = Promise.withResolvers<void>();
      const releaseStage = Promise.withResolvers<void>();

      const transaction = runWithRegistryTransaction(async () => {
        toolRegistry.clear();
        stageReady.resolve();
        await releaseStage.promise;
        toolRegistry.register("reverse-interleaved-tool", staged);
      });

      await stageReady.promise;
      toolRegistry.register("reverse-interleaved-tool", live);
      releaseStage.resolve();

      await assertRejects(() => transaction, VeryfrontError, "reverse-interleaved-tool");
      assertEquals(toolRegistry.get("reverse-interleaved-tool"), live);
    });

    it("allows a staged replacement after an interleaved live clear", async () => {
      const schema = defineSchema((v) => v.object({}))();
      const first = tool({
        id: "cleared-interleaved-tool",
        description: "first discovery version",
        inputSchema: schema,
        execute: async () => "first",
      });
      const replacement = tool({
        id: "cleared-interleaved-tool",
        description: "replacement discovery version",
        inputSchema: schema,
        execute: async () => "replacement",
      });
      const firstStaged = Promise.withResolvers<void>();
      const stageReplacement = Promise.withResolvers<void>();

      const transaction = runWithRegistryTransaction(async () => {
        toolRegistry.clear();
        toolRegistry.register("cleared-interleaved-tool", first);
        firstStaged.resolve();
        await stageReplacement.promise;
        toolRegistry.register("cleared-interleaved-tool", replacement);
      });

      await firstStaged.promise;
      toolRegistry.clear();
      stageReplacement.resolve();
      await transaction;

      assertEquals(toolRegistry.get("cleared-interleaved-tool"), replacement);
    });
  });
});
