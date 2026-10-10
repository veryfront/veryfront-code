import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertLessOrEqual, assertStrictEquals } from "#veryfront/testing/assert.ts";
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

function resultIsError(value: unknown): boolean | undefined {
  if (typeof value !== "object" || value === null || !("isError" in value)) {
    return undefined;
  }
  return typeof value.isError === "boolean" ? value.isError : undefined;
}

function resultPreview(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("preview" in value)) {
    return undefined;
  }
  return typeof value.preview === "string" ? value.preview : undefined;
}

function resultComplete(value: unknown): boolean | undefined {
  if (typeof value !== "object" || value === null || !("complete" in value)) {
    return undefined;
  }
  return typeof value.complete === "boolean" ? value.complete : undefined;
}

function hasResultRef(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ref" in value;
}

function hasResultRetrieval(value: unknown): boolean {
  return typeof value === "object" && value !== null && "retrieval" in value;
}

function resultRetrievalUnavailable(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("retrievalUnavailable" in value)) {
    return undefined;
  }
  return value.retrievalUnavailable;
}

describe("agent runtime tool result context message adapter", () => {
  it("does not invoke skill-result accessors or failing proxy traps", () => {
    let reads = 0;
    const accessor = {
      get skillId() {
        reads++;
        throw new Error("unexpected getter");
      },
    };
    let proxyTrapCalls = 0;
    const proxy = new Proxy({}, {
      has() {
        proxyTrapCalls++;
        throw new Error("unexpected has trap");
      },
      getOwnPropertyDescriptor() {
        proxyTrapCalls++;
        throw new Error("unexpected descriptor trap");
      },
    });
    const context = createToolResultContext({
      limits: { maxInlineBytes: 128, previewBytes: 32, maxSectionBytes: 64 },
    });
    for (const result of [accessor, proxy]) {
      const message = toolMessage(result, "load_skill");
      const transformed = createModelToolResultContextMessages([message], context);
      assertStrictEquals(transformed[0], message);
    }
    assertEquals(reads, 0);
    assertEquals(proxyTrapCalls, 0);
  });

  it("bounds skill reference files while preserving root instructions and raw results", () => {
    for (const toolName of ["load_skill", "veryfront__load_skill"]) {
      const context = createToolResultContext({
        limits: { maxInlineBytes: 128, previewBytes: 32, maxSectionBytes: 64 },
      });
      const root = toolMessage({ skillId: "platform", instructions: "root".repeat(100) }, toolName);
      const referenceResult = {
        skillId: "platform",
        file: "references/guide.md",
        content: "guide".repeat(100),
      };
      const reference = toolMessage(referenceResult, toolName);
      const transformed = createModelToolResultContextMessages([root, reference], context);
      assertStrictEquals(transformed[0], root);
      const result = requireToolResultPart(transformed[1]!.parts[0]!).result;
      assertEquals(resultType(result), "tool_result_reference");
      assertStrictEquals(requireToolResultPart(reference.parts[0]!).result, referenceResult);
      const ref = resultRef(result)!;
      assertStrictEquals(context.getOriginalResult(ref), referenceResult);
      assertLessOrEqual(context.read({ ref }).byteLength, 64);
    }
  });

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

  it("classifies oversized failed results even when tiny previews omit trailing failure fields", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 8, previewBytes: 12 },
    });
    const originalResult = {
      details: "x".repeat(256),
      isError: true,
      message: "Action failed",
    };
    const source = toolMessage(originalResult, "run_action");

    const [modelMessage] = createModelToolResultContextMessages([source], context);

    const sourcePart = requireToolResultPart(source.parts[0]!);
    const modelPart = requireToolResultPart(modelMessage!.parts[0]!);
    assertStrictEquals(sourcePart.result, originalResult);
    assertEquals(resultType(modelPart.result), "tool_result_reference");
    assertEquals(resultIsError(modelPart.result), true);
    assertEquals(resultPreview(modelPart.result)?.includes("isError"), false);
    assertEquals(resultPreview(modelPart.result)?.includes("Action failed"), false);
    assertStrictEquals(context.getOriginalResult(resultRef(modelPart.result)!), originalResult);
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
    const canonicalLoadSkill = toolMessage(
      "long canonical skill instructions",
      "veryfront__load_skill",
    );
    const toolSearch = toolMessage("long schema catalog", "tool_search");
    const getToolResult = toolMessage("long retrieved section", "get_tool_result");

    const transformed = createModelToolResultContextMessages(
      [loadSkill, canonicalLoadSkill, toolSearch, getToolResult],
      context,
    );

    assertStrictEquals(transformed[0], loadSkill);
    assertStrictEquals(transformed[1], canonicalLoadSkill);
    assertStrictEquals(transformed[2], toolSearch);
    assertStrictEquals(transformed[3], getToolResult);
    assertEquals(context.size, 0);
  });

  it("degrades storage exhaustion to bounded preview-only model context", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 1, previewBytes: 10, maxStoredResults: 1 },
    });
    const first = toolMessage("first oversized value", "read_one");
    const failedSecond = toolMessage({
      details: "second oversized value",
      isError: true,
      message: "Action failed after capacity was full",
    }, "read_two");

    const transformed = createModelToolResultContextMessages([first, failedSecond], context);
    const firstResult = requireToolResultPart(transformed[0]!.parts[0]!).result;
    const secondResult = requireToolResultPart(transformed[1]!.parts[0]!).result;

    assertEquals(resultType(firstResult), "tool_result_reference");
    const firstRef = resultRef(firstResult);
    if (firstRef === undefined) {
      throw new Error("expected first result ref");
    }
    assertEquals(context.read({ ref: firstRef }).text, "first oversized value");

    assertEquals(resultType(secondResult), "tool_result_preview");
    assertEquals(resultComplete(secondResult), false);
    assertEquals(resultIsError(secondResult), true);
    assertEquals(hasResultRef(secondResult), false);
    assertEquals(hasResultRetrieval(secondResult), false);
    assertEquals(resultRetrievalUnavailable(secondResult), {
      reason: "capacity_exceeded",
      detail: "stored result limit exceeded",
    });
    assertLessOrEqual(resultPreview(secondResult)?.length ?? 0, 10);
    assertEquals(context.size, 1);
  });
});
