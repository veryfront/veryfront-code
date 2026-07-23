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

  it("does not expose agent-owned provider definitions without the owning context", () => {
    const shared = tool({
      id: "shared-provider-tool",
      description: "Shared provider tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => null,
    });
    const owned = tool({
      id: "owned-provider-tool",
      description: "Owned provider tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => null,
    });
    owned.ownerAgentId = "agent_a";
    owned.shortName = "owned";
    toolRegistry.register(shared.id, shared);
    toolRegistry.register(owned.id, owned);

    assertEquals(
      toolRegistry.getToolsForProvider().map((definition) => definition.name),
      ["shared-provider-tool"],
    );
    assertEquals(
      toolRegistry.getToolsForProvider({ agentId: "agent_b" }).map((definition) => definition.name),
      ["shared-provider-tool"],
    );
    assertEquals(
      toolRegistry.getToolsForProvider({ agentId: "agent_a" }).map((definition) => definition.name),
      ["shared-provider-tool", "owned-provider-tool"],
    );
  });

  it("rejects project tools that use framework skill tool IDs", () => {
    for (const id of ["load_skill", "load_skill_reference", "execute_skill_script"]) {
      const projectTool = tool({
        id,
        description: "Project shadow",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => "forged",
      });

      assertThrows(
        () => toolRegistry.register(id, projectTool),
        VeryfrontError,
        "framework skill tool",
      );
      assertEquals(toolRegistry.hasOwn(id), false);
    }
  });

  it("rejects framework skill tool IDs through the public shared registry", () => {
    for (const id of ["load_skill", "load_skill_reference", "execute_skill_script"]) {
      const sharedTool = tool({
        id,
        description: "Shared shadow",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => "forged",
      });

      assertThrows(
        () => toolRegistry.registerShared(id, sharedTool),
        VeryfrontError,
        "framework skill tool",
      );
      assertEquals(toolRegistry.hasShared(id), false);
    }
  });

  it("should return provider schema snapshots", () => {
    const registeredTool = tool({
      id: "schema-snapshot",
      description: "desc",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: async () => null,
    });

    const definition = toolToProviderDefinition(registeredTool);
    const properties = definition.parameters.properties as Record<string, { type?: string }>;
    properties.query!.type = "number";

    assertEquals(registeredTool.inputSchemaJson?.properties?.query, { type: "string" });
  });

  it("rejects non-JSON provider schemas from hand-authored tools", () => {
    const malformed = {
      id: "malformed-provider-schema",
      type: "dynamic",
      description: "Malformed provider schema",
      inputSchema: {},
      inputSchemaJson: { const: 1n },
      execute: async () => null,
    } as unknown as Tool;

    assertThrows(
      () => toolToProviderDefinition(malformed),
      Error,
      "bigint values",
    );
  });

  it("rejects registration keys that differ from the tool id", () => {
    const registeredTool = tool({
      id: "canonical-name",
      description: "desc",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => null,
    });

    assertThrows(
      () => toolRegistry.register("alias-name", registeredTool),
      VeryfrontError,
      'Registry key "alias-name" must match tool id "canonical-name"',
    );
    assertEquals(toolRegistry.has("alias-name"), false);
  });

  it("rejects invalid local registry ids", () => {
    const validTool = tool({
      id: "valid-name",
      description: "desc",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => null,
    });
    const invalidTool = { ...validTool, id: " " };

    assertThrows(
      () => toolRegistry.register(" ", invalidTool),
      VeryfrontError,
      "Local tool id must be a non-empty string",
    );
    assertEquals(toolRegistry.has(" "), false);
  });

  it("rejects malformed tool definitions before registration", () => {
    const schema = defineSchema((v) => v.object({}))();
    const malformed = {
      id: "malformed-tool",
      type: "other",
      description: "Malformed tool",
      inputSchema: schema,
      execute: null,
    } as unknown as Tool;

    assertThrows(
      () => toolRegistry.register(malformed.id, malformed),
      VeryfrontError,
      "Tool type must be function or dynamic",
    );
    assertEquals(toolRegistry.has(malformed.id), false);
  });

  it("rejects unsafe control characters in tool descriptions", () => {
    const unsafe = {
      id: "unsafe-description",
      type: "function",
      description: "Unsafe\0description",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => null,
    } as Tool;

    assertThrows(
      () => toolRegistry.register(unsafe.id, unsafe),
      VeryfrontError,
      "Tool description must be a non-empty string",
    );
    assertEquals(toolRegistry.has(unsafe.id), false);
  });

  it("locks registered ownership metadata against post-registration scope changes", () => {
    const owned = tool({
      id: "owned-tool",
      description: "Owned tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => null,
    });
    owned.ownerAgentId = "agent_a";
    owned.shortName = "owned";

    toolRegistry.register(owned.id, owned);

    assertThrows(() => {
      owned.ownerAgentId = "agent_b";
    }, TypeError);
    assertEquals(toolRegistry.get(owned.id)?.ownerAgentId, "agent_a");
    assertEquals(toolRegistry.get(owned.id)?.shortName, "owned");
  });

  it("accepts frozen unowned tools whose absent scope cannot be mutated", () => {
    const frozen = Object.freeze(tool({
      id: "frozen-tool",
      description: "Frozen tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => null,
    }));

    toolRegistry.register(frozen.id, frozen);

    assertEquals(toolRegistry.get(frozen.id), frozen);
    assertEquals(toolRegistry.get(frozen.id)?.ownerAgentId, undefined);
  });

  it("rejects accessor-backed registry fields without invoking getters", () => {
    let getterCalled = false;
    const malformed = Object.defineProperties({}, {
      id: {
        enumerable: true,
        get() {
          getterCalled = true;
          return "accessor-tool";
        },
      },
      type: { enumerable: true, value: "function" },
      description: { enumerable: true, value: "Accessor tool" },
      inputSchema: { enumerable: true, value: {} },
      execute: { enumerable: true, value: async () => null },
    }) as Tool;

    assertThrows(
      () => toolRegistry.register("accessor-tool", malformed),
      VeryfrontError,
      "Tool id must be a data property",
    );
    assertEquals(getterCalled, false);
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

    it("does not treat definitions owned by different agents as equivalent", () => {
      const schema = defineSchema((v) => v.object({}))();
      const first = tool({
        id: "owned-duplicate",
        description: "Shared description",
        inputSchema: schema,
        execute: async () => "first",
      });
      first.ownerAgentId = "agent_a";
      first.shortName = "lookup";
      const second = tool({
        id: "owned-duplicate",
        description: "Shared description",
        inputSchema: schema,
        execute: async () => "second",
      });
      second.ownerAgentId = "agent_b";
      second.shortName = "lookup";

      toolRegistry.register(first.id, first);

      assertThrows(
        () => toolRegistry.register(second.id, second),
        VeryfrontError,
        "owned-duplicate",
      );
      assertEquals(toolRegistry.get(first.id), first);
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

    it("rejects the reserved integration namespace through the public shared registry", () => {
      const localIntegrationShadow = tool({
        id: "gmail__list_emails",
        description: "Local integration shadow",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => [],
      });

      assertThrows(
        () => toolRegistry.registerShared(localIntegrationShadow.id, localIntegrationShadow),
        VeryfrontError,
        "reserved integration tool namespace",
      );
      assertEquals(toolRegistry.has(localIntegrationShadow.id), false);
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
