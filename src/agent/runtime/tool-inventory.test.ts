import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatSystemMessage } from "../../chat/types.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "./tool-inventory.ts";

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

  it("replaces stale inventory messages when instructions are already materialized", () => {
    const instructions: ChatSystemMessage[] = [
      { role: "system", content: "Base system" },
      { role: "system", content: "Current run tool inventory:\n\n- stale" },
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
When tool_search is listed, additional authorized tools may be deferred. If the task requires a tool that is not listed, call tool_search before saying it is unavailable. Query with one exact tool name when known, or one short capability phrase; do not combine alternatives in one query. A loaded match becomes callable on the next model step.`,
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
