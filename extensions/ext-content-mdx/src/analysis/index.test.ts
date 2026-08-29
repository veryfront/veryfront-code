import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { analyzeContent, type ContentAnalysisResult } from "./index.ts";

function summarize(value: string, result: ContentAnalysisResult): unknown {
  assert(result.kind === "document");
  return {
    destinations: result.destinations.map((destination) => ({
      kind: destination.kind,
      rawValue: destination.rawValue,
      source: value.slice(
        destination.range.start.offset,
        destination.range.end.offset,
      ),
      offset: destination.range.start.offset,
      line: destination.range.start.line,
      column: destination.range.start.column,
      syntax: destination.syntax,
    })),
  };
}

describe("analyzeContent Markdown", () => {
  it("returns links, images, and only used reference definitions", async () => {
    const value = "[Guide](../guides/start.md) ![Logo](../assets/logo.png)\n\n" +
      "[API][api]\n\n[api]: ../reference/api.md\n[unused]: ../unused.md";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      destinations: [
        {
          kind: "markdown-link",
          rawValue: "../guides/start.md",
          source: "../guides/start.md",
          offset: 8,
          line: 1,
          column: 9,
          syntax: "markdown",
        },
        {
          kind: "markdown-image",
          rawValue: "../assets/logo.png",
          source: "../assets/logo.png",
          offset: 36,
          line: 1,
          column: 37,
          syntax: "markdown",
        },
        {
          kind: "markdown-definition",
          rawValue: "../reference/api.md",
          source: "../reference/api.md",
          offset: 76,
          line: 5,
          column: 8,
          syntax: "markdown",
        },
      ],
    });
  });

  it("distinguishes URI and GFM bare autolinks from Markdown links", async () => {
    const value = "<https://veryfront.com/docs/code/guides/start> and " +
      "https://veryfront.com/docs/code/reference/api.";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      destinations: [
        {
          kind: "autolink",
          rawValue: "https://veryfront.com/docs/code/guides/start",
          source: "https://veryfront.com/docs/code/guides/start",
          offset: 1,
          line: 1,
          column: 2,
          syntax: "autolink",
        },
        {
          kind: "autolink",
          rawValue: "https://veryfront.com/docs/code/reference/api",
          source: "https://veryfront.com/docs/code/reference/api",
          offset: 51,
          line: 1,
          column: 52,
          syntax: "autolink",
        },
      ],
    });
  });

  it("excludes frontmatter and code from destinations", async () => {
    const value = "---\ntitle: https://frontmatter.invalid\n---\n\n" +
      "Visible `https://inline.invalid`\n\n" +
      "```ts\nhttps://fence.invalid\n```";

    const result = await analyzeContent({
      value,
      syntax: "markdown",
      frontmatter: true,
    });

    assertEquals(summarize(value, result), {
      destinations: [],
    });
  });

  it("reads destination attributes only inside parser-reported raw HTML", async () => {
    const value = '<a href="../guides/start.md">Guide</a>\n\n' +
      '<img src="../assets/logo.png">\n\n' +
      "<form action='../submit'>x</form>";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      destinations: [
        {
          kind: "html-attribute",
          rawValue: "../guides/start.md",
          source: "../guides/start.md",
          offset: 9,
          line: 1,
          column: 10,
          syntax: "html-attribute",
        },
        {
          kind: "html-attribute",
          rawValue: "../assets/logo.png",
          source: "../assets/logo.png",
          offset: 50,
          line: 3,
          column: 11,
          syntax: "html-attribute",
        },
        {
          kind: "html-attribute",
          rawValue: "../submit",
          source: "../submit",
          offset: 86,
          line: 5,
          column: 15,
          syntax: "html-attribute",
        },
      ],
    });
  });

  it("keeps raw-text HTML bodies and comments out of destination analysis", async () => {
    const value = '<script src="../loader.js">\n' +
      '<a href="../hidden.md">hidden</a>\n' +
      "</script>\n" +
      '<!-- <a href="../commented.md">commented</a> -->\n' +
      '<a href="../visible.md">visible</a>';

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../loader.js", "../visible.md"],
    );
  });

  it("uses HTML parser boundaries for attributes, comments, and opaque elements", async () => {
    const opaqueElements = ["iframe", "noembed", "noframes", "title", "xmp"];
    const value = '<div data-href="../metadata.md">\n' +
      '<!-- <a href="../commented.md">commented</a> -->\n' +
      '<a title=\'href="../quoted.md"\' href="../visible.md">visible</a>\n' +
      opaqueElements.map((tag) => `<${tag}><a href="../${tag}.md">hidden</a></${tag}>`).join("\n") +
      "\n<script>const marker = \"</scripture><a href='../script.md'>\";</script>\n" +
      '<a href="">empty</a>\n' +
      "</div>";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../visible.md"],
    );
  });

  it("preserves raw HTML source ranges inside block containers", async () => {
    const value = "> <div>\n" +
      '> <a href="../nested.md">nested</a>\n' +
      '> </div href="../ignored.md">';

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        rawValue: destination.rawValue,
        source: value.slice(
          destination.range.start.offset,
          destination.range.end.offset,
        ),
        offset: destination.range.start.offset,
        line: destination.range.start.line,
        column: destination.range.start.column,
      })),
      [{
        rawValue: "../nested.md",
        source: "../nested.md",
        offset: value.indexOf("../nested.md"),
        line: 2,
        column: 12,
      }],
    );
  });

  it("separates authored and normalized multiline HTML attributes", async () => {
    const value = '> <a href="../a\n> b.md">text</a>';

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        rawValue: destination.rawValue,
        normalizedValue: Reflect.get(destination, "normalizedValue"),
        source: value.slice(
          destination.range.start.offset,
          destination.range.end.offset,
        ),
      })),
      [{
        rawValue: "../a\n> b.md",
        normalizedValue: "../a\nb.md",
        source: "../a\n> b.md",
      }],
    );
  });

  it("projects parser-reported raw HTML destination ranges", async () => {
    const count = 32_000;
    const value = "> <div>\n" +
      Array.from(
        { length: count },
        (_, index) => `> <a href="../item/${index}.md">item</a>`,
      ).join("\n") +
      "\n> </div>";
    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(result.destinations.length, count);
    assertEquals(result.destinations[0]?.rawValue, "../item/0.md");
    assertEquals(result.destinations.at(-1)?.rawValue, `../item/${count - 1}.md`);
  });

  it("locates wrapped reference destinations inside block containers", async () => {
    const value = "[quoted] [listed]\n" +
      "> [quoted]:\n> ../quoted.md\n" +
      "- [listed]:\n  ../listed.md";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        rawValue: destination.rawValue,
        source: value.slice(
          destination.range.start.offset,
          destination.range.end.offset,
        ),
      })),
      [
        { rawValue: "../quoted.md", source: "../quoted.md" },
        { rawValue: "../listed.md", source: "../listed.md" },
      ],
    );
  });

  it("locates wrapped inline-link destinations inside block containers", async () => {
    const value = "> [guide](\n> ../guide.md\n> )";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        rawValue: destination.rawValue,
        source: value.slice(
          destination.range.start.offset,
          destination.range.end.offset,
        ),
        offset: destination.range.start.offset,
        line: destination.range.start.line,
        column: destination.range.start.column,
      })),
      [{
        rawValue: "../guide.md",
        source: "../guide.md",
        offset: value.indexOf("../guide.md"),
        line: 2,
        column: 3,
      }],
    );
  });

  it("locates wrapped image destinations inside block containers", async () => {
    const value = "> ![logo](\n> ../logo.png\n> )";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        rawValue: destination.rawValue,
        source: value.slice(
          destination.range.start.offset,
          destination.range.end.offset,
        ),
      })),
      [{ rawValue: "../logo.png", source: "../logo.png" }],
    );
  });

  it("preserves authored Markdown escapes in destination values and ranges", async () => {
    const value = String.raw`[Guide](../guides/a\)b.md)`;

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      destinations: [{
        kind: "markdown-link",
        rawValue: String.raw`../guides/a\)b.md`,
        source: String.raw`../guides/a\)b.md`,
        offset: 8,
        line: 1,
        column: 9,
        syntax: "markdown",
      }],
    });
  });

  it("uses parser-owned resource and reference delimiters", async () => {
    const value = '[Guide](./guide.md "see ]( details")\n\n' +
      String.raw`![first \] second [nested]](image.png)` + "\n\n" +
      "[API][api]\n\n" +
      "[api]: ./first.md\n" +
      "[api]: ../duplicate.md";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["./guide.md", "image.png", "./first.md"],
    );
  });

  it("reports ranges after every supported source line ending", async () => {
    const value = "[LF](./lf.md)\n[CR](./cr.md)\r[CRLF](./crlf.md)\r\n[End](./end.md)";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        rawValue: destination.rawValue,
        line: destination.range.start.line,
      })),
      [
        { rawValue: "./lf.md", line: 1 },
        { rawValue: "./cr.md", line: 2 },
        { rawValue: "./crlf.md", line: 3 },
        { rawValue: "./end.md", line: 4 },
      ],
    );
  });
});

