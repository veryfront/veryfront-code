import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message } from "../types.ts";
import { projectHistoricalToolResultsForBudget } from "./aggregate-tool-result-projection.ts";
import { inspectFinalRequestBudget } from "./final-request-budget.ts";
import { createToolResultContext } from "./tool-result-context.ts";
import { isSkillReferenceToolResult } from "./tool-result-context-messages.ts";
import { createToolResultReadDefinition } from "./tool-result-context-tools.ts";

function toolMessage(id: string, toolName: string, result: unknown): Message {
  return {
    id,
    role: "tool",
    parts: [{ type: "tool-result", toolCallId: id, toolName, result }],
  };
}

function result(message: Message): unknown {
  const part = message.parts[0];
  if (!part || part.type !== "tool-result" || !("result" in part)) {
    throw new Error("Expected a tool result");
  }
  return part.result;
}

describe("aggregate tool result projection", () => {
  it("projects oldest ordinary results and protects guidance, discovery, user and latest turn", () => {
    const ordinary = toolMessage("ordinary", "read_data", "old data".repeat(50));
    const newer = toolMessage("newer", "read_data", "newer data".repeat(50));
    const skill = toolMessage("skill", "load_skill", "skill guidance".repeat(50));
    const discovery = toolMessage("discovery", "tool_search", "schema guidance".repeat(50));
    const latest = toolMessage("latest", "read_data", "latest data".repeat(50));
    const user: Message = {
      id: "user",
      role: "user",
      parts: [{ type: "text", text: "Current request" }],
    };
    const source = [ordinary, newer, skill, discovery, latest, user];
    const context = createToolResultContext({ limits: { maxInlineBytes: 8192 } });
    const projected = projectHistoricalToolResultsForBudget({
      sourceMessages: source,
      modelMessages: source,
      context,
      inspect: (messages) => {
        const referenced = typeof result(messages[0]!) === "object";
        return {
          fits: referenced,
          outputExceeded: false,
          estimatedInputTokens: referenced ? 500 : 1000,
        };
      },
    });
    assertEquals((result(projected[0]!) as { type: string }).type, "tool_result_reference");
    assertStrictEquals(projected[1], newer);
    assertStrictEquals(projected[2], skill);
    assertStrictEquals(projected[3], discovery);
    assertStrictEquals(projected[4], latest);
    assertStrictEquals(projected[5], user);
    assertStrictEquals(result(source[0]!), result(ordinary));
  });

  it("projects old skill reference files but preserves the root skill and latest result", () => {
    const root = toolMessage("root", "load_skill", {
      skillId: "veryfront",
      instructions: "Root guidance ".repeat(400).slice(0, 5_201),
      references: ["references/debug.md", "references/navigation.md"],
    });
    const debugResult = {
      skillId: "veryfront",
      file: "references/debug.md",
      content: "Debug guidance ".repeat(170).slice(0, 2_299),
    };
    const navigationResult = {
      skillId: "veryfront",
      file: "references/navigation.md",
      content: "Navigation guidance ".repeat(300).slice(0, 4_622),
    };
    const debug = toolMessage("debug", "load_skill", debugResult);
    const navigation = toolMessage("navigation", "load_skill", navigationResult);
    const latest = toolMessage("latest", "get_tool_result", { text: "P".repeat(8_192) });
    const source = [root, debug, navigation, latest];
    const context = createToolResultContext({ limits: { maxInlineBytes: 16_384 } });
    const reader = createToolResultReadDefinition();
    const inspect = (messages: Message[]) =>
      inspectFinalRequestBudget({
        system: "Mandatory system guidance ".repeat(1_000),
        messages,
        tools: {
          get_tool_result: {
            description: reader.description,
            inputSchema: { jsonSchema: reader.parameters },
          },
        },
        limit: { context: 16_384, output: 4_096 },
        requestedOutputTokens: 4_096,
      });
    const initial = inspect(source);
    assertEquals(initial.fits, false);
    assertEquals(initial.maxOutputTokens, 4_096);
    assertEquals(initial.estimatedInputTokens! + 4_096 > 16_384, true);
    const projected = projectHistoricalToolResultsForBudget({
      sourceMessages: source,
      modelMessages: source,
      context,
      inspect,
    });
    assertEquals(inspect(projected).fits, true);
    assertStrictEquals(projected[0], root);
    assertStrictEquals(projected[3], latest);
    for (const [index, original] of [[1, debugResult], [2, navigationResult]] as const) {
      const reference = result(projected[index]!) as {
        type: string;
        ref: string;
        previewBytes: number;
      };
      assertEquals(reference.type, "tool_result_reference");
      assertEquals(reference.previewBytes <= 2_048, true);
      assertStrictEquals(context.getOriginalResult(reference.ref), original);
      assertStrictEquals(result(source[index]!), original);
    }
  });

  it("does not inspect skill content through accessors or classify failed loads", () => {
    let reads = 0;
    const accessor = {
      skillId: "veryfront",
      file: "references/debug.md",
      get content() {
        reads++;
        throw new Error("Do not read tool result accessors");
      },
    };
    assertEquals(isSkillReferenceToolResult({ toolName: "load_skill", result: accessor }), false);
    assertEquals(
      isSkillReferenceToolResult({
        toolName: "load_skill",
        result: {
          skillId: "veryfront",
          file: "references/debug.md",
          content: "Partial content",
          error: "Unavailable",
        },
      }),
      false,
    );
    assertEquals(reads, 0);
  });

  it("keeps a root skill body protected even when extra file metadata is present", () => {
    assertEquals(
      isSkillReferenceToolResult({
        toolName: "load_skill",
        result: {
          skillId: "veryfront",
          instructions: "Required root guidance",
          references: ["references/debug.md"],
          file: "SKILL.md",
          content: "Additional metadata",
        },
      }),
      false,
    );
  });

  it("keeps an old skill reference inline when exact retention has no capacity", () => {
    const reference = toolMessage("reference", "load_skill", {
      skillId: "veryfront",
      file: "references/debug.md",
      content: "Debug guidance ".repeat(170),
    });
    const latest = toolMessage("latest", "get_tool_result", { text: "Current page" });
    const context = createToolResultContext({ limits: { maxStoredResults: 1 } });
    context.discloseReference({
      toolCallId: "occupied",
      toolName: "read_data",
      result: "retained",
    });
    const source = [reference, latest];
    const projected = projectHistoricalToolResultsForBudget({
      sourceMessages: source,
      modelMessages: source,
      context,
      inspect: () => ({ fits: false, outputExceeded: false, estimatedInputTokens: 1_000 }),
    });
    assertStrictEquals(projected[0], reference);
    assertStrictEquals(projected[1], latest);
    assertEquals(context.size, 1);
  });

  it("leaves skill references inline when the complete request fits", () => {
    const reference = toolMessage("reference", "load_skill", {
      skillId: "veryfront",
      file: "references/debug.md",
      content: "Debug guidance ".repeat(170),
    });
    const latest = toolMessage("latest", "get_tool_result", { text: "Current page" });
    const context = createToolResultContext();
    const source = [reference, latest];
    const projected = projectHistoricalToolResultsForBudget({
      sourceMessages: source,
      modelMessages: source,
      context,
      inspect: () => ({ fits: true, outputExceeded: false, estimatedInputTokens: 1_000 }),
    });
    assertStrictEquals(projected[0], reference);
    assertStrictEquals(projected[1], latest);
    assertEquals(context.size, 0);
  });

  it("declines a forced projection when exact storage is full", () => {
    const ordinary = toolMessage("ordinary", "read_data", "old data".repeat(50));
    const latest = toolMessage("latest", "read_data", "latest data");
    const context = createToolResultContext({
      limits: { maxInlineBytes: 8192, maxStoredResults: 1 },
    });
    context.discloseReference({
      toolCallId: "occupied",
      toolName: "read_data",
      result: "occupied",
    });
    const source = [ordinary, latest];
    const projected = projectHistoricalToolResultsForBudget({
      sourceMessages: source,
      modelMessages: source,
      context,
      inspect: () => ({ fits: false, outputExceeded: false, estimatedInputTokens: 1000 }),
    });
    assertStrictEquals(projected[0], ordinary);
    assertStrictEquals(projected[1], latest);
    assertEquals(context.size, 1);
  });

  it("spends one slot on a useful large reference even when mandatory context remains oversized", () => {
    const tiny = toolMessage("tiny", "read_data", "tiny fact");
    const large = toolMessage("large", "read_data", "large fact ".repeat(450));
    const latest = toolMessage("latest", "read_data", "latest fact");
    const source = [tiny, large, latest];
    const context = createToolResultContext({
      limits: { maxInlineBytes: 8192, previewBytes: 64, maxStoredResults: 1 },
    });
    const reader = createToolResultReadDefinition();
    const inspect = (messages: Message[]) =>
      inspectFinalRequestBudget({
        system: "mandatory guidance ".repeat(800),
        messages,
        tools: context.size > 0
          ? {
            get_tool_result: {
              description: reader.description,
              inputSchema: { jsonSchema: reader.parameters },
            },
          }
          : {},
        limit: { context: 1400, output: 32 },
        requestedOutputTokens: 32,
      });
    const initial = inspect(source);
    const projected = projectHistoricalToolResultsForBudget({
      sourceMessages: source,
      modelMessages: source,
      context,
      inspect,
    });
    assertStrictEquals(projected[0], tiny);
    assertEquals((result(projected[1]!) as { type: string }).type, "tool_result_reference");
    assertStrictEquals(projected[2], latest);
    assertEquals(context.size, 1);
    assertEquals(inspect(projected).fits, false);
    assertEquals(
      inspect(projected).estimatedInputTokens! < initial.estimatedInputTokens!,
      true,
    );
  });

  it("propagates unrelated serialization RangeErrors", () => {
    const invalid = toolMessage(
      "invalid",
      "read_data",
      new Proxy({}, {
        ownKeys() {
          throw new RangeError("Tool result context stored result limit exceeded");
        },
      }),
    );
    const latest = toolMessage("latest", "read_data", "latest fact");
    const context = createToolResultContext({ limits: { maxInlineBytes: 8192 } });
    assertThrows(
      () =>
        projectHistoricalToolResultsForBudget({
          sourceMessages: [invalid, latest],
          modelMessages: [invalid, latest],
          context,
          inspect: () => ({ fits: false, outputExceeded: false, estimatedInputTokens: 1000 }),
        }),
      RangeError,
      "Tool result context stored result limit exceeded",
    );
  });
});

