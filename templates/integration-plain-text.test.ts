import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { htmlToPlainText as confluenceHtmlToPlainText } from "./integrations/confluence/files/lib/confluence-plain-text.ts";
import { htmlToPlainText as teamsHtmlToPlainText } from "./integrations/teams/files/lib/teams-plain-text.ts";

describe("integration template plain-text extraction", () => {
  it("does not turn nested Teams entities into literal markup", () => {
    assertEquals(
      teamsHtmlToPlainText("<p>Safe &amp;lt;script&amp;gt; text</p>"),
      "Safe &lt;script&gt; text",
    );
  });

  it("keeps adjacent Teams blocks separated and decodes apostrophes", () => {
    assertEquals(
      teamsHtmlToPlainText("<p>First.</p><p>Second&#39;s.</p>"),
      "First. Second's.",
    );
  });

  it("does not add whitespace between Teams inline markup and punctuation", () => {
    assertEquals(
      teamsHtmlToPlainText("<p>Hello <strong>world</strong>.</p>"),
      "Hello world.",
    );
  });

  it("does not turn nested Confluence entities into literal markup", () => {
    assertEquals(
      confluenceHtmlToPlainText("<p>Safe &amp;lt;script&amp;gt; text</p>"),
      "Safe &lt;script&gt; text",
    );
  });
});

Deno.test("plain-text extraction handles long unterminated tag runs without rescanning", () => {
  const input = "<".repeat(60_000);
  const start = performance.now();
  assertEquals(confluenceHtmlToPlainText(input), input);
  assertEquals(teamsHtmlToPlainText(input), input);
  assert(performance.now() - start < 2_000, "Malformed markup must complete within two seconds");
});
