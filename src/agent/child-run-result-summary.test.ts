import { assertEquals, assertObjectMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChildRunResultSummary,
  buildRootOwnedChildRunResultHint,
  buildRootOwnedChildRunResultText,
  summarizeChildRunResultText,
  summarizeChildRunResultValue,
} from "./child-run-result-summary.ts";

describe("child-run-result-summary", () => {
  describe("summarizeChildRunResultText", () => {
    it("returns short text unchanged", () => {
      assertEquals(summarizeChildRunResultText("hello"), "hello");
    });

    it("truncates text exceeding the default limit", () => {
      const longText = "a".repeat(5000);
      const result = summarizeChildRunResultText(longText);

      assertEquals(result.length < longText.length, true);
      assertEquals(result.includes("… [truncated"), true);
    });

    it("respects custom maxLength", () => {
      assertEquals(summarizeChildRunResultText("hello world", 5), "hello… [truncated 6 chars]");
    });
  });

  describe("buildChildRunResultSummary", () => {
    it("wraps text in a summary object", () => {
      assertEquals(buildChildRunResultSummary("done"), { text: "done" });
    });
  });

  describe("buildRootOwnedChildRunResultText", () => {
    it("removes leading process narration from delegated results", () => {
      assertEquals(
        buildRootOwnedChildRunResultText(
          "Let me check that for you.\n\nHere's the fallback summary",
        ),
        "Here's the fallback summary",
      );
    });

    it("preserves substantive text when there is no process preamble", () => {
      assertEquals(
        buildRootOwnedChildRunResultText("Final report delivered."),
        "Final report delivered.",
      );
    });
  });

  describe("buildRootOwnedChildRunResultHint", () => {
    it("returns the provided root-owned continuation instruction with cleaned delegated text", () => {
      assertEquals(
        buildRootOwnedChildRunResultHint({
          text: "I'll investigate this.\n\nFinal report delivered.",
          instruction: "Root owns final response.",
        }),
        {
          instruction: "Root owns final response.",
          suggestedText: "Final report delivered.",
        },
      );
    });
  });

  describe("summarizeChildRunResultValue", () => {
    it("truncates long strings", () => {
      const long = "x".repeat(1000);
      const result = summarizeChildRunResultValue(long);

      assertEquals(typeof result, "string");
      assertEquals(typeof result === "string" && result.length < long.length, true);
      assertEquals(typeof result === "string" && result.includes("… [truncated"), true);
    });

    it("preserves scalar values", () => {
      assertEquals(summarizeChildRunResultValue("short"), "short");
      assertEquals(summarizeChildRunResultValue(null), null);
      assertEquals(summarizeChildRunResultValue(undefined), undefined);
      assertEquals(summarizeChildRunResultValue(42), 42);
      assertEquals(summarizeChildRunResultValue(true), true);
    });

    it("recursively summarizes arrays", () => {
      const result = summarizeChildRunResultValue(["short", "x".repeat(1000)]);
      assertEquals(Array.isArray(result), true);
      if (!Array.isArray(result)) {
        throw new Error("expected array result");
      }
      assertEquals(result[0], "short");
      assertEquals(typeof result[1] === "string" && result[1].includes("… [truncated"), true);
    });

    it("strips long content fields from objects", () => {
      const result = summarizeChildRunResultValue({ name: "file.txt", content: "x".repeat(500) });
      assertObjectMatch(result, { name: "file.txt" });
      assertEquals(isPlainTestRecord(result) && "content" in result, false);
    });

    it("preserves short content fields", () => {
      assertObjectMatch(summarizeChildRunResultValue({ name: "file.txt", content: "short" }), {
        content: "short",
      });
    });

    it("strips content from files and chunks array entries", () => {
      const result = summarizeChildRunResultValue({
        files: [{ path: "/a.ts", content: "x".repeat(500) }],
        chunks: [{ id: "c1", content: "x".repeat(500) }],
      });

      assertObjectMatch(result, {
        files: [{ path: "/a.ts" }],
        chunks: [{ id: "c1" }],
      });
    });

    it("truncates at max depth", () => {
      let nested: unknown = "leaf";
      for (let i = 0; i < 10; i++) {
        nested = { child: nested };
      }

      const result = summarizeChildRunResultValue(nested);
      let current: unknown = result;
      let depth = 0;
      while (isPlainTestRecord(current) && "child" in current) {
        current = current.child;
        depth++;
      }

      assertEquals(current, "[truncated nested data]");
      assertEquals(depth, 5);
    });
  });
});

function isPlainTestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
