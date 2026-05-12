import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatSystemMessage } from "../chat/types.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "./runtime-tool-inventory.ts";

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
