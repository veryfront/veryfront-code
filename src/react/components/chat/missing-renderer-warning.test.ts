import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { MISSING_MARKDOWN_RENDERER_WARNING } from "./missing-renderer-warning.ts";

/**
 * The warning's only escape hatch is the documentation link, so the link has to
 * resolve. The published guide lives under `/docs/code/guides/chat-ui`
 * (`/docs/guides/chat-ui` is a 404), and the fragment has to track the heading
 * in this repo's `docs/guides/chat-ui.md`, which is the source the published
 * site is generated from: "## Render Markdown in chat" slugs to
 * `#render-markdown-in-chat`.
 */
describe("missing Markdown renderer warning — documentation link", () => {
  it("carries exactly one link, and it is the published chat-ui guide", () => {
    const links = MISSING_MARKDOWN_RENDERER_WARNING.match(/https:\/\/\S+/g) ?? [];

    assertEquals(links, [
      "https://veryfront.com/docs/code/guides/chat-ui#render-markdown-in-chat",
    ]);
  });
});