describe("analyzeContent MDX", () => {
  it("keeps balanced invalid JavaScript as prose only in Markdown mode", async () => {
    const value = "Before {const =} after";

    const markdown = await analyzeContent({ value, syntax: "markdown" });
    const mdx = await analyzeContent({
      value,
      syntax: "mdx",
      filePath: "docs/example.mdx",
    });

    assertEquals(summarize(value, markdown), {
      destinations: [],
    });
    assert(mdx.kind === "syntax-error");
    assertEquals(mdx.diagnostic.range.start, {
      offset: 8,
      line: 1,
      column: 9,
    });
    assertStringIncludes(mdx.diagnostic.message, "Unexpected");
  });

  it("validates JSX spread attributes in their object-fragment grammar", async () => {
    const value = '<Card {...props} href="../guide.md" />';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../guide.md"],
    );
  });

  it("rejects TypeScript-only syntax from authored MDX expressions", async () => {
    const value = "Before {value as string} after";

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertStringIncludes(result.diagnostic.message, "Unexpected");
  });

  it("returns quoted and expression-backed static JSX destinations", async () => {
    const value = '<Card href="../a.md" src={"../b.png"} ' +
      "action={'../c'} data-template={`../d`} dynamic={target}>" +
      "Visible</Card>";

    const result = await analyzeContent({
      value,
      syntax: "mdx",
      filePath: "docs/example.mdx",
    });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        kind: destination.kind,
        rawValue: destination.rawValue,
        source: value.slice(
          destination.range.start.offset,
          destination.range.end.offset,
        ),
        syntax: destination.syntax,
      })),
      [
        {
          kind: "mdx-jsx-attribute",
          rawValue: "../a.md",
          source: "../a.md",
          syntax: "html-attribute",
        },
        {
          kind: "mdx-jsx-attribute",
          rawValue: "../b.png",
          source: "../b.png",
          syntax: "javascript-string",
        },
        {
          kind: "mdx-jsx-attribute",
          rawValue: "../c",
          source: "../c",
          syntax: "javascript-string",
        },
      ],
    );
  });

  it("returns parser-cooked values with distinct JavaScript literal syntax", async () => {
    const lineSeparator = "\u2028";
    const stringRaw = `../a\\${lineSeparator}.md`;
    const templateRaw = `../b\\${lineSeparator}.png`;
    const value = `<Card href={"${stringRaw}"} src={\`${templateRaw}\`} />`;

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        rawValue: destination.rawValue,
        syntax: destination.syntax,
        cookedValue: Reflect.get(destination, "cookedValue"),
      })),
      [
        {
          rawValue: stringRaw,
          syntax: "javascript-string",
          cookedValue: "../a.md",
        },
        {
          rawValue: templateRaw,
          syntax: "javascript-template",
          cookedValue: "../b.png",
        },
      ],
    );
  });

  it("finds static attributes on JSX nested inside an expression", async () => {
    const value = '<Card child={<Link href="../nested.md" />} />';
    const contextual = "{(() => { class Sample { static { {} /[}>]/.test(value) } } " +
      'return <Link href="../contextual.md" /> })()}';

    const result = await analyzeContent({ value, syntax: "mdx" });
    const contextualResult = await analyzeContent({
      value: contextual,
      syntax: "mdx",
    });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        kind: destination.kind,
        rawValue: destination.rawValue,
      })),
      [{ kind: "mdx-jsx-attribute", rawValue: "../nested.md" }],
    );
    assert(contextualResult.kind === "document");
    assertEquals(
      contextualResult.destinations.map((destination) => destination.rawValue),
      ["../contextual.md"],
    );
  });

  it("uses Acorn token boundaries for regexes, templates, and JSX attributes", async () => {
    const value = '<a data-ok={/[}>]/.test(value)} href="../regex.md">regex</a>\n' +
      '<a data-ok={`value ${input}` } href="../template.md">template</a>';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../regex.md", "../template.md"],
    );
  });

  it("retains URI autolinks alongside MDX JSX syntax", async () => {
    const value = "<https://veryfront.com/docs/code/guides/start> " +
      '<Card href="../guide.md" />';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      [
        "https://veryfront.com/docs/code/guides/start",
        "../guide.md",
      ],
    );
  });

  it("returns positioned diagnostics for malformed MDX structure and ESM", async () => {
    const mismatched = await analyzeContent({
      value: "<Card>text</Panel>",
      syntax: "mdx",
    });
    const invalidEsm = await analyzeContent({
      value: "export const value = ;\n\n# Heading",
      syntax: "mdx",
    });

    assert(mismatched.kind === "syntax-error");
    assertEquals(mismatched.diagnostic.range.start.line, 1);
    assertEquals(mismatched.diagnostic.range.start.column, 11);
    assertStringIncludes(mismatched.diagnostic.message, "closing tag");
    assert(invalidEsm.kind === "syntax-error");
    assertEquals(invalidEsm.diagnostic.range.start, {
      offset: 21,
      line: 1,
      column: 22,
    });
    assertStringIncludes(invalidEsm.diagnostic.message, "import/exports");
  });

  it("maps reduced-fragment diagnostics back to their authored source offsets", async () => {
    const documentValue = "Before\n{<Card /> +}\nafter";
    const attributeValue = "<Card href={target +} />";

    const documentResult = await analyzeContent({
      value: documentValue,
      syntax: "mdx",
    });
    const attributeResult = await analyzeContent({
      value: attributeValue,
      syntax: "mdx",
    });

    assert(documentResult.kind === "syntax-error");
    assertEquals(documentResult.diagnostic.range.start, {
      offset: documentValue.indexOf("}"),
      line: 2,
      column: 12,
    });
    assert(attributeResult.kind === "syntax-error");
    assertEquals(attributeResult.diagnostic.range.start, {
      offset: attributeValue.indexOf("}"),
      line: 1,
      column: attributeValue.indexOf("}") + 1,
    });
  });

  it("analyzes 4,000 nested JSX children without recursive parsing", async () => {
    const depth = 4_000;
    const value = "<a data-ok={" +
      "<A>{".repeat(depth) +
      "value" +
      "}</A>".repeat(depth) +
      '} href="../architecture/deep-jsx.md">ok</a>';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../architecture/deep-jsx.md"],
    );
  });

  it("analyzes 1,600 nested JSX attribute expressions without fallback", async () => {
    const depth = 1_600;
    const value = "<a data-ok={" +
      "<A value={".repeat(depth) +
      "null" +
      "} />".repeat(depth) +
      '} href="../architecture/deep-jsx-attributes.md">ok</a>';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../architecture/deep-jsx-attributes.md"],
    );
  });

  it("rejects malformed nested JSX in parser-bounded time", async () => {
    const depth = 2_000;
    const value = "<a data-ok={" +
      "<A value={".repeat(depth) +
      "null}".repeat(depth) + ">";

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
  });
});
