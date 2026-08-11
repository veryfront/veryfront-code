import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { MISSING_MARKDOWN_RENDERER_WARNING } from "./missing-renderer-warning.ts";

/**
 * The warning's only escape hatch is the documentation link, so the link has to
 * resolve. The published guide lives under `/docs/code/guides/chat-ui` and the
 * Markdown section on that page is "Render Markdown directly"
 * (`#render-markdown-directly`); `/docs/guides/chat-ui` is a 404.
 */
describe("missing Markdown renderer warning — documentation link", () => {
  it("points at the published chat-ui guide, not the legacy 404 path", () => {
    assertStringIncludes(
      MISSING_MARKDOWN_RENDERER_WARNING,
      "https://veryfront.com/docs/code/guides/chat-ui#render-markdown-directly",
    );
    assert(
      !MISSING_MARKDOWN_RENDERER_WARNING.includes("https://veryfront.com/docs/guides/"),
      "the warning must not link under /docs/, which 404s; guides live under /docs/code/",
    );
  });
});