it("shrinks an already retained historical skill reference preview without changing its ref", () => {
  const value = { skillId: "plan", file: "references/large.md", content: "x".repeat(20_000) };
  const old = toolMessage("old-reference", "load_skill", value);
  const latest = toolMessage("latest-reference", "read_data", "latest");
  const context = createToolResultContext({ limits: { maxInlineBytes: 8192, previewBytes: 4096 } });
  const retained = context.discloseReference({
    toolCallId: "old-reference",
    toolName: "load_skill",
    result: value,
  });
  const modelMessages: Message[] = [{
    ...old,
    parts: [{
      type: "tool-result",
      toolCallId: "old-reference",
      toolName: "load_skill",
      result: retained.modelResult,
    }],
  }, latest];
  const inspect = (messages: Message[]) =>
    inspectFinalRequestBudget({
      system: "Help",
      messages,
      limit: { context: 1000, output: 32 },
      requestedOutputTokens: 32,
    });
  assertEquals(inspect(modelMessages).fits, false);
  const fitted = projectHistoricalToolResultsForBudget({
    sourceMessages: [old, latest],
    modelMessages,
    context,
    inspect,
  });
  assertEquals(inspect(fitted).fits, true);
  const reference = result(fitted[0]!) as { ref: string; previewBytes: number };
  assertEquals(reference.ref, retained.modelResult.ref);
  assertEquals(reference.previewBytes < 4096, true);
  assertStrictEquals(context.getOriginalResult(reference.ref), value);
  assertEquals(context.size, 1);
});

it("does not turn preview-only model fallbacks into retrievable references", () => {
  const original = toolMessage("preview", "read_data", "original".repeat(1000));
  const latest = toolMessage("latest", "read_data", "latest");
  const preview = { type: "tool_result_preview", preview: "preview only" };
  const model: Message[] = [{
    ...original,
    parts: [{ type: "tool-result", toolCallId: "preview", toolName: "read_data", result: preview }],
  }, latest];
  const context = createToolResultContext();
  const fitted = projectHistoricalToolResultsForBudget({
    sourceMessages: [original, latest],
    modelMessages: model,
    context,
    inspect: (messages) => {
      const value = result(messages[0]!) as { type?: string };
      return {
        fits: value.type === "tool_result_reference",
        outputExceeded: false,
        estimatedInputTokens: value.type === "tool_result_reference" ? 100 : 1000,
      };
    },
  });
  assertStrictEquals(result(fitted[0]!), preview);
  assertEquals(context.size, 0);
});
