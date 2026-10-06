import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message, MessagePart, ToolResultPart } from "../types.ts";
import { createToolResultContext } from "./tool-result-context.ts";
import { createModelToolResultContextMessages } from "./tool-result-context-messages.ts";

function toolMessage(result: unknown, toolName = "list_items"): Message {
  return {
    id: `tool-${toolName}`,
    role: "tool",
    timestamp: 1,
    parts: [{
      type: "tool-result",
      toolCallId: `call-${toolName}`,
      toolName,
      result,
    }],
  };
}

function requireToolResultPart(part: MessagePart): ToolResultPart {
  if (part.type === "tool-result" && "result" in part) {
    return part;
  }
  throw new Error("expected tool result part");
}

function resultType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return undefined;
  }
  return typeof value.type === "string" ? value.type : undefined;
}

function resultRef(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("ref" in value)) {
    return undefined;
  }
  return typeof value.ref === "string" ? value.ref : undefined;
}

describe("agent runtime tool result context message adapter", () => {
  it("clones only the model-visible oversized tool result part", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 8 } });
    const originalResult = { rows: ["alpha", "bravo", "charlie"] };
    const source = toolMessage(originalResult);

    const [modelMessage] = createModelToolResultContextMessages([source], context);

    const sourcePart = requireToolResultPart(source.parts[0]!);
    const modelPart = requireToolResultPart(modelMessage!.parts[0]!);

    assertStrictEquals(sourcePart.result, originalResult);
    assertEquals(
      resultType(modelPart.result),
      "tool_result_reference",
    );
    assertEquals(context.size, 1);
  });

  it("reuses stable refs when model history is transformed again", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 8 } });
    const originalResult = { rows: ["alpha", "bravo", "charlie"] };
    const source = toolMessage(originalResult);

    const first = createModelToolResultContextMessages([source], context)[0]!;
    const second = createModelToolResultContextMessages([source], context)[0]!;

    const firstPart = requireToolResultPart(first.parts[0]!);
    const secondPart = requireToolResultPart(second.parts[0]!);
    assertEquals(
      resultRef(firstPart.result),
      resultRef(secondPart.result),
    );
    assertEquals(context.size, 1);
  });

  it("leaves small results and unrelated messages untouched", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 1_000 } });
    const source = toolMessage({ ok: true });
    const text: Message = {
      id: "assistant",
      role: "assistant",
      timestamp: 1,
      parts: [{ type: "text", text: "done" }],
    };

    const [modelTool, modelText] = createModelToolResultContextMessages([source, text], context);

    assertStrictEquals(modelTool, source);
    assertStrictEquals(modelText, text);
    assertEquals(context.size, 0);
  });

  it("skips framework disclosure tools that must return their own instruction payloads", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 1 } });
    const loadSkill = toolMessage("long skill instructions", "load_skill");
    const toolSearch = toolMessage("long schema catalog", "tool_search");
    const getToolResult = toolMessage("long retrieved section", "get_tool_result");

    const transformed = createModelToolResultContextMessages(
      [loadSkill, toolSearch, getToolResult],
      context,
    );

    assertStrictEquals(transformed[0], loadSkill);
    assertStrictEquals(transformed[1], toolSearch);
    assertStrictEquals(transformed[2], getToolResult);
    assertEquals(context.size, 0);
  });

  it("surfaces capacity exhaustion instead of replacing a live reference", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 1, maxStoredResults: 1 },
    });
    const first = toolMessage("first oversized value", "read_one");
    const second = toolMessage("second oversized value", "read_two");

    assertThrows(
      () => createModelToolResultContextMessages([first, second], context),
      RangeError,
      "stored result limit exceeded",
    );
  });
});
