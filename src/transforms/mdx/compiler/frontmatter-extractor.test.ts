import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractFrontmatter, mergeFrontmatter } from "./frontmatter-extractor.ts";

describe("transforms/mdx/compiler/frontmatter-extractor", () => {
  it("extracts leading YAML after a UTF-8 byte-order mark", () => {
    const result = extractFrontmatter(
      "\uFEFF---\ntitle: YAML title\n---\n# Content",
    );

    assertEquals(result.frontmatter, { title: "YAML title" });
    assertEquals(result.body.trim(), "# Content");
  });

  it("leaves non-leading delimiters and export-shaped content untouched", () => {
    const content = [
      "# Content",
      "---",
      'export const title = "Rendered example";',
    ].join("\n");

    assertEquals(extractFrontmatter(content), {
      body: content,
      frontmatter: {},
    });
  });

  it("merges provided values after YAML values", () => {
    const result = extractFrontmatter(
      "---\ntitle: YAML title\n---\n# Content",
      { title: "Provided title", author: "Ada" },
    );

    assertEquals(result.frontmatter, {
      title: "Provided title",
      author: "Ada",
    });
  });

  it("rejects accessor-backed values without invoking accessors", () => {
    let reads = 0;
    const provided = {};
    Object.defineProperty(provided, "title", {
      enumerable: true,
      get() {
        reads++;
        return "Hidden";
      },
    });

    assertThrows(
      () => extractFrontmatter("# Content", provided),
      TypeError,
      "must be a data property",
    );
    assertEquals(reads, 0);
  });

  it("copies __proto__ as data without mutating the result prototype", () => {
    const provided = Object.create(null) as Record<string, unknown>;
    provided.__proto__ = "metadata";

    const result = extractFrontmatter("# Content", provided);

    assertEquals(Object.getPrototypeOf(result.frontmatter), Object.prototype);
    assertEquals(result.frontmatter.__proto__, "metadata");
  });

  it("rejects enumerable symbol keys when merging records", () => {
    const source = { [Symbol("metadata")]: "hidden" };

    assertThrows(
      () => mergeFrontmatter([source, "Metadata"]),
      TypeError,
      "cannot contain enumerable symbol keys",
    );
  });
});
