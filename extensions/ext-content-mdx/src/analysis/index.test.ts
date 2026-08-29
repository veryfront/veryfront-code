import {
  assert,
  assertEquals,
  assertLess,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { analyzeEmbeddedExpression, MAX_EMBEDDED_CODE_UNITS } from "./embedded-code.ts";
import { analyzeContent, type ContentAnalysisResult } from "./index.ts";
import { createSourceLocator } from "./source.ts";

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

describe("analyzeContent MDX parser boundaries", () => {
  it("bounds direct embedded analysis before tokenizing invalid syntax", async () => {
    const source = `'${"x".repeat(MAX_EMBEDDED_CODE_UNITS)}`;

    const result = await analyzeEmbeddedExpression({
      source,
      absoluteStart: 0,
      locator: createSourceLocator(source),
    });

    assertEquals(result, {
      kind: "syntax-error",
      diagnostic: {
        message: `Embedded code exceeds the ${MAX_EMBEDDED_CODE_UNITS}-unit parser limit`,
        range: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 0, line: 1, column: 1 },
        },
      },
    });
  });

  it("rejects oversized embedded source before tokenizing invalid syntax", async () => {
    const value = `{'${"x".repeat(MAX_EMBEDDED_CODE_UNITS)}}`;

    const result = await analyzeContent({ value, syntax: "mdx" });

    assertEquals(result, {
      kind: "syntax-error",
      diagnostic: {
        message: `Embedded code exceeds the ${MAX_EMBEDDED_CODE_UNITS}-unit parser limit`,
        range: {
          start: { offset: 1, line: 1, column: 2 },
          end: { offset: 1, line: 1, column: 2 },
        },
      },
    });
  });

  it("accepts embedded source at the parser limit", async () => {
    const value = `{"${"x".repeat(MAX_EMBEDDED_CODE_UNITS - 2)}"}`;

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
  });

  it("applies the parser limit to authored source instead of reduced code", async () => {
    const value = `{[${"<A/>,".repeat(10_000)}]}`;
    assertLess(value.length, MAX_EMBEDDED_CODE_UNITS);

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
  });

  it("does not count surrounding document text toward the embedded limit", async () => {
    const value = `{value}\n\n${"prose".repeat(MAX_EMBEDDED_CODE_UNITS)}`;

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
  });
});

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

  it("preserves authored email and www autolinks with parser-normalized URLs", async () => {
    const value = "<user@example.com> user@example.com www.example.com";

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
      [
        {
          rawValue: "user@example.com",
          normalizedValue: "mailto:user@example.com",
          source: "user@example.com",
        },
        {
          rawValue: "user@example.com",
          normalizedValue: "mailto:user@example.com",
          source: "user@example.com",
        },
        {
          rawValue: "www.example.com",
          normalizedValue: "http://www.example.com",
          source: "www.example.com",
        },
      ],
    );
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

  it("returns a syntax diagnostic for malformed YAML frontmatter", async () => {
    const value = "---\ntitle: ok\nitems:\n  - one\n  - [unterminated\n---\n";
    const result = await analyzeContent({
      value,
      syntax: "markdown",
      frontmatter: true,
    });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start, {
      offset: value.indexOf("[unterminated") + "[unterminated".length,
      line: 5,
      column: 18,
    });
    assertStringIncludes(result.diagnostic.message, "Invalid YAML frontmatter");
  });

  it("validates frontmatter recognized by the compiler before Markdown parsing", async () => {
    const value = "---\ntitle: [---\n[Visible](../visible.md)";
    const result = await analyzeContent({
      value,
      syntax: "markdown",
      frontmatter: true,
    });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start.line, 2);
    assertStringIncludes(result.diagnostic.message, "Invalid YAML frontmatter");
  });

  it("analyzes only the compiler-extracted Markdown body", async () => {
    const value = '---\nsummary: "[Hidden](../hidden.md)"---\n' +
      "[Visible](../visible.md)";
    const result = await analyzeContent({
      value,
      syntax: "markdown",
      frontmatter: true,
    });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../visible.md"],
    );
    assertEquals(result.destinations[0]?.range.start.line, 3);
  });

  it("accepts malformed bare-carriage-return frontmatter like the compiler", async () => {
    const result = await analyzeContent({
      value: "---\rtitle: [unterminated\r---\rVisible",
      syntax: "markdown",
      frontmatter: true,
    });

    assert(result.kind === "document");
  });

  it("accepts a malformed trailing-space frontmatter fence like the compiler", async () => {
    const value = "---\ntitle: [unterminated\n---   \n[Visible](../visible.md)";
    const result = await analyzeContent({
      value,
      syntax: "markdown",
      frontmatter: true,
    });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../visible.md"],
    );
  });

  it("maps YAML parser columns after non-BMP source characters", async () => {
    const value = "---\nvalue: [😀, }\n---\n";
    const result = await analyzeContent({
      value,
      syntax: "markdown",
      frontmatter: true,
    });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start, {
      offset: value.indexOf("}") + 1,
      line: 2,
      column: 14,
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

  it("returns form submission override destinations from HTML and JSX", async () => {
    const html = '<button formaction="../html-submit">Submit</button>';
    const jsx = '<Button formAction="../jsx-submit" />\n' +
      '{<button formAction={"../jsx-expression-submit"} />}';

    const htmlResult = await analyzeContent({ value: html, syntax: "markdown" });
    const jsxResult = await analyzeContent({ value: jsx, syntax: "mdx" });

    assert(htmlResult.kind === "document");
    assertEquals(
      htmlResult.destinations.map((destination) => destination.rawValue),
      ["../html-submit"],
    );
    assert(jsxResult.kind === "document");
    assertEquals(
      jsxResult.destinations.map((destination) => destination.rawValue),
      ["../jsx-submit", "../jsx-expression-submit"],
    );
  });

  it("preserves authored HTML offsets across CommonMark NUL normalization", async () => {
    const nul = "\0";
    const value = `<a href="../private${nul}.md">x</a>`;

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
        offset: destination.range.start.offset,
      })),
      [{
        rawValue: `../private${nul}.md`,
        normalizedValue: "../private\uFFFD.md",
        source: `../private${nul}.md`,
        offset: value.indexOf("../private"),
      }],
    );
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

  it("finds namespaced SVG destination attributes", async () => {
    const value = '<svg><a xlink:href="../svg.md">svg</a></svg>';

    const result = await analyzeContent({ value, syntax: "markdown" });

    assert(result.kind === "document");
    assertEquals(result.destinations, [{
      kind: "html-attribute",
      rawValue: "../svg.md",
      range: {
        start: { offset: 20, line: 1, column: 21 },
        end: { offset: 29, line: 1, column: 30 },
      },
      syntax: "html-attribute",
    }]);
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

  it("projects CommonMark-normalized HTML inside block containers", async () => {
    const nul = "\0";
    const value = "> <div>\n" +
      `> <a href="../private${nul}.md">x</a>\n` +
      "> </div>";

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
        offset: destination.range.start.offset,
      })),
      [{
        rawValue: `../private${nul}.md`,
        normalizedValue: "../private\uFFFD.md",
        source: `../private${nul}.md`,
        offset: value.indexOf("../private"),
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

  it("rejects JSX spread attributes without an operand", async () => {
    for (
      const value of [
        "<Card {...} />",
        "<Card {.../* note */} />",
        "{<Card {...} />}",
        "{<Card {.../* note */} />}",
      ]
    ) {
      const result = await analyzeContent({ value, syntax: "mdx" });

      assert(result.kind === "syntax-error");
      assertEquals(result.diagnostic.range.start.offset, value.indexOf("}"));
    }
  });

  it("rejects JSX spread attributes with extra operands", async () => {
    for (
      const value of [
        "<Card {...props, other} />",
        "{<Card {...props, other} />}",
        "{(function* () { return <Card {...yield source, other} /> })}",
      ]
    ) {
      const result = await analyzeContent({ value, syntax: "mdx" });

      assert(result.kind === "syntax-error");
      assertEquals(result.diagnostic.range.start.offset, value.indexOf(","));
    }
  });

  it("accepts JSX spread operands that depend on their enclosing context", async () => {
    for (
      const value of [
        "{(function* () { return <Card {...yield source} /> })}",
        "{(function () { return <Card {...new.target} /> })}",
        "{class A extends B { m() { return <Card {...super.x} /> } }}",
        "{class A { #f = 1; m() { return <Card {...this.#f} /> } }}",
      ]
    ) {
      const result = await analyzeContent({ value, syntax: "mdx" });

      assert(result.kind === "document");
    }
  });

  it("rejects a JSX spread operand used outside its enclosing construct", async () => {
    const result = await analyzeContent({ value: "<Card {...yield x} />", syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertStringIncludes(result.diagnostic.message, "yield");
  });

  it("uses MDX grammar for JSX expressions regardless of the source path", async () => {
    const result = await analyzeContent({
      value: "{<Card />}",
      syntax: "mdx",
      filePath: "content.txt",
    });

    assert(result.kind === "document");
  });

  it("rejects invalid expressions nested inside JSX before reduction", async () => {
    const value = "{<Card value={const x} />}";
    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start.offset, value.indexOf("const"));
  });

  it("rejects TypeScript-only syntax from authored MDX expressions", async () => {
    const value = "Before {value as string} after";

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertStringIncludes(result.diagnostic.message, "Unexpected");
  });

  it("rejects JavaScript proposals outside the MDX compiler grammar", async () => {
    const value = "{class { accessor value = source }}";

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
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

  it("returns React SVG xlinkHref destinations at every JSX depth", async () => {
    const value = '<svg><a xlinkHref="../top.md" /></svg>\n' +
      '{<svg><a xlinkHref={"../nested.md"} /></svg>}';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../top.md", "../nested.md"],
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

  it("rejects unexpected tokens in nested JSX tags", async () => {
    const value = '{<Card href=="../guide.md" />}';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start.offset, value.indexOf("=="));
  });

  it("rejects adjacent JSX elements in one embedded expression", async () => {
    const value = "{<One /><Two />}";

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start.offset, value.indexOf("<Two"));
  });

  it("accepts nested JSX spread attributes", async () => {
    const value = '{<Card {...props} href="../guide.md" />}';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../guide.md"],
    );
  });

  it("rejects empty JSX attribute expressions", async () => {
    for (
      const value of [
        "<Card href={} />",
        "<Card href={/* note */} />",
        "{<Card href={} />}",
        "{<Card href={/* note */} />}",
      ]
    ) {
      const result = await analyzeContent({ value, syntax: "mdx" });

      assert(result.kind === "syntax-error");
      assert(
        result.diagnostic.range.start.offset >= value.indexOf("{", value.indexOf("href")),
      );
    }
  });

  it("preserves namespaced JSX attribute names during destination analysis", async () => {
    const value = '{<Widget config:href="../private.md" href="../public.md" />}';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../public.md"],
    );
  });

  it("validates nested JSX expressions in their enclosing JavaScript context", async () => {
    const generator = "{(function* () { return <Card value={yield source} /> })}";
    const classBody = "{(class Child extends Parent { " +
      "#source = source; render() { return " +
      "<Card first={this.#source} second={super.source} />; } })}";

    const generatorResult = await analyzeContent({ value: generator, syntax: "mdx" });
    const classResult = await analyzeContent({ value: classBody, syntax: "mdx" });

    assert(generatorResult.kind === "document");
    assert(classResult.kind === "document");
  });

  it("returns a syntax diagnostic for malformed MDX YAML frontmatter", async () => {
    const value = "---\ntitle: [unterminated\n---\n<Card />";
    const result = await analyzeContent({
      value,
      syntax: "mdx",
      frontmatter: true,
    });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start, {
      offset: value.indexOf("[unterminated") + "[unterminated".length,
      line: 2,
      column: 21,
    });
    assertStringIncludes(result.diagnostic.message, "Invalid YAML frontmatter");
  });

  it("validates frontmatter recognized by the compiler before MDX parsing", async () => {
    const value = "---\ntitle: [---\n<Card />";
    const result = await analyzeContent({
      value,
      syntax: "mdx",
      frontmatter: true,
    });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start.line, 2);
    assertStringIncludes(result.diagnostic.message, "Invalid YAML frontmatter");
  });

  it("analyzes only the compiler-extracted MDX body", async () => {
    const value = "---\nsummary: \"<Broken href='../hidden.md'>\"---\n" +
      '<Card href="../visible.md" />';
    const result = await analyzeContent({
      value,
      syntax: "mdx",
      frontmatter: true,
    });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../visible.md"],
    );
    assertEquals(result.destinations[0]?.range.start.line, 3);
  });

  it("maps MDX body diagnostics through the compiler frontmatter boundary", async () => {
    const value = "---\ntitle: ok\n---\n<Card>text</Panel>";
    const result = await analyzeContent({
      value,
      syntax: "mdx",
      frontmatter: true,
    });

    assert(result.kind === "syntax-error");
    assertEquals(result.diagnostic.range.start.line, 4);
    assertEquals(
      result.diagnostic.range.start.offset,
      value.indexOf("</Panel>"),
    );
  });

  it("accepts malformed bare-carriage-return frontmatter like the compiler", async () => {
    const result = await analyzeContent({
      value: "---\rtitle: [unterminated\rsummary: '<a href=\"../hidden.md\">x</a>'\r---\r" +
        '<Card href="../visible.md" />',
      syntax: "mdx",
      frontmatter: true,
    });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../visible.md"],
    );
  });

  it("accepts a malformed trailing-space frontmatter fence like the compiler", async () => {
    const value = "---\ntitle: [unterminated\n---   \n" +
      '<Card href="../visible.md" />';
    const result = await analyzeContent({
      value,
      syntax: "mdx",
      frontmatter: true,
    });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../visible.md"],
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

  it("accepts expression nesting at the parser capacity", async () => {
    const depth = 64;
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

  it("ignores non-token braces when enforcing expression capacity", async () => {
    const braces = "{".repeat(128);
    const value = "```js\n" + braces + "\n```\n" +
      `<a data-ok={"${braces}"} href="../architecture/braces.md">ok</a>`;

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../architecture/braces.md"],
    );
  });

  it("bounds 4,000 nested JSX child expressions in the lexer", async () => {
    const depth = 4_000;
    const value = "<a data-ok={" +
      "<A>{".repeat(depth) +
      "value" +
      "}</A>".repeat(depth) +
      '} href="../architecture/deep-jsx.md">ok</a>';
    const startedAt = performance.now();

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertEquals(
      result.diagnostic.message,
      "Parser capacity exceeded for MDX structure",
    );
    assertEquals(
      result.diagnostic.range.start.offset,
      "<a data-ok={".length + "<A>{".repeat(65).length - 1,
    );
    assertLess(performance.now() - startedAt, 2_000);

    const following = await analyzeContent({
      value: '<a href="../architecture/after-capacity.md">ok</a>',
      syntax: "mdx",
    });
    assert(following.kind === "document");
    assertEquals(
      following.destinations.map((destination) => destination.rawValue),
      ["../architecture/after-capacity.md"],
    );
  });

  it("keeps enforcing expression capacity after contextual division", async () => {
    const depth = 1_000;
    const prefix = "<a data-ok={left / right ? <A>{ok}</A> : ";
    const value = prefix +
      "<A>{".repeat(depth) +
      "value" +
      "}</A>".repeat(depth) +
      '} href="../architecture/deep-jsx.md">ok</a>';
    const startedAt = performance.now();

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertEquals(
      result.diagnostic.message,
      "Parser capacity exceeded for MDX structure",
    );
    assertEquals(
      result.diagnostic.range.start.offset,
      prefix.length + "<A>{".repeat(65).length - 1,
    );
    assertLess(performance.now() - startedAt, 2_000);
  });

  it("accepts contextual division at the expression capacity boundary", async () => {
    const depth = 64;
    const value = "<a data-ok={left / right ? " +
      "<A>{".repeat(depth) +
      "value" +
      "}</A>".repeat(depth) +
      ' : null} href="../architecture/deep-jsx.md">ok</a>';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../architecture/deep-jsx.md"],
    );
  });

  it("bounds 1,600 nested JSX attribute expressions in the lexer", async () => {
    const depth = 1_600;
    const value = "<a data-ok={" +
      "<A value={".repeat(depth) +
      "null" +
      "} />".repeat(depth) +
      '} href="../architecture/deep-jsx-attributes.md">ok</a>';
    const startedAt = performance.now();

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertEquals(
      result.diagnostic.message,
      "Parser capacity exceeded for MDX structure",
    );
    assertLess(performance.now() - startedAt, 2_000);
  });

  it("rejects malformed nested JSX in parser-bounded time", async () => {
    const depth = 2_000;
    const value = "<a data-ok={" +
      "<A value={".repeat(depth) +
      "null}".repeat(depth) + ">";
    const startedAt = performance.now();

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertLess(performance.now() - startedAt, 2_000);
  });

  it("propagates unpositioned parser recursion failures", async () => {
    const depth = 12_000;
    const value = "<A>".repeat(depth) + "text" + "</A>".repeat(depth);

    await assertRejects(
      () => analyzeContent({ value, syntax: "mdx" }),
      RangeError,
    );
  });
});
