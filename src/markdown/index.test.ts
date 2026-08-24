import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as markdownModule from "./index.ts";
import * as publicMarkdownModule from "veryfront/markdown";
import * as markdownComponentModule from "#veryfront/react/components/chat/markdown.tsx";

const expectedRuntimeExports = [
  "Markdown",
  "MarkdownRendererCapabilityError",
  "MarkdownRendererProvider",
];

describe("markdown/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/markdown", () => {
    assertEquals(Object.keys(markdownModule).sort(), expectedRuntimeExports);
  });

  it("keeps the Markdown re-export wired to the source component module", () => {
    assertStrictEquals(markdownModule.Markdown, markdownComponentModule.Markdown);
    assertStrictEquals(
      markdownModule.MarkdownRendererProvider,
      markdownComponentModule.MarkdownRendererProvider,
    );
    assertStrictEquals(
      markdownModule.MarkdownRendererCapabilityError,
      markdownComponentModule.MarkdownRendererCapabilityError,
      "barrel must re-export the component error class, not a same-named copy",
    );
  });

  it("keeps the documented veryfront/markdown entrypoint aligned with the barrel module", () => {
    assertEquals(Object.keys(publicMarkdownModule).sort(), expectedRuntimeExports);
    assertStrictEquals(publicMarkdownModule.Markdown, markdownModule.Markdown);
    assertStrictEquals(
      publicMarkdownModule.MarkdownRendererCapabilityError,
      markdownComponentModule.MarkdownRendererCapabilityError,
      "veryfront/markdown must expose the same error class as the component module",
    );
  });
});
