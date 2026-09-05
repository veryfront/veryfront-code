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
  type ChildRunContractFacts,
  extractChildRunContractFacts,
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

    it("retains tool IDs in pseudo-JSON objects with trailing commas", () => {
      const result = buildChildRunResultSummary("tools: [{'id':'critical_tool',}]", {
        mode: "structured",
      });
      assertEquals(result.contractFacts, { toolIds: ["critical_tool"] });
    });

    it("extracts IDs from pseudo-JSON tool objects with trailing commas", () => {
      for (
        const [text, expectedToolId] of [
          [`tools: [{'id':'single_quoted_tool',}]`, "single_quoted_tool"],
          [`tools: [{"id":"double_quoted_tool",}]`, "double_quoted_tool"],
        ] as const
      ) {
        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, { toolIds: [expectedToolId] });
      }
    });

    it("normalizes unterminated horizontal whitespace in bounded linear time", () => {
      buildChildRunResultSummary(" ".repeat(1_000), { mode: "structured" });
      const measure = (length: number): number => {
        const start = performance.now();
        buildChildRunResultSummary(" ".repeat(length), { mode: "structured" });
        return performance.now() - start;
      };

      const shortElapsedMs = measure(16_000);
      const longElapsedMs = measure(64_000);

      assertEquals(
        longElapsedMs < 1_000 && longElapsedMs < shortElapsedMs * 12 + 100,
        true,
        `horizontal whitespace normalization scaled from ${shortElapsedMs}ms to ${longElapsedMs}ms`,
      );
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

    it("preserves a complete fact before a long token crosses the head boundary", () => {
      const text = `openai/gpt-4.1,${"x".repeat(140_000)}`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { modelIds: ["openai/gpt-4.1"] });
      const toolText = "I've finished.\n" + "padding ".repeat(18_000) +
        '\ntools: ["create_agent"]';
      assertEquals(buildChildRunResultSummary(toolText, { mode: "structured" }).contractFacts, {
        toolIds: ["create_agent"],
      });
    });

    it("does not return an at-sign fact cut at a bounded-window edge", () => {
      const partial = 'model: "foo@';
      const text = `${"x".repeat(64_000 - partial.length)}${partial}bar"${"x".repeat(130_000)}`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("does not backtrack to a partial fact before boundary punctuation", () => {
      for (const partial of ["openai/gpt-4.1-", "gmail__list-"]) {
        const text = ",".repeat(64_000 - partial.length) + partial +
          "messages" + ",".repeat(64_000);

        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, undefined);
      }
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

    it("preserves an early ID when its tool object crosses the head window", () => {
      const text = '"tools": [{"id":"create_agent","description":"' +
        "a".repeat(70_000) + '"}]' + "z".repeat(70_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["create_agent"] });
    });

    it("stops an incomplete leading object at invalid member syntax", () => {
      const text = 'tools: [{"description":"ok"} garbage "id":"bogus_tool"' +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("stops an incomplete leading object at a non-scalar bare member value", () => {
      const text = 'tools: [{"cost": some junk, "id":"bogus_tool", "description":"' +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("preserves an ID after valid nested and scalar members in an incomplete object", () => {
      const text = 'tools: [{"schema":{"tags":["a"]},"strict":true,"cost":1.5,' +
        '"id":"create_agent","description":"' + "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["create_agent"] });
    });

    it("stops an incomplete leading object at invalid syntax after an ID", () => {
      const text = 'tools: [{"id":"bogus_tool" garbage ' + "y ".repeat(70_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("keeps boundary trimming from hiding invalid syntax after an ID", () => {
      const text = 'tools: [{"id":"bogus_tool" garbage' + "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("validates an object member that starts after a cutoff comma", () => {
      const prefix = 'tools: [{"id":"bogus_tool"';
      const text = prefix + " ".repeat(32_000 - prefix.length - 1) + ",garbage" +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("validates continuation after a complete array scalar at the head cutoff", () => {
      for (const field of ["tools", "tool_ids"]) {
        const prefix = `${field}: ["bogus_tool"`;
        const text = prefix + " ".repeat(32_000 - prefix.length) + "garbage" +
          "x".repeat(130_000);
        const result = buildChildRunResultSummary(text, { mode: "structured" });
        assertEquals(result.contractFacts, undefined);
      }
    });

    it("retains a complete array scalar with valid continuation at the head cutoff", () => {
      const prefix = 'tools: ["valid_tool"';
      const text = prefix + " ".repeat(32_000 - prefix.length) + "]\n" +
        "x".repeat(130_000);
      const result = buildChildRunResultSummary(text, { mode: "structured" });
      assertEquals(result.contractFacts, { toolIds: ["valid_tool"] });
    });

    it("validates a nested array value that starts after a cutoff comma", () => {
      const prefix = 'tools: [{"id":"bogus_tool","schema":[0';
      const text = prefix + " ".repeat(32_000 - prefix.length - 1) + ",garbage" +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects an ID when malformed object syntax begins at the head cutoff", () => {
      const prefix = 'tools: [{"id":"bogus_tool","description":"ok"';
      const text = prefix + " ".repeat(32_000 - prefix.length) + "garbage" +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects an invalid quoted escape split by the head cutoff", () => {
      const prefix = 'tools: [{"id":"bogus_tool","description":"';
      const text = prefix + "x".repeat(32_000 - prefix.length - 1) + "\\q" +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("withholds IDs when quoted validation ends at a pending escape", () => {
      const prefix = 'tools: [{"id":"bogus_tool","description":"';
      const text = prefix + "x".repeat(32_000 - prefix.length) + "aaaa\\q" +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects an invalid Unicode escape continuing past the head cutoff", () => {
      const prefix = 'tools: [{"id":"bogus_tool","description":"';
      const text = prefix + "x".repeat(32_000 - prefix.length - 2) + "\\u0q" +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects an invalid scalar continuation past the head cutoff", () => {
      const prefix = 'tools: [{"id":"bogus_tool","cost":';
      const text = prefix + " ".repeat(32_000 - prefix.length - 1) + "1x" +
        "y".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("withholds IDs when scalar continuation outlives the bounded lookahead", () => {
      const prefix = 'tools: [{"id":"bogus_tool","cost":';
      for (const continuation of ["23456x", "234567}]"]) {
        const text = prefix + " ".repeat(32_000 - prefix.length - 1) + "1" +
          continuation + "x".repeat(130_000);
        const result = buildChildRunResultSummary(text, { mode: "structured" });
        assertEquals(result.contractFacts, undefined);
      }
    });

    it("retains IDs when a scalar terminates within the bounded lookahead", () => {
      const prefix = 'tools: [{"id":"valid_tool","cost":';
      const text = prefix + " ".repeat(32_000 - prefix.length - 1) + "1" +
        "234}]" + "x".repeat(130_000);
      const result = buildChildRunResultSummary(text, { mode: "structured" });
      assertEquals(result.contractFacts, { toolIds: ["valid_tool"] });
    });

    it("rejects an arbitrary bare scalar prefix cut by the head window", () => {
      const text = 'tools: [{"id":"bogus_tool","cost": garbage' +
        "x".repeat(40_000) + "\n" + "z".repeat(100_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects an ID after malformed nested metadata in an incomplete object", () => {
      const text = 'tools: [{"schema":[}],"id":"bogus_tool","description":"' +
        "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects an incomplete tool object with an invalid escape in metadata", () => {
      const text = 'tools: [{"id":"bogus_tool","description":"bad\\q","x":"' + "y ".repeat(70_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects an invalid escape in a quoted member cut by the head window", () => {
      const text = 'tools: [{"id":"bogus_tool","description":"bad\\q' +
        "x".repeat(40_000) + "\n" + "z".repeat(100_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects an invalid escape in an object key cut by the head window", () => {
      const text = 'tools: [{"id":"bogus_tool","bad\\q' +
        "x".repeat(40_000) + "\n" + "z".repeat(100_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("rejects malformed nested metadata cut by the head window", () => {
      const text = 'tools: [{"id":"bogus_tool","schema":{"cost": garbage' +
        "x".repeat(40_000) + "\n" + "z".repeat(100_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("bounds validation of deeply nested metadata cut by the head window", () => {
      const text = 'tools: [{"id":"bogus_tool","metadata":' +
        "[".repeat(15_000) + "0" + "x".repeat(130_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.truncated, true);
      assertEquals(result.contractFacts, undefined);
    });

    it("does not scan tool pseudo-fields inside a quoted tail value", () => {
      const description = `${"x".repeat(100_000)} tools:['bogus_tool'] ${"x".repeat(40_000)}`;
      const text = JSON.stringify({ tools: [{ description }] });

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("does not scan quoted metadata opened inside the tool tail", () => {
      const text = JSON.stringify({
        tools: [{
          metadata: new Array(25_000).fill(0),
          description: "Example tools:['bogus_tool']",
          trailing: "x".repeat(90_000),
        }],
      });
      assertEquals(
        buildChildRunResultSummary(text, { mode: "structured" }).contractFacts,
        undefined,
      );
    });

    it("scans many quoted metadata values within a bounded runtime", () => {
      const text = JSON.stringify({ metadata: new Array(42_000).fill(""), tools: ["real_tool"] });
      const start = performance.now();
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        toolIds: ["real_tool"],
      });
      assertEquals(performance.now() - start < 500, true);
    });

    it("preserves escape parity across the tool tail boundary", () => {
      for (const slashCount of [2, 4]) {
        for (let beforeBoundary = 1; beforeBoundary < slashCount; beforeBoundary++) {
          const prefix = '{"description":"';
          const body = prefix + "x".repeat(40_000 - beforeBoundary - prefix.length) +
            "\\".repeat(slashCount) + '"}\ntools: ["real_tool"]\n';
          const text = body + "p".repeat(136_000 - body.length);
          const result = buildChildRunResultSummary(text, { mode: "structured" });
          assertEquals(result.contractFacts, { toolIds: ["real_tool"] });
        }
      }
    });

    it("tracks a quote opened in the omitted span when the head is outside quotes", () => {
      const description = "x".repeat(50_000) + " tools: ['bogus_tool'] " +
        "x".repeat(90_000);
      const text = "p".repeat(70_000) + "\n" + JSON.stringify({
        tools: [{ description }],
      });

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("does not extract tail facts when the omitted quote state exceeds its scan limit", () => {
      for (const quotedHead of [false, true]) {
        const prelude = quotedHead
          ? JSON.stringify({ prelude: "x".repeat(70_000) }).slice(0, -1) + ","
          : '{"prelude":0,' + " ".repeat(70_000);
        const description = "x".repeat(200_000) + " tools:['bogus_tool'] " +
          "x".repeat(10_000);
        const text = prelude + '"description":' + JSON.stringify(description) + "}";
        const result = buildChildRunResultSummary(text, { mode: "structured" });
        assertEquals(result.contractFacts, undefined);
      }
    });

    it("recovers a tail field after a head quote closes in the omitted span", () => {
      const text = `{"description":"${"x".repeat(70_000)}"}` +
        "p".repeat(70_000) + '\nmodel: "sonnet"' + "p".repeat(60_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { modelIds: ["sonnet"] });
    });

    it("recovers a standalone tail ID after a head quote closes in the omitted span", () => {
      const text = `{"description":"${"x".repeat(70_000)}"}` +
        "p".repeat(70_000) + "\nopenai/gpt-4.1\n" + "p".repeat(60_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { modelIds: ["openai/gpt-4.1"] });
      const toolText = "I've finished.\n" + "padding ".repeat(18_000) +
        '\ntools: ["create_agent"]';
      assertEquals(buildChildRunResultSummary(toolText, { mode: "structured" }).contractFacts, {
        toolIds: ["create_agent"],
      });
      const possessiveText = "Updated the user's settings. " + "a".repeat(140_000) +
        '\ntools: ["create_agent"]';
      assertEquals(
        buildChildRunResultSummary(possessiveText, { mode: "structured" }).contractFacts,
        { toolIds: ["create_agent"] },
      );
    });

    it("keeps quote state closed across prose apostrophes in the omitted span", () => {
      for (
        const prose of [
          "I don't expect a problem.",
          "Everything's ready.",
          "Please don't change this.",
          "please don't change this.",
          "I do not think it's ready",
          "I don't think it's ready, but we're close.",
          "we do not think it's ready",
          "I don't expect a problem (yet).",
          "I don't expect a problem: proceed.",
          "Please don't change src/main.ts.",
          "Please don't change this; proceed.",
        ]
      ) {
        const text = JSON.stringify({ description: "x".repeat(70_000) }) +
          `\n${prose} ` + "p".repeat(70_000) +
          '\nmodel: "sonnet"\n' + "p".repeat(60_000);

        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, { modelIds: ["sonnet"] });
      }
    });

    it("honors a quote opened in the omitted span", () => {
      const text = "const first = '" + "x".repeat(70_000) +
        "';\nconst description = \"" + "p".repeat(70_000) +
        "\nopenai/gpt-4.1\n" + "p".repeat(60_000) + '"+suffix;';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("does not recover object members from a truncated tool_ids array", () => {
      const text = 'tool_ids: [{"id":"bogus_tool","description":"' +
        "x".repeat(140_000) + '"}]';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("scans contraction-heavy omitted lines within a bounded runtime", () => {
      const text = JSON.stringify({ description: "x".repeat(70_000) }) +
        "\nI " + "don't ".repeat(12_000) + "\n" + "p".repeat(100_000);
      const start = performance.now();

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
      assertEquals(performance.now() - start < 1_000, true);
    });

    it("retains standalone tail facts after a plain prose contraction", () => {
      const cases: Array<[string, ChildRunContractFacts]> = [
        ['model: "sonnet"', { modelIds: ["sonnet"] }],
        ['tools: ["critical_tool"]', { toolIds: ["critical_tool"] }],
        ['provider_tool_ids: ["web_fetch"]', { providerToolIds: ["web_fetch"] }],
        ['import "veryfront/agent";', { importPaths: ["veryfront/agent"] }],
        ['import { x } from "./from.ts";', { importPaths: ["./from.ts"] }],
        ["| openai/gpt-4.1 | OpenAI |", { modelIds: ["openai/gpt-4.1"] }],
      ];
      for (const [fact, expected] of cases) {
        const text = "I don't expect a problem. " + "p".repeat(70_000) +
          `\n${fact}\n` + "p".repeat(60_000);

        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, expected);
      }

      const combined = "I don't expect a problem. " + "p".repeat(70_000) +
        '\nmodel: "sonnet"\ntools: ["critical_tool"]\n' +
        'provider_tool_ids: ["web_fetch"]\nimport "veryfront/agent";\n' + "p".repeat(60_000);
      assertEquals(buildChildRunResultSummary(combined, { mode: "structured" }).contractFacts, {
        modelIds: ["sonnet"],
        toolIds: ["critical_tool"],
        providerToolIds: ["web_fetch"],
        importPaths: ["veryfront/agent"],
      });
    });

    it("retains tail facts after a heading and a prose contraction", () => {
      const text = "Result:\nI don't expect a problem. " + "p".repeat(70_000) +
        '\nmodel: "sonnet"\n' + "p".repeat(60_000);
      const result = buildChildRunResultSummary(text, { mode: "structured" });
      assertEquals(result.contractFacts, { modelIds: ["sonnet"] });
    });

    it("retains tail facts after multiple prose contractions", () => {
      const text = "I don't think it's ready, but we're close. " + "p".repeat(140_000) +
        '\ntools: ["create_agent"]';
      const result = buildChildRunResultSummary(text, { mode: "structured" });
      assertEquals(result.contractFacts, { toolIds: ["create_agent"] });
    });

    it("keeps tail declarations when the prose head already contains a declaration", () => {
      const text = 'I don\'t expect a problem.\ntools: ["early_tool"]\n' + "p".repeat(130_000) +
        '\ntools: ["late_tool"]';
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        toolIds: ["early_tool", "late_tool"],
      });
    });

    it("tracks a structured head after an introductory prose contraction", () => {
      const text = "I don't expect a problem.\n" +
        JSON.stringify({ description: "x".repeat(70_000) }) +
        "p".repeat(60_000) + '\nmodel: "sonnet"';
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        modelIds: ["sonnet"],
      });
    });

    it("tracks a fenced JSON head after a prose contraction", () => {
      const text = "Here's the configuration:\n```json\n" +
        JSON.stringify({ description: "x".repeat(140_000) }) +
        '\n```\ntools: ["create_agent"]';
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        toolIds: ["create_agent"],
      });
    });

    it("scans blank-line-heavy heads without repeatedly reading the whitespace run", () => {
      const text = "\n".repeat(16_000) + "plain text\n" + "p".repeat(130_000);
      const started = performance.now();
      assertEquals(extractChildRunContractFacts(text), undefined);
      assertEquals(performance.now() - started < 500, true);
    });

    it("retains complete fenced JSON declarations after prose apostrophes", () => {
      const text = "Here is the agent's documentation.\n" + "x ".repeat(65_000) +
        '\n```json\n{"tool_ids":["create_agent"]}\n```';
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        toolIds: ["create_agent"],
      });
    });

    it("retains object-shaped tool IDs from recovered JSON fences", () => {
      const text = "Here is the agent's documentation.\n" + "x ".repeat(65_000) +
        '\n```json\n{"tools":[{"id":"create_agent"},{"name":"read_file"}]}\n```';
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        toolIds: ["create_agent", "read_file"],
      });
    });

    it("retains declarations after prose apostrophes with inline code", () => {
      const text = 'The run finished at one o\'clock using `agent`.\ntools: ["create_agent"]';
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        toolIds: ["create_agent"],
      });
      const quoted = 'The run finished at one o\'clock using `example tools: ["bogus_tool"]`.';
      assertEquals(
        buildChildRunResultSummary(quoted, { mode: "structured" }).contractFacts,
        undefined,
      );
    });

    it("retains declarations after prose apostrophes with quoted phrases", () => {
      const text = 'The run finished at one o\'clock using "fast mode".\ntools: ["create_agent"]';
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        toolIds: ["create_agent"],
      });
    });

    it("retains tail facts after common prose apostrophes", () => {
      for (
        const head of [
          "I really don't expect a problem. ",
          "I have reviewed the project's APIs. ",
          "I'm finished with the review. ",
          "I checked O'Reilly's example. ",
          "we do not think it's ready. ",
          "i don't expect a problem. ",
          "the user's settings are updated. ",
          "NASA's documentation is updated. ",
        ]
      ) {
        const text = head + "p".repeat(70_000) + '\nmodel: "sonnet"\n' +
          "p".repeat(60_000);

        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, { modelIds: ["sonnet"] });
      }
    });

    it("keeps declarations after apostrophes within ordinary words", () => {
      for (
        const prose of [
          "The run finished at one o'clock.",
          "L'agent finished.",
          "Model X's configuration is ready.",
          "Model X's configuration (updated).",
        ]
      ) {
        for (const padding of ["", "p".repeat(130_000)]) {
          const text =
            `${prose}\n${padding}\ntools: ["create_agent"]\nprovider_tool_ids: ["web_fetch"]`;
          assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
            toolIds: ["create_agent"],
            providerToolIds: ["web_fetch"],
          });
        }
      }
    });

    it("does not extract tool declarations from prefixed string literals", () => {
      for (const prefix of ["r", "b", "f", "fr", "N"]) {
        const text = `description = ${prefix}'example tools: ["bogus_tool"]'`;
        assertEquals(
          buildChildRunResultSummary(text, { mode: "structured" }).contractFacts,
          undefined,
        );
      }
    });

    it("preserves shell string boundaries before a real declaration", () => {
      const text = `echo prefix'example tools: ["bogus_tool"]'\ntools: ["real_tool"]`;
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).contractFacts, {
        toolIds: ["real_tool"],
      });
    });

    it("retains tail facts after a validated long prose gap", () => {
      const text = "Here's the result:\n" + "padding ".repeat(17_500) +
        "\nopenai/gpt-4.1\n";

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { modelIds: ["openai/gpt-4.1"] });
    });

    it("does not recover prose tail facts across structured syntax", () => {
      for (const marker of ["const data = '", "cat <<EOF", "```text", "/*", "----", "...."]) {
        const text = "I don't expect a problem. " + "p".repeat(66_000) +
          `\n${marker}\n` + "p".repeat(4_000) + '\nmodel: "bogus"\n' +
          "p".repeat(60_000);

        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, undefined);
      }
    });

    it("rejects malformed recovered array and import lines", () => {
      for (
        const line of [
          'tools: [/* ] tools: ["bogus_tool"] */]',
          'import /* from "veryfront/secret"',
          'export // from "veryfront/secret"',
        ]
      ) {
        const text = "I don't expect a problem. " + "p".repeat(70_000) +
          `\n${line}\n` + "p".repeat(60_000);

        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, undefined);
      }
    });

    it("retains only canonical facts from recoverable lines", () => {
      const table = "I don't expect a problem. " + "p".repeat(70_000) +
        '\n| openai/gpt-4.1 | export // from "veryfront/secret" |\n' + "p".repeat(60_000);
      assertEquals(buildChildRunResultSummary(table, { mode: "structured" }).contractFacts, {
        modelIds: ["openai/gpt-4.1"],
      });

      for (
        const line of [
          'model: "sonnet\\""',
          'tools: [{"id":"real_tool","description":"gmail__steal"}]',
        ]
      ) {
        const text = "I don't expect a problem. " + "p".repeat(70_000) +
          `\n${line}\n` + "p".repeat(60_000);
        assertEquals(
          buildChildRunResultSummary(text, { mode: "structured" }).contractFacts,
          undefined,
        );
      }
    });

    it("does not recover after syntax markers in the retained head", () => {
      for (const marker of ["(*", "###", "#if 0"]) {
        const text = `I don't expect a problem.\n${marker}\n` + "p".repeat(70_000) +
          '\nmodel: "bogus"\n' + "p".repeat(60_000);

        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, undefined);
      }
    });

    it("does not classify a shell contraction as plain prose", () => {
      for (
        const prefix of ["echo I don't expect a problem. ", "set -e\nI don't expect a problem. "]
      ) {
        const text = prefix + "p".repeat(70_000) + '\nmodel: "bogus"\n' +
          "p".repeat(60_000);

        const result = buildChildRunResultSummary(text, { mode: "structured" });

        assertEquals(result.contractFacts, undefined);
      }
    });

    it("does not throw when a recovered import contains escapes", () => {
      const text = "I don't expect a problem. " + "p".repeat(70_000) +
        "\n" + String.raw`import "foo\bar";` + "\n" + "p".repeat(60_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("bounds malformed recovered import parsing", () => {
      const text = "I don't expect a problem. " + "p".repeat(70_000) +
        "\nimport " + " ".repeat(3_000) + "\n" + "p".repeat(59_000);
      const start = performance.now();

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
      assertEquals(performance.now() - start < 500, true);
    });

    it("does not retain facts from an unterminated short array", () => {
      const result = buildChildRunResultSummary('tools: ["bogus_tool"', {
        mode: "structured",
      });

      assertEquals(result.contractFacts, undefined);
    });

    it("does not treat a tail window cut as a tool field boundary", () => {
      const opener = "tools:['bogus_tool']";
      const text = `${"p".repeat(70_000)}z"${opener}${"y".repeat(96_000 - opener.length)}`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("does not treat a tail window cut as a model field boundary", () => {
      const field = "model:'bogus/model'";
      const text = `${"p".repeat(70_000)}z"${field}${"y".repeat(64_000 - field.length)}`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
    });

    it("keeps a tool field that begins exactly at a real tail boundary", () => {
      const field = 'tools: ["critical_tool"]';
      const text = "p".repeat(40_000) + "\n" + field +
        "z".repeat(96_000 - field.length);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["critical_tool"] });
    });

    it("keeps an unquoted field after a cut numeric token in the tail window", () => {
      const text = `{value:${"1".repeat(70_000)},model:"sonnet",tail:"${"x".repeat(58_100)}"}`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { modelIds: ["sonnet"] });
    });

    it("keeps imports after a semicolon-delimited cut token", () => {
      const text = `${"x".repeat(70_000)};import "veryfront/agent";${"y".repeat(60_000)}`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { importPaths: ["veryfront/agent"] });
    });

    it("resumes the incomplete object scan at the element crossing the cutoff", () => {
      const text = 'tools: [{"id":"first_tool"},{"id":"critical_tool","description":"' +
        "y ".repeat(70_000);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["first_tool", "critical_tool"] });
    });

    it("recovers a trailing tool ID when its declaration crosses the tail window", () => {
      const text = "p".repeat(70_000) + "\n" +
        'tools: [{"description":"' + "x".repeat(70_000) + '","id":"critical_tool"}]';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["critical_tool"] });
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

    it("does not spend the fact limit on empty tool arrays", () => {
      const text = `${"tools: []\n".repeat(50)}tools: ["critical_tool"]`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["critical_tool"] });
    });

    it("does not charge short arrays against a later extended tool scan", () => {
      const text = `${"tools: []\n".repeat(50)}tools: [{"description":"${
        "a".repeat(2_500)
      }","id":"critical_tool"}]`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["critical_tool"] });
    });

    it("reserves extended scans for later tool declarations", () => {
      const noIdArray = `tools: [{"description":"${"a".repeat(2_100)}"}]\n`;
      const text = noIdArray.repeat(50) +
        `tools: [{"description":"${"b".repeat(2_500)}","id":"critical_tool"}]`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["critical_tool"] });
    });

    it("does not let later no-ID arrays displace an earlier extended fact", () => {
      const factArray = `tools: [{"description":"${"a".repeat(2_100)}","id":"critical_tool"}]\n`;
      const noIdArray = `tools: [{"description":"${"b".repeat(2_100)}"}]\n`;
      const text = factArray + noIdArray.repeat(50);

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, { toolIds: ["critical_tool"] });
    });

    it("scans complete provider ID arrays beyond the fast prefix", () => {
      const padding = Array.from(
        { length: 20 },
        (_, index) => `provider_tool_${index}_${"x".repeat(100)}`,
      );
      const text = `provider_tool_ids: ${JSON.stringify([...padding, "web_fetch"])}`;

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts?.providerToolIds?.includes("web_fetch"), true);
    });

    it("bounds cleanup of unclosed transcript tags", () => {
      for (const tag of ["<tool_response>", "<tool_call>", "<invoke "]) {
        const text = tag.repeat(32_000);
        const started = performance.now();
        buildChildRunResultSummary(text, { mode: "structured" });
        assertEquals(performance.now() - started < 1_000, true);
      }
    });

    it("cleans large tag-only results without a per-tag index", () => {
      const text = "<parameter>".repeat(1_000_000);
      const started = performance.now();
      assertEquals(buildChildRunResultSummary(text, { mode: "structured" }).text, "");
      assertEquals(performance.now() - started < 2_000, true);
    });

    it("bounds whitespace scanning in malformed transcript fences", () => {
      const text = "```" + " ".repeat(50_000) + "no fence";
      const started = performance.now();
      buildChildRunResultSummary(text, { mode: "structured" });
      assertEquals(performance.now() - started < 1_000, true);
    });

    it("rejects complete malformed arrays rather than salvaging their leading values", () => {
      for (const field of ["tools", "tool_ids", "provider_tool_ids"]) {
        for (const body of ['"bogus_tool", {garbage}', "'bogus_tool', {garbage}"]) {
          const result = buildChildRunResultSummary(`${field}: [${body}]`, {
            mode: "structured",
          });
          assertEquals(result.contractFacts, undefined);
        }
      }
    });

    it("preserves outer trailing commas in complete pseudo-JSON arrays", () => {
      for (const field of ["tools", "tool_ids", "provider_tool_ids"]) {
        const result = buildChildRunResultSummary(`${field}: ['valid_tool',]`, {
          mode: "structured",
        });
        assertEquals(
          result.contractFacts,
          field === "provider_tool_ids"
            ? { providerToolIds: ["valid_tool"] }
            : { toolIds: ["valid_tool"] },
        );
      }
    });

    it("does not scan object text after a malformed tool element", () => {
      const text = 'tools: [ invalid, {"id":"bogus_tool"}';

      const result = buildChildRunResultSummary(text, { mode: "structured" });

      assertEquals(result.contractFacts, undefined);
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
