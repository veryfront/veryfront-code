import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { fromFileUrl } from "@std/path";
import { MISSING_MARKDOWN_RENDERER_WARNING } from "./missing-renderer-warning.ts";

/**
 * The warning's only escape hatch is the documentation link, so the whole link
 * has to resolve: the page and the fragment.
 *
 * The page is published from this repository's `docs/` tree under
 * `/docs/code/`, so the URL also names the file that has to carry the anchor.
 * Asserting the fragment against that file's headings -- rather than against a
 * second copy of the string -- means renaming the section fails here instead of
 * shipping a link that lands readers at the top of the article.
 */

/** Prefix under which veryfront-code's docs/ tree is published. */
const PUBLISHED_DOCS_PREFIX = "https://veryfront.com/docs/code/";

/** Repository root, resolved from this module so the process cwd cannot move it. */
const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

/**
 * Resolve a published docs URL back to the repository file behind it.
 * Deriving the path keeps the two in step: moving the guide without moving the
 * link fails this test.
 */
function localFileForDocsUrl(url: URL): string {
  const withoutFragment = `${url.origin}${url.pathname}`;
  assert(
    withoutFragment.startsWith(PUBLISHED_DOCS_PREFIX),
    `the warning must link into the published veryfront-code docs tree ` +
      `(${PUBLISHED_DOCS_PREFIX}...), got: ${withoutFragment}`,
  );
  return `${REPO_ROOT}docs/${withoutFragment.slice(PUBLISHED_DOCS_PREFIX.length)}.md`;
}

/**
 * Anchor ids the published page exposes. Headings are slugified to lowercase
 * hyphenated text.
 */
function anchorsIn(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split("\n")) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading) anchors.add(heading.toLowerCase().replace(/\s+/g, "-"));
  }
  return anchors;
}

/** The single link the warning ships. */
function warningLink(): URL {
  const links = MISSING_MARKDOWN_RENDERER_WARNING.match(/https:\/\/\S+/g) ?? [];
  assertEquals(
    links.length,
    1,
    `the warning must carry exactly one link, got: ${links.join(", ")}`,
  );
  return new URL(links[0] as string);
}

describe("missing Markdown renderer warning — documentation link", () => {
  it("points at the published chat-ui guide", () => {
    const link = warningLink();

    assertEquals(
      `${link.origin}${link.pathname}`,
      "https://veryfront.com/docs/code/guides/chat-ui",
      "`/docs/guides/chat-ui` is a 404; the guide is published under `/docs/code/`",
    );
  });

  it("names a section that exists in the guide it links to", async () => {
    const link = warningLink();
    const docFile = localFileForDocsUrl(link);
    const anchors = anchorsIn(await Deno.readTextFile(docFile));
    const fragment = decodeURIComponent(link.hash.replace(/^#/, ""));

    assert(fragment !== "", "the warning must deep-link to the renderer section, not the page top");
    assert(
      anchors.has(fragment),
      `no "#${fragment}" heading in ${docFile}. A reader following the warning lands at the ` +
        `top of the article instead of the section. Headings present: ` +
        `${[...anchors].join(", ")}`,
    );
  });
});
