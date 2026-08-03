import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertObjectMatch,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChildRunResultSummary,
  buildRootOwnedChildRunResultHint,
  buildRootOwnedChildRunResultText,
  summarizeChildRunResultText,
  summarizeChildRunResultTextWithMetadata,
  summarizeChildRunResultValue,
} from "./result-summary.ts";

describe("child-run-result-summary", () => {
  describe("summarizeChildRunResultText", () => {
    it("returns short text unchanged", () => {
      assertEquals(summarizeChildRunResultText("hello"), "hello");
    });

    it("truncates text exceeding the default limit", () => {
      const longText = "a".repeat(65_000);
      const result = summarizeChildRunResultText(longText);

      assertEquals(result.length < longText.length, true);
      assertEquals(result.includes("… [truncated"), true);
    });

    it("preserves docs contract lines that appear after the previous short cutoff", () => {
      const text = [
        "# Create an agent",
        "x".repeat(4_500),
        '    "model": "anthropic/claude-sonnet-4-6",',
        '    "tool_ids": ["gmail__list_emails"]',
      ].join("\n");

      const result = summarizeChildRunResultText(text);

      assertStringIncludes(result, '"model": "anthropic/claude-sonnet-4-6"');
      assertStringIncludes(result, '"tool_ids": ["gmail__list_emails"]');
    });

    it("respects custom maxLength", () => {
      assertEquals(summarizeChildRunResultText("hello world", 5), "hello… [truncated 6 chars]");
    });

    it("returns structured truncation metadata", () => {
      assertEquals(summarizeChildRunResultTextWithMetadata("hello world", 5), {
        text: "hello… [truncated 6 chars]",
        status: "truncated",
        truncated: true,
        originalChars: 11,
        returnedChars: 26,
        omittedChars: 6,
        limitChars: 5,
      });
    });
  });

  describe("buildChildRunResultSummary", () => {
    it("wraps text in a summary object", () => {
      assertEquals(buildChildRunResultSummary("done"), {
        text: "done",
        status: "complete",
        truncated: false,
        originalChars: 4,
        returnedChars: 4,
        omittedChars: 0,
        limitChars: 64_000,
      });
    });

    it("returns complete text when full mode is requested", () => {
      const text = [
        "x".repeat(64_500),
        '    "model": "anthropic/claude-sonnet-4-6"',
      ].join("\n");

      assertEquals(buildChildRunResultSummary(text, { mode: "full" }), {
        text,
        status: "complete",
        truncated: false,
        originalChars: text.length,
        returnedChars: text.length,
        omittedChars: 0,
        limitChars: text.length,
      });
    });

    it("returns structured contract facts from text beyond the summary cutoff", () => {
      const text = [
        "The delegated docs page starts here.",
        'import { agent } from "veryfront/agent";',
        "x".repeat(64_500),
        '    "model": "anthropic/claude-sonnet-4-6",',
        '    "tool_ids": ["gmail__list_messages", "create_agent"],',
        '    "provider_tool_ids": ["web_fetch"]',
      ].join("\n");

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.truncated, true);
      assertEquals(result.text.includes("anthropic/claude-sonnet-4-6"), false);
      assertEquals(result.contractFacts, {
        modelIds: ["anthropic/claude-sonnet-4-6"],
        toolIds: ["gmail__list_messages", "create_agent"],
        providerToolIds: ["web_fetch"],
        importPaths: ["veryfront/agent"],
      });
    });

    it("extracts only tool IDs from object-shaped tools arrays", () => {
      const text = [
        "The delegated tool result starts here.",
        "x".repeat(64_500),
        '"tools": [{"id":"gmail__list_messages","type":"function"},{"name":"create_agent","type":"function"}]',
      ].join("\n");

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.truncated, true);
      assertEquals(result.contractFacts, {
        toolIds: ["gmail__list_messages", "create_agent"],
      });
    });

    it("extracts current Veryfront Cloud model prefixes from text beyond the summary cutoff", () => {
      const text = [
        "The delegated docs page starts here.",
        "x".repeat(64_500),
        "| google-ai-studio/gemini-3.5-flash | Google AI Studio |",
        "| veryfront-cloud/moonshotai/kimi-k2.6 | Moonshot AI |",
      ].join("\n");

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.truncated, true);
      assertEquals(result.text.includes("google-ai-studio/gemini-3.5-flash"), false);
      assertEquals(result.contractFacts, {
        modelIds: [
          "google-ai-studio/gemini-3.5-flash",
          "veryfront-cloud/moonshotai/kimi-k2.6",
        ],
      });
    });

    it("preserves raw text when full mode is requested", () => {
      const text =
        '  <function_calls><invoke name="run_bash">curl</invoke></function_calls><function_result>Title: Example</function_result>\n';

      assertEquals(buildChildRunResultSummary(text, { mode: "full" }), {
        text,
        status: "complete",
        truncated: false,
        originalChars: text.length,
        returnedChars: text.length,
        omittedChars: 0,
        limitChars: text.length,
      });
    });

    it("removes malformed tool transcript wrappers while preserving result content", () => {
      const result = buildChildRunResultSummary(
        'I will fetch the docs.\n\n<tool_call>{"name":"web_fetch","parameters":{"url":"https://example.com"}}</tool_call><tool_response>Title: Example Content: Example Domain</tool_response>\n\nNow I can continue.',
      );

      assertObjectMatch(result, {
        text:
          "I will fetch the docs.\n\nTitle: Example Content: Example Domain\n\nNow I can continue.",
        status: "complete",
        truncated: false,
        omittedChars: 0,
      });
    });

    it("removes malformed function transcript wrappers while preserving function result content", () => {
      const result = buildChildRunResultSummary(
        '```\nbash\n```\n\n<function_calls>\n<invoke name="run_bash">\n<parameter name="command">curl -s "https://docs.example.test/platform/" 2>&1 | head -5</parameter>\n</invoke>\n</function_calls>\n<function_result>\nExample Platform\nOverview\nArchitecture\n</parameter>\n</invoke>\n</function_calls>',
      );

      assertObjectMatch(result, {
        text: "Example Platform\nOverview\nArchitecture",
        status: "complete",
        truncated: false,
        omittedChars: 0,
      });
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
      if (!isPlainTestRecord(result)) {
        throw new Error("expected object result");
      }
      assertObjectMatch(result, { name: "file.txt" });
      assertEquals("content" in result, false);
    });

    it("preserves short content fields", () => {
      const result = summarizeChildRunResultValue({ name: "file.txt", content: "short" });
      if (!isPlainTestRecord(result)) {
        throw new Error("expected object result");
      }
      assertObjectMatch(result, {
        content: "short",
      });
    });

    it("strips content from files and chunks array entries", () => {
      const result = summarizeChildRunResultValue({
        files: [{ path: "/a.ts", content: "x".repeat(500) }],
        chunks: [{ id: "c1", content: "x".repeat(500) }],
      });

      if (!isPlainTestRecord(result)) {
        throw new Error("expected object result");
      }
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
