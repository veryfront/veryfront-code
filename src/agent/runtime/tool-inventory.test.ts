import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerTurnProviderRequestValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import { agent } from "#veryfront/agent/index.ts";
import type { AgentMiddleware } from "#veryfront/agent/types.ts";
import type { ModelRuntime } from "#veryfront/provider";
import type { ChatSystemMessage } from "../../chat/types.ts";
import {
  flattenSystemInstructions,
  hasRuntimeToolInventory,
  withRuntimeToolInventory,
} from "./tool-inventory.ts";

describe("runtime tool inventory instructions", () => {
  it("flattens private instructions without calling a supplied map override", () => {
    const instructions = [{ role: "system" as const, content: " synthetic instructions " }];
    let observations = 0;
    Object.defineProperty(instructions, "map", {
      value: function (this: typeof instructions, ...args: unknown[]) {
        observations++;
        return Reflect.apply(Array.prototype.map, this, args);
      },
    });
    assertEquals(flattenSystemInstructions(instructions), "synthetic instructions");
    assertEquals(observations, 0);
  });
  it("appends visible tool inventory to string instructions", () => {
    assertEquals(withRuntimeToolInventory("Base system", ["write_file", "read_file"]), [
      { role: "system", content: "Base system" },
      {
        role: "system",
        content: `Current run tool inventory:

- write_file
- read_file

Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.`,
      },
    ]);
  });

  it("sends empty inventory authority to the provider boundary without dispatching", async () => {
    const sentinel = "provider-bound-empty-inventory-sentinel";
    let providerCalls = 0;
    let capturedSystem = "";
    const rejectAtProviderBoundary: AgentMiddleware = async (context, next) => {
      registerTurnProviderRequestValidator(context, (providerSystem) => {
        capturedSystem = flattenSystemInstructions(
          typeof providerSystem === "string"
            ? [{ role: "system", content: providerSystem }]
            : providerSystem,
        );
        throw new Error(sentinel);
      });
      return await next();
    };
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/empty-tool-inventory-authority",
      async doGenerate() {
        providerCalls++;
        throw new Error("empty inventory test reached provider");
      },
      async doStream() {
        providerCalls++;
        throw new Error("empty inventory test reached provider");
      },
    };
    const assistant = agent({
      id: "empty-tool-inventory-authority",
      model: model.modelId,
      system: withRuntimeToolInventory("Base system", []),
      skills: false,
      security: false,
      tools: {},
      providerTools: [],
      maxSteps: 1,
      middleware: [rejectAtProviderBoundary],
      resolveModelTransport: async () => ({ model }),
    });

    await assertRejects(
      () => assistant.generate({ input: "List files in the project" }),
      Error,
      sentinel,
    );

    assertEquals(providerCalls, 0);
    assertStringIncludes(capturedSystem, "Current run tool inventory:");
    assertStringIncludes(capturedSystem, "- none");
    assertStringIncludes(capturedSystem, "Tool discovery and tool execution are unavailable.");
    assertStringIncludes(
      capturedSystem,
      "Do not fabricate tool calls, tool results, or tool_search calls.",
    );
  });

  it("names deferred tools without listing them as callable", () => {
    // A deferred tool absent from both the provider tool list and this inventory
    // cannot even be searched for: the model has no reason to believe it exists.
    // It must not join the callable list either, because the footer tells the
    // model to treat that list as what it actually has.
    const [, inventory] = withRuntimeToolInventory(
      "Base system",
      ["form_input", "tool_search"],
      [{ name: "calculator", description: "Perform arithmetic." }],
    );

    const content = inventory?.content ?? "";
    const callableList = content.slice(0, content.indexOf("Only treat the tools"));
    assertEquals(callableList.includes("calculator"), false);
    assertEquals(content.includes("- calculator: Perform arithmetic."), true);
    assertEquals(content.includes("You cannot call these until they are loaded"), true);
    assertEquals(content.includes("You must not call a deferred tool directly."), true);
  });

  it("bounds large deferred tool inventories while keeping search guidance", () => {
    const deferredTools = Array.from({ length: 50 }, (_, index) => ({
      name: `catalog_tool_${String(index).padStart(3, "0")}`,
      description: `${"x".repeat(300)} SCHEMA_LEAK_SENTINEL_${index}`,
    }));
    const [, inventory] = withRuntimeToolInventory(
      "Base system",
      ["tool_search"],
      deferredTools,
    );

    const content = inventory?.content ?? "";
    assertEquals(content.includes("- catalog_tool_000: "), true);
    assertEquals(content.includes("- catalog_tool_019: "), true);
    assertEquals(content.includes("- catalog_tool_020: "), false);
    assertEquals(content.includes("30 additional authorized deferred tools are omitted"), true);
    assertEquals(
      content.includes(
        "Use tool_search with exact names or capability phrases to load omitted tools.",
      ),
      true,
    );
    assertEquals(content.includes("SCHEMA_LEAK_SENTINEL"), false);
    assertEquals(content.length < 7_000, true);
  });

  it("omits the deferred section when nothing is deferred", () => {
    // The common case must render exactly as before, so an agent with no
    // deferred catalog gains no prompt weight from this feature.
    assertEquals(
      withRuntimeToolInventory("Base system", ["read_file"], []),
      withRuntimeToolInventory("Base system", ["read_file"]),
    );
  });

  it("replaces a previous inventory that carried a deferred section", () => {
    // The deferred block is written last, so it terminates the inventory. If the
    // removal guard does not recognise that ending, the old inventory survives
    // and a second one is appended on the next step.
    const first = flattenSystemInstructions(
      withRuntimeToolInventory("Base system", ["tool_search"], [{
        name: "calculator",
        description: "Perform arithmetic.",
      }]),
    );
    const second = flattenSystemInstructions(
      withRuntimeToolInventory(first, ["tool_search"], [{ name: "web_search" }]),
    );

    assertEquals(second.split("Current run tool inventory:").length - 1, 1);
    assertEquals(second.includes("calculator"), false);
    assertEquals(second.includes("- web_search"), true);
  });

  it("replaces stale inventory messages when instructions are already materialized", () => {
    const [staleInventory] = withRuntimeToolInventory([], ["stale"]);
    assertExists(staleInventory);
    const instructions: ChatSystemMessage[] = [
      { role: "system", content: "Base system" },
      staleInventory,
    ];

    assertEquals(withRuntimeToolInventory(instructions, []), [
      { role: "system", content: "Base system" },
      {
        role: "system",
        content: `Current run tool inventory:

- none

Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.
No tools are available in this run. Tool discovery and tool execution are unavailable. Do not fabricate tool calls, tool results, or tool_search calls. If the user requests an action that requires a tool, explain that the action is unavailable.`,
      },
    ]);
  });

  it("preserves authored messages that mention the inventory header", () => {
    const authoredMessage: ChatSystemMessage = {
      role: "system",
      content:
        'Explain the literal label "Current run tool inventory:" without changing this instruction.',
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };

    assertEquals(hasRuntimeToolInventory(authoredMessage.content), false);
    assertEquals(hasRuntimeToolInventory([authoredMessage]), false);
    assertEquals(withRuntimeToolInventory([authoredMessage], ["read_file"]), [
      authoredMessage,
      {
        role: "system",
        content: `Current run tool inventory:

- read_file

Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.`,
      },
    ]);
  });

  it("replaces only a generated inventory suffix on an authored message", () => {
    const structuredMessage: ChatSystemMessage = {
      role: "system",
      content: flattenSystemInstructions(
        withRuntimeToolInventory("Keep this instruction.", ["stale_tool"]),
      ),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };

    assertEquals(hasRuntimeToolInventory([structuredMessage]), true);
    assertEquals(withRuntimeToolInventory([structuredMessage], ["current_tool"]), [
      {
        role: "system",
        content: "Keep this instruction.",
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      {
        role: "system",
        content: `Current run tool inventory:

- current_tool

Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.`,
      },
    ]);
  });

  it("replaces stale inventory after materialized instructions are flattened", () => {
    const flattenedInstructions = flattenSystemInstructions(
      withRuntimeToolInventory("Base system", ["stale_tool"]),
    );

    assertEquals(withRuntimeToolInventory(flattenedInstructions, ["current_tool"]), [
      { role: "system", content: "Base system" },
      {
        role: "system",
        content: `Current run tool inventory:

- current_tool

Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.`,
      },
    ]);
  });

  it("replaces flattened empty inventory without preserving no-tools authority", () => {
    const flattenedInstructions = flattenSystemInstructions(
      withRuntimeToolInventory("Base system", []),
    );
    const [base, inventory] = withRuntimeToolInventory(flattenedInstructions, ["read_file"]);

    assertEquals(base, { role: "system", content: "Base system" });
    assertExists(inventory);
    assertEquals(inventory.content.split("Current run tool inventory:").length - 1, 1);
    assertEquals(inventory.content.includes("- read_file"), true);
    assertEquals(inventory.content.includes("No tools are available in this run."), false);
    assertEquals(
      inventory.content.includes("Tool discovery and tool execution are unavailable."),
      false,
    );
  });

  it("explains how deferred tools become available when tool_search is visible", () => {
    assertEquals(withRuntimeToolInventory("Base system", ["form_input", "tool_search"]), [
      { role: "system", content: "Base system" },
      {
        role: "system",
        content: `Current run tool inventory:

- form_input
- tool_search

Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.
When tool_search is listed, additional authorized tools may be deferred. You MUST call tool_search before declaring a requested or required tool unavailable. Query with one exact tool name when known, or one short capability phrase; do not combine alternatives in one query. A loaded match becomes callable on the next model step.`,
      },
    ]);
  });

  it("flattens non-empty system text with blank-line separation", () => {
    assertEquals(
      flattenSystemInstructions([
        { role: "system", content: "  first  " },
        { role: "system", content: "" },
        { role: "system", content: "second" },
      ]),
      "first\n\nsecond",
    );
  });
});
