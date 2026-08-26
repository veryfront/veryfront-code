import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  markdownPreviewOwnsDocumentPathname,
  ssrOwnsDocumentPathname,
} from "./document-ownership.ts";

describe("server/handlers/request/ssr/document-ownership", () => {
  it("owns extensionless document paths", () => {
    assertEquals(ssrOwnsDocumentPathname("/"), true, "the root document is SSR's");
    assertEquals(ssrOwnsDocumentPathname("/review"), true, "page slugs are SSR's");
    assertEquals(
      ssrOwnsDocumentPathname("/docs/getting-started"),
      true,
      "nested page slugs are SSR's",
    );
  });

  it("does not own extension paths served by other handlers", () => {
    assertEquals(
      ssrOwnsDocumentPathname("/notes.md"),
      false,
      "MarkdownPreviewHandler owns standalone markdown documents",
    );
    assertEquals(ssrOwnsDocumentPathname("/docs/readme.md"), false, "nested markdown too");
    assertEquals(ssrOwnsDocumentPathname("/logo.svg"), false, "static assets are not SSR's");
  });

  it("does not own /_ infrastructure paths", () => {
    assertEquals(
      ssrOwnsDocumentPathname("/_veryfront/rsc/probe"),
      false,
      "framework endpoints are excluded by SSR's route pattern",
    );
    assertEquals(ssrOwnsDocumentPathname("/_internal"), false, "every /_ path is excluded");
  });

  it("owns virtual .veryfront documents despite their dotted segments", () => {
    assertEquals(ssrOwnsDocumentPathname("/.veryfront/page.tsx"), true);
    assertEquals(ssrOwnsDocumentPathname("/project/.veryfront/page.tsx"), true);
  });

  it("identifies Markdown documents rendered as standalone HTML", () => {
    assertEquals(markdownPreviewOwnsDocumentPathname("/notes.md"), true);
    assertEquals(markdownPreviewOwnsDocumentPathname("/docs/readme.md"), true);
    assertEquals(markdownPreviewOwnsDocumentPathname("/pages/readme.md"), false);
    assertEquals(markdownPreviewOwnsDocumentPathname("/app/readme.md"), false);
    assertEquals(markdownPreviewOwnsDocumentPathname("/_internal/readme.md"), false);
    assertEquals(markdownPreviewOwnsDocumentPathname("/logo.svg"), false);
  });
});
