import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertLessOrEqual,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createToolResultContext } from "./tool-result-context.ts";
import { readToolResultContext } from "./tool-result-context-tools.ts";

describe("agent runtime tool result context", () => {
  it("passes small results through without storing a model reference", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 1_000 } });
    const result = { answer: 42 };

    const disclosure = context.disclose({
      toolCallId: "call-small",
      toolName: "inspect",
      result,
    });

    assertEquals(disclosure.kind, "inline");
    assertStrictEquals(disclosure.modelResult, result);
    assertStrictEquals(disclosure.originalResult, result);
    assertEquals(context.size, 0);
  });

  it("stores oversized results behind an explicit bounded reference", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 20, previewBytes: 16, maxSectionBytes: 18 },
    });
    const original = { rows: ["alpha", "bravo", "charlie", "delta"] };

    const disclosure = context.disclose({
      toolCallId: "call-large",
      toolName: "list_rows",
      result: original,
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }
    assertStrictEquals(disclosure.originalResult, original);
    assertEquals(disclosure.modelResult.type, "tool_result_reference");
    assertEquals(disclosure.modelResult.toolCallId, "call-large");
    assertEquals(disclosure.modelResult.toolName, "list_rows");
    assertEquals(disclosure.modelResult.complete, false);
    assertEquals(disclosure.modelResult.retrieval.tool, "get_tool_result");
    assertEquals(disclosure.modelResult.retrieval.input.ref, disclosure.modelResult.ref);
    assertLessOrEqual(disclosure.modelResult.previewBytes, 16);
    assertEquals(context.size, 1);

    const first = context.read({
      ref: disclosure.modelResult.ref,
      maxBytes: 18,
    });
    assertEquals(first.type, "tool_result_section");
    assertEquals(first.cursor, "0");
    assertEquals(first.done, false);
    assertLessOrEqual(first.byteLength, 18);

    const second = context.read({
      ref: disclosure.modelResult.ref,
      cursor: first.nextCursor,
      maxBytes: 18,
    });
    assertEquals(second.ref, first.ref);
    assertLessOrEqual(second.byteLength, 18);
  });

  it("reuses references for repeated disclosure of the same tool result identity", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 4 } });
    const original = { text: "oversized text" };

    const first = context.disclose({
      toolCallId: "call-stable",
      toolName: "read",
      result: original,
    });
    const second = context.disclose({
      toolCallId: "call-stable",
      toolName: "read",
      result: original,
    });

    assertEquals(first.kind, "reference");
    assertEquals(second.kind, "reference");
    if (first.kind !== "reference" || second.kind !== "reference") {
      throw new Error("expected referenced tool result disclosures");
    }
    assertEquals(first.modelResult.ref, second.modelResult.ref);
    assertEquals(context.size, 1);
  });

  it("does not silently evict live references when storage is full", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 4, maxStoredResults: 1 },
    });

    context.disclose({
      toolCallId: "call-one",
      toolName: "read",
      result: "first oversized value",
    });

    assertThrows(
      () =>
        context.disclose({
          toolCallId: "call-two",
          toolName: "read",
          result: "second oversized value",
        }),
      RangeError,
      "stored result limit exceeded",
    );
  });

  it("preserves error metadata on oversized result references", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 4 } });
    const disclosure = context.disclose({
      toolCallId: "call-error",
      toolName: "fetch",
      result: { error: "tool_error", message: "A long diagnostic message" },
      isError: true,
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }
    assertEquals(disclosure.modelResult.isError, true);
  });

  it("reconstructs the complete serialized result by following cursors", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 4, maxSectionBytes: 10 },
    });
    const disclosure = context.disclose({
      toolCallId: "call-text",
      toolName: "read_file",
      result: "line 1\nline 2\nline 3",
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }

    let cursor: string | undefined;
    let text = "";
    for (let index = 0; index < 10; index++) {
      const section = context.read({
        ref: disclosure.modelResult.ref,
        cursor,
        maxBytes: 10,
      });
      text += section.text;
      cursor = section.nextCursor;
      if (section.done) break;
    }

    assertEquals(text, "line 1\nline 2\nline 3");
  });

  it("keeps stored references isolated to their creating context", () => {
    const firstContext = createToolResultContext({ limits: { maxInlineBytes: 4 } });
    const secondContext = createToolResultContext({ limits: { maxInlineBytes: 4 } });
    const disclosure = firstContext.disclose({
      toolCallId: "call-one",
      toolName: "lookup",
      result: "oversized text",
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }

    assertThrows(
      () => secondContext.read({ ref: disclosure.modelResult.ref }),
      ReferenceError,
      "not found in this run",
    );
    assertEquals(firstContext.read({ ref: disclosure.modelResult.ref }).done, true);
  });

  it("clears run-owned references on cleanup", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 4 } });
    const disclosure = context.disclose({
      toolCallId: "call-cleanup",
      toolName: "read",
      result: "oversized text",
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }
    context.clear();

    assertEquals(context.size, 0);
    assertThrows(
      () => context.read({ ref: disclosure.modelResult.ref }),
      ReferenceError,
      "not found in this run",
    );
  });

  it("removes primitive identity indexes on delete and clear", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 1 } });

    for (let index = 0; index < 3; index++) {
      const disclosure = context.disclose({
        toolCallId: `call-cleanup-${index}`,
        toolName: "read",
        result: `oversized text ${index}`,
      });
      assertEquals(disclosure.kind, "reference");
      if (disclosure.kind !== "reference") {
        throw new Error("expected referenced tool result disclosure");
      }
      assertEquals(context.delete(disclosure.modelResult.ref), true);
    }

    assertEquals(context.size, 0);
    assertEquals(context.__getDiagnosticsForTests(), {
      totalStoredBytes: 0,
      primitiveIdentityValues: 0,
      primitiveIdentityEntries: 0,
    });

    const first = context.disclose({
      toolCallId: "call-clear",
      toolName: "read",
      result: "oversized text after delete",
    });
    assertEquals(first.kind, "reference");
    if (first.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }
    assertEquals(context.__getDiagnosticsForTests().primitiveIdentityEntries, 1);

    context.clear();
    assertEquals(context.__getDiagnosticsForTests(), {
      totalStoredBytes: 0,
      primitiveIdentityValues: 0,
      primitiveIdentityEntries: 0,
    });
  });

  it("does not reuse stale object or primitive identity references after cleanup", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 1 } });
    const objectResult = { text: "oversized object text" };
    const primitiveResult = "oversized primitive text";

    const firstObject = context.disclose({
      toolCallId: "call-object",
      toolName: "read",
      result: objectResult,
    });
    const firstPrimitive = context.disclose({
      toolCallId: "call-primitive",
      toolName: "read",
      result: primitiveResult,
    });
    assertEquals(firstObject.kind, "reference");
    assertEquals(firstPrimitive.kind, "reference");
    if (firstObject.kind !== "reference" || firstPrimitive.kind !== "reference") {
      throw new Error("expected referenced tool result disclosures");
    }

    assertEquals(context.delete(firstObject.modelResult.ref), true);
    const secondObject = context.disclose({
      toolCallId: "call-object",
      toolName: "read",
      result: objectResult,
    });
    assertEquals(secondObject.kind, "reference");
    if (secondObject.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }
    assertEquals(secondObject.modelResult.ref === firstObject.modelResult.ref, false);

    context.clear();
    const secondPrimitive = context.disclose({
      toolCallId: "call-primitive",
      toolName: "read",
      result: primitiveResult,
    });
    assertEquals(secondPrimitive.kind, "reference");
    if (secondPrimitive.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }
    assertEquals(secondPrimitive.modelResult.ref === firstPrimitive.modelResult.ref, false);
    assertEquals(context.__getDiagnosticsForTests().primitiveIdentityEntries, 1);
  });

  it("respects byte budgets without splitting surrogate pairs", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 1, maxSectionBytes: 5 },
    });
    const disclosure = context.disclose({
      toolCallId: "call-emoji",
      toolName: "read",
      result: "a🙂b🙂c",
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }

    const first = context.read({ ref: disclosure.modelResult.ref, maxBytes: 5 });
    const second = context.read({
      ref: disclosure.modelResult.ref,
      cursor: first.nextCursor,
      maxBytes: 5,
    });

    assertEquals(first.text, "a🙂");
    assertEquals(second.text, "b🙂");
  });

  it("requires plain decimal cursors and preserves surrogate boundaries", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 1, maxSectionBytes: 5 },
    });
    const disclosure = context.disclose({
      toolCallId: "call-cursor-form",
      toolName: "read",
      result: "a🙂b",
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }

    for (const cursor of ["01", "1e0", " 1", "+1", "1.0", "-1"]) {
      assertThrows(
        () => context.read({ ref: disclosure.modelResult.ref, cursor }),
        RangeError,
        "plain non-negative decimal integer string",
      );
    }

    const first = context.read({ ref: disclosure.modelResult.ref, maxBytes: 5 });
    assertEquals(first.text, "a🙂");
    assertEquals(first.nextCursor, "3");

    const midSurrogate = context.read({
      ref: disclosure.modelResult.ref,
      cursor: "2",
      maxBytes: 5,
    });
    assertEquals(midSurrogate.cursor, "1");
    assertEquals(midSurrogate.text, "🙂b");
  });

  it("advances through unpaired high surrogates", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 1, maxSectionBytes: 4 },
    });
    const original = "\uD800界abcdef";
    const disclosure = context.disclose({
      toolCallId: "call-unpaired-surrogate",
      toolName: "read",
      result: original,
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }

    let cursor: string | undefined;
    let text = "";
    for (let index = 0; index < 10; index++) {
      const section = context.read({
        ref: disclosure.modelResult.ref,
        cursor,
        maxBytes: 4,
      });
      assertEquals(section.nextCursor === section.cursor, false);
      text += section.text;
      cursor = section.nextCursor;
      if (section.done) break;
    }

    assertEquals(text, original);
  });

  it("rejects invalid limits instead of silently falling back", () => {
    assertThrows(
      () => createToolResultContext({ limits: { maxInlineBytes: -1 } }),
      RangeError,
      "maxInlineBytes must be a positive safe integer",
    );
    assertThrows(
      () => createToolResultContext({ limits: { previewBytes: Number.NaN } }),
      RangeError,
      "previewBytes must be a positive safe integer",
    );
    assertThrows(
      () => createToolResultContext({ limits: { maxSectionBytes: 1 } }),
      RangeError,
      "maxSectionBytes must be at least 4",
    );
    assertThrows(
      () => createToolResultContext({ limits: { maxInlineBytes: 1_048_577 } }),
      RangeError,
      "maxInlineBytes must be at most 1048576",
    );
    assertThrows(
      () => createToolResultContext({ limits: { previewBytes: 1_048_577 } }),
      RangeError,
      "previewBytes must be at most 1048576",
    );
    assertThrows(
      () => createToolResultContext({ limits: { maxSectionBytes: 1_048_577 } }),
      RangeError,
      "maxSectionBytes must be at most 1048576",
    );
    assertThrows(
      () => createToolResultContext({ limits: { maxStoredResults: 1_025 } }),
      RangeError,
      "maxStoredResults must be at most 1024",
    );
  });

  it("rejects a single stored result above the hard per-result byte limit", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 1 } });
    const tooLarge = "x".repeat(16 * 1_024 * 1_024 + 1);

    assertThrows(
      () =>
        context.disclose({
          toolCallId: "call-too-large",
          toolName: "read",
          result: tooLarge,
        }),
      RangeError,
      "per-result storage limit",
    );
    assertEquals(context.size, 0);
  });

  it("enforces total stored bytes without charging deduped disclosures and releases bytes on delete and clear", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 1 } });
    const maxAllowed = "x".repeat(16 * 1_024 * 1_024);
    const refs: string[] = [];

    for (let index = 0; index < 4; index++) {
      const disclosure = context.disclose({
        toolCallId: `call-budget-${index}`,
        toolName: "read",
        result: maxAllowed,
      });
      assertEquals(disclosure.kind, "reference");
      if (disclosure.kind !== "reference") {
        throw new Error("expected referenced tool result disclosure");
      }
      refs.push(disclosure.modelResult.ref);
    }
    assertEquals(context.size, 4);

    const repeated = context.disclose({
      toolCallId: "call-budget-0",
      toolName: "read",
      result: maxAllowed,
    });
    assertEquals(repeated.kind, "reference");
    if (repeated.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }
    assertEquals(repeated.modelResult.ref, refs[0]);
    assertEquals(context.size, 4);

    assertThrows(
      () =>
        context.disclose({
          toolCallId: "call-budget-overflow",
          toolName: "read",
          result: "extra",
        }),
      RangeError,
      "total storage limit exceeded",
    );

    const deletedRef = refs[0];
    if (deletedRef === undefined) {
      throw new Error("expected a stored reference to delete");
    }
    assertEquals(context.delete(deletedRef), true);
    const replacement = context.disclose({
      toolCallId: "call-budget-replacement",
      toolName: "read",
      result: maxAllowed,
    });
    assertEquals(replacement.kind, "reference");
    assertEquals(context.size, 4);

    context.clear();
    assertEquals(context.size, 0);
    const afterClear = context.disclose({
      toolCallId: "call-after-clear",
      toolName: "read",
      result: maxAllowed,
    });
    assertEquals(afterClear.kind, "reference");
    assertEquals(context.size, 1);
  });

  it("advertises retrieval input accepted by the reader when previews are under four bytes", () => {
    for (const previewBytes of [1, 2, 3]) {
      const context = createToolResultContext({
        limits: { maxInlineBytes: 1, previewBytes, maxSectionBytes: 8 },
      });
      const disclosure = context.disclose({
        toolCallId: `call-preview-${previewBytes}`,
        toolName: "read",
        result: "oversized text",
      });

      assertEquals(disclosure.kind, "reference");
      if (disclosure.kind !== "reference") {
        throw new Error("expected referenced tool result disclosure");
      }
      assertEquals(disclosure.modelResult.retrieval.input.maxBytes, 4);

      const section = readToolResultContext(
        context,
        disclosure.modelResult.retrieval.input,
      );
      assertEquals(section.type, "tool_result_section");
      assertLessOrEqual(section.byteLength, 4);
    }
  });

  it("rejects section requests too small for safe UTF-8 cursor progress", () => {
    const context = createToolResultContext({
      limits: { maxInlineBytes: 1, maxSectionBytes: 4 },
    });
    const disclosure = context.disclose({
      toolCallId: "call-progress",
      toolName: "read",
      result: "🙂🙂",
    });

    assertEquals(disclosure.kind, "reference");
    if (disclosure.kind !== "reference") {
      throw new Error("expected referenced tool result disclosure");
    }

    assertThrows(
      () => context.read({ ref: disclosure.modelResult.ref, maxBytes: 1 }),
      RangeError,
      "maxBytes must be at least 4",
    );
  });
});
