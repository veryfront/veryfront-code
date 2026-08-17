import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { htmlToPlainText as confluenceHtmlToPlainText } from "./integrations/confluence/files/lib/plain-text.ts";
import { htmlToPlainText as teamsHtmlToPlainText } from "./integrations/teams/files/lib/plain-text.ts";

describe("integration template plain-text extraction", () => {
  it("does not turn nested Teams entities into literal markup", () => {
    assertEquals(
      teamsHtmlToPlainText("<p>Safe &amp;lt;script&amp;gt; text</p>"),
      "Safe &lt;script&gt; text",
    );
  });

  it("does not turn nested Confluence entities into literal markup", () => {
    assertEquals(
      confluenceHtmlToPlainText("<p>Safe &amp;lt;script&amp;gt; text</p>"),
      "Safe &lt;script&gt; text",
    );
  });
});
