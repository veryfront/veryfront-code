import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { analyzeContent, type ContentAnalysisResult } from "./index.ts";

function summarize(value: string, result: ContentAnalysisResult): unknown {
  assert(result.kind === "document");
  return {
    rendered: result.renderedRanges.map((range) =>
      value.slice(range.start.offset, range.end.offset)
    ),
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

describe("content analysis package boundary", () => {
  it("exposes Markdown destination analysis without the extension runtime", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `
          import { analyzeContent } from "@veryfront/ext-content-mdx/analysis";
          const result = await analyzeContent({
            value: "[Guide](../guides/start.md)",
            syntax: "markdown",
          });
          console.log(JSON.stringify(result));
        `,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(
      output.success,
      true,
      new TextDecoder().decode(output.stderr),
    );
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout)),
      {
        kind: "document",
        renderedRanges: [{
          start: { offset: 1, line: 1, column: 2 },
          end: { offset: 6, line: 1, column: 7 },
        }],
        destinations: [{
          kind: "markdown-link",
          rawValue: "../guides/start.md",
          range: {
            start: { offset: 8, line: 1, column: 9 },
            end: { offset: 26, line: 1, column: 27 },
          },
          syntax: "markdown",
        }],
      },
    );
  });
});

describe("analyzeContent Markdown", () => {
  it("returns links, images, and only used reference definitions", async () => {
    const value = "[Guide](../guides/start.md) ![Logo](../assets/logo.png)\n\n" +
      "[API][api]\n\n[api]: ../reference/api.md\n[unused]: ../unused.md";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      rendered: ["Guide", " ", "Logo", "API"],
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
      rendered: [
        "https://veryfront.com/docs/code/guides/start",
        " and ",
        "https://veryfront.com/docs/code/reference/api",
        ".",
      ],
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

  it("excludes frontmatter and code from rendered ranges", async () => {
    const value = "---\ntitle: https://frontmatter.invalid\n---\n\n" +
      "Visible `https://inline.invalid`\n\n" +
      "```ts\nhttps://fence.invalid\n```";

    const result = await analyzeContent({
      value,
      syntax: "markdown",
      frontmatter: true,
    });

    assertEquals(summarize(value, result), {
      rendered: ["Visible "],
      destinations: [],
    });
  });

  it("reads destination attributes only inside parser-reported raw HTML", async () => {
    const value = '<a href="../guides/start.md">Guide</a>\n\n' +
      '<img src="../assets/logo.png">\n\n' +
      "<form action='../submit'>x</form>";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      rendered: ["Guide", "x"],
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

  it("preserves authored Markdown escapes in destination values and ranges", async () => {
    const value = String.raw`[Guide](../guides/a\)b.md)`;

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      rendered: ["Guide"],
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
});
