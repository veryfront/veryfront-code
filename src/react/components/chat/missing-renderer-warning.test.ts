import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { MISSING_MARKDOWN_RENDERER_WARNING } from "./missing-renderer-warning.ts";

/**
 * The warning's only escape hatch is the documentation link, so the link has to
 * resolve. The published guide lives under `/docs/code/guides/chat-ui` and the
 * Markdown section on that page is "Render Markdown directly"
 * (`#render-markdown-directly`); `/docs/guides/chat-ui` is a 404.
 */
describe("missing Markdown renderer warning — documentation link", () => {
  it("carries exactly one link, and it is the published chat-ui guide", () => {
    const links = MISSING_MARKDOWN_RENDERER_WARNING.match(/https:\/\/\S+/g) ?? [];

    assertEquals(links, [
      "https://veryfront.com/docs/code/guides/chat-ui#render-markdown-directly",
    ]);
  });
});
