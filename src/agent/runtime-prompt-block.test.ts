import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { createRuntimePromptBlock } from "./runtime-prompt-block.ts";

Deno.test("createRuntimePromptBlock wraps content in named tags", () => {
  assertEquals(
    createRuntimePromptBlock({ name: "context", content: "Hello world" }),
    "<context>\nHello world\n</context>",
  );
});

Deno.test("createRuntimePromptBlock trims boundary whitespace and preserves internal newlines", () => {
  assertEquals(
    createRuntimePromptBlock({ name: "note", content: "\nline1\nline2\n" }),
    "<note>\nline1\nline2\n</note>",
  );
});

Deno.test("createRuntimePromptBlock renders attrs as opening tag pairs", () => {
  assertEquals(
    createRuntimePromptBlock({ name: "tool", content: "body", attrs: { id: "1", type: "search" } }),
    '<tool id="1" type="search">\nbody\n</tool>',
  );
});

Deno.test("createRuntimePromptBlock omits attrs when none are provided", () => {
  assertMatch(createRuntimePromptBlock({ name: "x", content: "y" }), /^<x>/);
  assertEquals(
    createRuntimePromptBlock({ name: "empty", content: "val", attrs: {} }),
    "<empty>\nval\n</empty>",
  );
});
