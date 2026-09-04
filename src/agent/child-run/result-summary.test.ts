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

    it("finds the outer tools bracket after nested schema arrays", () => {
      const text = '"tools": [{"id":"gmail__list_messages","required":[]},{"name":"create_agent"}]';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, {
        toolIds: ["gmail__list_messages", "create_agent"],
      });
    });

    it("does not promote pseudo-fields embedded in valid JSON descriptions", () => {
      const text = '"tools": [{"description":"\'id\': \'bogus_tool\'"}]';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("extracts tool IDs from single-quoted pseudo-JSON arrays", () => {
      const text = "tools: ['create_agent', " +
        "{'id': 'other_tool', 'description': 'return } safely'}]\n" +
        "provider_tool_ids: ['web_fetch']";

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, {
        toolIds: ["create_agent", "other_tool"],
        providerToolIds: ["web_fetch"],
      });
    });

    it("extracts IDs from single-quoted tool objects with escapes", () => {
      const text = String.raw`tools: [{'id':'create_agent','description':'don\'t retry'}]`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["create_agent"] });
    });

    it("extracts structured facts from hostile unclosed tool array text without quadratic scans", () => {
      const hostileText = " tools:[".repeat(64_000);
      const start = performance.now();

      const result = buildChildRunResultSummary(hostileText, { mode: "structured" });

      const elapsedMs = performance.now() - start;
      assertEquals(result.truncated, true);
      assertEquals(result.contractFacts, undefined);
      assertEquals(
        elapsedMs < 2_000,
        true,
        `structured fact extraction took ${elapsedMs}ms on unclosed tool array text`,
      );
    });

    it("preserves structured facts near the end of oversized child output", () => {
      const text = [
        "x".repeat(130_000),
        '"provider_tool_ids": ["web_fetch"]',
      ].join("\n");

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.truncated, true);
      assertEquals(result.contractFacts, { providerToolIds: ["web_fetch"] });
    });

    it("does not return a fact cut at a bounded-window edge", () => {
      const text = [
        "x".repeat(63_990),
        "anthropic/claude-sonnet-4-6",
        "x".repeat(130_000),
      ].join("");

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("does not return an at-sign fact cut at a bounded-window edge", () => {
      const partial = 'model: "foo@';
      const text = `${"x".repeat(64_000 - partial.length)}${partial}bar"${"x".repeat(130_000)}`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("does not join an array opener across the omitted window gap", () => {
      const opener = '"provider_tool_ids": [';
      const head = `${"x".repeat(64_000 - opener.length - 1)} ${opener}`;
      const middle = `]${"m".repeat(9_999)}`;
      const tailValue = '"web_fetch"]';
      const tail = `${tailValue}${" ".repeat(64_000 - tailValue.length)}`;

      const result = buildChildRunResultSummary(head + middle + tail, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("ignores tool array bodies longer than the array field body limit", () => {
      const text = [
        '"tool_ids": ["gmail__list_messages", "' + "a".repeat(2_500) + '"]',
        '"provider_tool_ids": ["web_fetch"]',
      ].join("\n");

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, {
        toolIds: ["gmail__list_messages"],
        providerToolIds: ["web_fetch"],
      });
    });

    it("preserves leading provider tool ids from oversized arrays", () => {
      const text = '"provider_tool_ids": ["web_fetch", "' + "a".repeat(2_500) + '"]';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, {
        providerToolIds: ["web_fetch"],
      });
    });

    it("preserves scalar and object tool ids from an oversized mixed array", () => {
      const text = '"tools": ["create_agent", {"id":"other_tool"}, "' +
        "a".repeat(2_500) + '"]';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, {
        toolIds: ["create_agent", "other_tool"],
      });
    });

    it("preserves an ID from a leading tool object longer than the field limit", () => {
      const text = '"tools": [{"id":"create_agent","description":"' +
        "a".repeat(2_500) + '"}]';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["create_agent"] });
    });

    it("preserves an ID after long metadata in a bounded tool object", () => {
      const text = '"tools": [{"description":"' + "a".repeat(2_500) +
        '","id":"create_agent"}]';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["create_agent"] });
    });

    it("prioritizes declared tool arrays across windows over integration matches", () => {
      const integrations = Array.from(
        { length: 50 },
        (_, index) => `integration${index}__operation`,
      ).join(" ");
      const text = `${integrations}${"x".repeat(130_000)}\n"tools": ["critical_tool"]`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts?.toolIds?.[0], "critical_tool");
      assertEquals(result.contractFacts?.toolIds?.length, 50);
    });

    it("does not treat fields after an unclosed provider tool array as array values", () => {
      const text = '"provider_tool_ids": [\n"fallback": "web_fetch"';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
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

    it("preserves a result that is entirely process narration", () => {
      assertEquals(
        buildRootOwnedChildRunResultText("Let me check that for you."),
        "Let me check that for you.",
        "a result that is only narration is preserved rather than emptied",
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

    it("never degrades a narration-only child result to an empty final answer", () => {
      assertEquals(
        buildRootOwnedChildRunResultHint({
          text: "I'll investigate this.",
          instruction: "Root owns final response.",
        }).suggestedText,
        "I'll investigate this.",
        "a narration-only child result never degrades to an empty final answer",
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

      // assertObjectMatch subset-matches array entries, so absence must be asserted directly.
      const files = result.files as Record<string, unknown>[];
      assertEquals("content" in files[0]!, false, "file entry content is stripped");
      assertEquals(files[0]!.path, "/a.ts", "the sibling path key survives stripping");
      const chunks = result.chunks as Record<string, unknown>[];
      assertEquals("content" in chunks[0]!, false, "chunk entry content is stripped");
      assertEquals(chunks[0]!.id, "c1", "the sibling id key survives stripping");
    });

    it("strips content from files and chunks entries even when it is short", () => {
      const fileResult = summarizeChildRunResultValue({
        files: [{ path: "/a.ts", content: "short" }],
      });
      if (!isPlainTestRecord(fileResult)) {
        throw new Error("expected object result");
      }
      const files = fileResult.files as Record<string, unknown>[];
      assertEquals(
        "content" in files[0]!,
        false,
        "file entry content is stripped regardless of length",
      );
      assertEquals(files[0]!.path, "/a.ts", "the sibling path key survives stripping");

      const chunkResult = summarizeChildRunResultValue({
        chunks: [{ id: "c1", content: "short" }],
      });
      if (!isPlainTestRecord(chunkResult)) {
        throw new Error("expected object result");
      }
      const chunks = chunkResult.chunks as Record<string, unknown>[];
      assertEquals(
        "content" in chunks[0]!,
        false,
        "chunk entry content is stripped regardless of length",
      );
      assertEquals(chunks[0]!.id, "c1", "the sibling id key survives stripping");
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
