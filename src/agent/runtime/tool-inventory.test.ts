import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatSystemMessage } from "../../chat/types.ts";
import {
  flattenSystemInstructions,
  hasRuntimeToolInventory,
  withRuntimeToolInventory,
} from "./tool-inventory.ts";

describe("runtime tool inventory instructions", () => {
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
Do NOT infer tool availability from examples, skills, or the base prompt.`,
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
