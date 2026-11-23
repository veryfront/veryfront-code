import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { runKnowledgeParser } from "../../../cli/commands/knowledge/parser.ts";

const markdownFormats = ["md", "pdf", "html", "docx"];
const table = "Name | Value\n--- | ---\n";

// Expected titles follow remark-parse 11 + remark-gfm 4, used by the renderer.
const fixtures = [
  {
    name: "tab-indented consumed definition destination is not a header",
    body: "[ref]:\n\t/url\n| --- |\nTitle\n===\n\n# Fallback\n",
    title: "| --- | Title",
    formats: markdownFormats,
  },
  {
    name: "consumed definition title retains its physical indentation",
    body: '[ref]: /url\n    "title"\n| --- |\nTitle\n===\n\n# Fallback\n',
    title: "| --- | Title",
    formats: markdownFormats,
  },
  {
    name: "three-space definition destination remains an eligible header",
    body: "[ref]:\n   /url\n| --- |\nCell\n===\n\n# Fallback\n",
    title: "Fallback",
    formats: markdownFormats,
  },
  {
    name: "closing HTML table header retains HTML precedence",
    body: "Intro\n</span>\n| --- |\n    code\nTitle\n===\n\n# Fallback\n",
    title: "Fallback",
    formats: markdownFormats,
  },
  {
    name: "incomplete HTML header remains ordinary table text",
    body: "Intro\n<span>text\n| --- |\n    code\nTitle\n===\n\n# Fallback\n",
    title: "Title",
    formats: markdownFormats,
  },
  {
    name: "new blank quote consumes an empty-item interruption context",
    body: "-\n>\n\n    code\n2. Title\n===\n\n# Fallback\n",
    title: "2. Title",
    formats: markdownFormats,
  },
  {
    name: "ordered empty item and new quoted blank scope code independently",
    body: "1.\n>   \n\n    code\n2. Title\n===\n\n# Fallback\n",
    title: "2. Title",
    formats: markdownFormats,
  },
  {
    name: "nested quote closure removes inactive first-code scope",
    body: "> > -\n> >\n\n    code\n2. Title\n===\n\n# Fallback\n",
    title: "2. Title",
    formats: markdownFormats,
  },

  {
    name: "last definition physical line keeps its table indentation",
    body: "[ref]:\n    /url\n| --- |\nTitle\n===\n\n# Fallback\n",
    title: "| --- | Title",
    formats: markdownFormats,
  },
  {
    name: "complete HTML header wins over GFM table",
    body: "Intro\n<span>\n| --- |\n    code\nTitle\n===\n\n# Fallback\n",
    title: "Fallback",
    formats: markdownFormats,
  },
  {
    name: "inactive code context closes with its quote owner",
    body: "> -\n>\n\n    code\n2. Title\n===\n\n# Fallback\n",
    title: "2. Title",
    formats: markdownFormats,
  },

  {
    name: "a later definition-shaped header retains table precedence",
    body: "[old]: /old\n[ref]: /url\n| --- |\nCell\n===\n\n# Real title\n",
    title: "Real title",
    formats: markdownFormats,
  },
  {
    name: "quoted definition-shaped table owns its body",
    body: "> [ref]: /url\n> | --- |\n> Cell\n> ===\n\n# Real title\n",
    title: "Real title",
    formats: markdownFormats,
  },
  {
    name: "list definition-shaped table owns its body",
    body: "- [ref]: /url\n  | --- |\n  Cell\n  ===\n\n# Real title\n",
    title: "Real title",
    formats: markdownFormats,
  },
  {
    name: "multiline definition destination can be a table header",
    body: "[ref]:\n/url\n| --- |\nCell\n===\n\n# Real title\n",
    title: "Real title",
    formats: markdownFormats,
  },
  {
    name: "a closing definition title line can be a table header",
    body: '[ref]: /url "\nA | B\nend"\n| --- |\nCell\n===\n\n# Real title\n',
    title: "Real title",
    formats: markdownFormats,
  },
  {
    name: "a multiline single quoted definition cannot consume a table",
    body: "[ref]: /url '\nA | B\n--- | ---\nend'\n> -\nTitle\n===\n",
    title: "Title",
    formats: markdownFormats,
  },

  {
    name: "definition-shaped table header wins over reference stripping",
    body: "[ref]: /url\n| --- |\nCell\n===\n\n# Real title\n",
    title: "Real title",
    formats: markdownFormats,
  },
  {
    name: "table interrupts an open multiline definition title",
    body: '[ref]: /url "\nA | B\n--- | ---\nend"\n> -\nTitle\n===\n',
    title: "Title",
    formats: markdownFormats,
  },

  {
    name: "table exit marker applies only to its first header 0",
    body: '> A | B\n> --- | ---\n  "title"\nA | B\n--- | ---\n===\n',
    title: "document",
    formats: markdownFormats,
  },
  {
    name: "table exit marker applies only to its first header 1",
    body: '> - A | B\n>   --- | ---\n  "title"\nA | B\n--- | ---\n===\n',
    title: "document",
    formats: markdownFormats,
  },
  {
    name: "table exit marker applies only to its first header 2",
    body: "> A | B\n> --- | ---\n  /url\nA | B\n--- | ---\n===\n",
    title: "document",
    formats: markdownFormats,
  },

  {
    name: "table exit keeps body delimiters in ordinary paragraph",
    body: "> A | B\n> --- | ---\nA | B\n--- | ---\nTitle\n===\n# Fallback\n",
    title: "A | B --- | --- Title",
    formats: markdownFormats,
  },
  {
    name: "table exit paragraph can end with a Setext H2",
    body: "> A | B\n> --- | ---\n  A | B\n--- | ---\n-\n    code\nTitle\n===\n",
    title: "Title",
    formats: markdownFormats,
  },
  {
    name: "quoted table exit can close a paragraph before root H1",
    body: "> - A | B\n>   --- | ---\n> A | B\n> --- | ---\n> -\nTitle\n===\n",
    title: "Title",
    formats: markdownFormats,
  },
  {
    name: "new quote after list table opens independent table",
    body: "- A | B\n  --- | ---\n> A | B\n> --- | ---\n<span>\n# Title\n",
    title: "document",
    formats: markdownFormats,
  },
  {
    name: "empty quoted item closes on a tab blank",
    body: "> -\n>\t\n>     code\nTitle\n===\n# Fallback\n",
    title: "Title",
    formats: markdownFormats,
  },
  {
    name: "empty ordered item closes before first code",
    body: "2.\n  \n    code\n> -\nTitle\n===\n# Fallback\n",
    title: "Title",
    formats: markdownFormats,
  },
  {
    name: "new code owner after empty item has active interruption",
    body: "-\n\n>     code\n> -\nTitle\n===\n# Fallback\n",
    title: "Fallback",
    formats: markdownFormats,
  },

  {
    name: "table owner changes from quote to root",
    title: "Title",
    body: "> A | B\n> --- | ---\nA | B\n--- | ---\n<span>\n# Title\n",
    formats: markdownFormats,
  },
  {
    name: "table owner changes from list to quote",
    title: "Fallback",
    body: "> - A | B\n>   --- | ---\n> A | B\n> --- | ---\nTitle\n===\n# Fallback\n",
    formats: markdownFormats,
  },

  {
    title: "Title",
    name: "empty list closes before first code block",
    body: "-\n\n    code\n> -\nTitle\n===\n# Fallback\n",
    formats: markdownFormats,
  },
  {
    title: "Title",
    name: "quoted empty item closes on indented blank",
    body: "> -\n>   \n>     code\nTitle\n===\n# Fallback\n",
    formats: markdownFormats,
  },

  {
    name: "quoted tab blank does not create code",
    body: ">\t\n> +\nTitle\n===\n\n# Fallback\n",
    title: "Title",
    formats: markdownFormats,
  },
  {
    name: "closed quote code refresh survives a blank code line",
    body: ">\n    code\n    \n    next\n2. Report\n===\n\n# Fallback\n",
    title: "2. Report",
    formats: markdownFormats,
  },
  {
    name: "closed quote first code line preserves inactive context",
    body: ">\n    code\n2. Report\n===\n\n# Fallback\n",
    title: "Fallback",
    formats: markdownFormats,
  },
  {
    name: "list reference lookahead honors resumed lazy HTML",
    body: "> - [ref]:\n<span>\nTitle\n===\n\n# Fallback\n",
    title: "Title",
    formats: markdownFormats,
  },
  {
    name: "reference destination with incomplete HTML remains valid",
    body: "> [ref]:\n<span>text\nTitle\n===\n\n# Fallback\n",
    title: "Fallback",
    formats: markdownFormats,
  },
  {
    name: "root continued code keeps noninitial ordered marker as text",
    body: "    code\n    next\n2. Report\n===\n\n# Fallback\n",
    title: "2. Report",
    formats: markdownFormats,
  },

  {
    name: "quoted blank content does not open indented code",
    body: ">     \n> -\nTitle\n===\n\n# Fallback\n",
    title: "Title",
    formats: markdownFormats,
  },
  {
    name: "continued code refreshes interruption after a closed quote",
    body: ">\n    code\n    next\n2. Report\n===\n\n# Fallback\n",
    title: "2. Report",
    formats: markdownFormats,
  },
  {
    name: "definition lookahead honors lazy quoted HTML",
    body: "> [ref]:\n<span>\nTitle\n===\n\n# Fallback\n",
    title: "Title",
    formats: markdownFormats,
  },

  {
    "name": "lazy header and resumed quoted delimiter share an actual table owner",
    "body": "> intro\nA | B\n> --- | ---\nTitle\n===\n# Fallback\n",
    "title": "Title",
    formats: markdownFormats,
  },
  {
    "name": "lazy table header can end before root indented code",
    "body": "> intro\nA | B\n> --- | ---\n    code\nTitle\n===\n# Fallback\n",
    "title": "Title",
    formats: markdownFormats,
  },
  {
    "name": "new quoted code opens its own active context after closing a list",
    "body": "- -\n>     text\n> -\nTitle\n===\n# Fallback\n",
    "title": "Fallback",
    formats: markdownFormats,
  },
  {
    "name": "quoted blank line retains optional list indentation",
    "body": "> - Item\n>\n>   Paragraph\n> ===\nNot a heading\n===\n\n# Real title\n",
    "title": "Real title",
    formats: markdownFormats,
  },
  {
    "name": "active code interruption keeps an empty marker as paragraph text",
    "body": "    example\n-\n  # Nested title\n\n# Real title\n",
    "title": "Nested title",
    formats: markdownFormats,
  },
  {
    "name": "quoted definition followed by thematic break closes its paragraph",
    "body": "> [ref]: /url\n> ---\nReal title\n===\n\n# Later title\n",
    "title": "Real title",
    formats: markdownFormats,
  },
  {
    "name": "list owned incomplete definition cannot create root H1",
    "body": '    code\n\t\n- -\n[ref]: /url "\n  # Real title\n',
    "title": "document",
    formats: markdownFormats,
  },
  {
    "name": "review owner stack: indented code after a closed quote",
    "body": ">\n    code\n> -\nTitle\n===\n",
    "title": "Title",
    formats: markdownFormats,
  },
  {
    "name": "review owner stack: new quote inside a new list",
    "body": "Intro\n- > -\ntext\n> -\nTitle\n===\n",
    "title": "Title",
    formats: markdownFormats,
  },
  {
    "name": "review owner stack: new quote inside a new quoted list",
    "body": "Intro\n> - > -\ntext\n> -\nTitle\n===\n",
    "title": "Title",
    formats: markdownFormats,
  },
  {
    "name": "review owner stack: nested list after indented code",
    "body": "    code\n- -\nIntro\n- -\ntext\n===\n",
    "title": "text",
    formats: markdownFormats,
  },
  {
    "name": "review owner stack: list-owned table-like text after indented code",
    "body": "    code\n- -\nA | B\n--- | ---\n    code\nTitle\n===\n",
    "title": "document",
    formats: markdownFormats,
  },
  {
    "name": "review owner stack: list-and-quote-owned table-like text before HTML",
    "body": "Intro\n- > -\nA | B\n--- | ---\n<span>\n# Fallback\n",
    "title": "Fallback",
    formats: markdownFormats,
  },
  {
    "name": "review owner stack: resumed quoted prose is not a root table",
    "body": "> > text\n> <span>\n> text\nA | B\n--- | ---\n    code\nTitle\n===\n",
    "title": "document",
    formats: markdownFormats,
  },
  ...["<span>", "</span>", "<custom-element>"].map((tag) => ({
    name: `table ends before complete HTML tag ${tag}`,
    body: `${table}${tag}\n# Hidden heading\n\n# Actual title\n`,
    title: "Actual title",
    formats: markdownFormats,
  })),
  ...["    ", "\t"].map((indent) => ({
    name: `table ends before code indentation ${JSON.stringify(indent)}`,
    body: `${table}${indent}code\n2. Report\n===\n# Actual title\n`,
    title: "2. Report",
    formats: markdownFormats,
  })),
  ...["-", "+", "*", "2.", "2)", "> -", "> > -"].map((marker) => ({
    name: `quote inherits paragraph interruption for ${marker}`,
    body: `Intro\n> ${marker}\ntext\n===\n# Actual title\n`,
    title: "Actual title",
    formats: [...markdownFormats, "mdx"],
  })),
  {
    name: "leaving a list does not inherit its paragraph interruption state",
    body: "- Intro\n> -\ntext\n===\n# Actual title\n",
    title: "text",
    formats: [...markdownFormats, "mdx"],
  },
  {
    name: "root definition retains interruption rules on quote entry",
    body: "[ref]: /url\n> -\ntext\n===\n# Actual title\n",
    title: "Actual title",
    formats: [...markdownFormats, "mdx"],
  },
  {
    name: "new nested quote inherits the matched outer paragraph interruption",
    body: "> Note\n> > *\ncontinued\n===\n# Actual title\n",
    title: "Actual title",
    formats: [...markdownFormats, "mdx"],
  },
  ...["- -", "1. -", "- 2."].map((marker) => ({
    name: `nested marker retains the interrupted paragraph ownership ${marker}`,
    body: `Intro\n${marker}\ncontinued\n> -\nTitle\n===\n# Fallback\n`,
    title: "Title",
    formats: markdownFormats,
  })),
  {
    name: "list-owned table-like text does not become a root table",
    body: "Intro\n1. -\nName | Value\n--- | ---\n    code\nTitle\n===\n# Actual\n",
    title: "Actual",
    formats: markdownFormats,
  },
  {
    name: "nested list retains the inherited quoted paragraph",
    body: "Intro\n> -\n>   1. -\n>     text\nTitle\n===\n# Fallback\n",
    title: "Fallback",
    formats: markdownFormats,
  },
  ...["", "\n"].map((blank) => ({
    name: `indented code inherits interruption into quote before ${JSON.stringify(blank)}`,
    body: `    code\n${blank}> -\ncontinued\n> -\nTitle\n===\n# Fallback\n`,
    title: "Title",
    formats: markdownFormats,
  })),
  {
    name: "fenced code does not inherit the indented code interruption state",
    body: "```\ncode\n```\n> -\ncontinued\n> -\nTitle\n===\n# Fallback\n",
    title: "Fallback",
    formats: markdownFormats,
  },
  {
    name: "nested marker keeps its following H1 list-owned without a root title",
    body: "Intro\n- -\ntext\n  # Real title\n",
    title: "document",
    formats: markdownFormats,
  },
  {
    name: "blank line ends inherited interruption state",
    body: "Intro\n\n> -\ntext\n===\n# Actual title\n",
    title: "text",
    formats: [...markdownFormats, "mdx"],
  },
  ...["1. item", "- item"].map((marker) => ({
    name: `nonempty interrupting list remains owned inside quote ${marker}`,
    body: `Intro\n> ${marker}\ntext\n===\n# Actual title\n`,
    title: "Actual title",
    formats: [...markdownFormats, "mdx"],
  })),
  {
    name: "MDX retains its disabled indented-code rule after tables",
    body: `${table}    code\n2. Report\n===\n# Actual title\n`,
    title: "Actual title",
    formats: ["mdx"],
  },
  {
    name: "inherited empty marker keeps lazy HTML inside the quoted paragraph",
    body: "Intro\n> -\ntext\n<span>\n# Actual title\n",
    title: "Actual title",
    formats: markdownFormats,
  },
];

describe("knowledge parser block boundaries", () => {
  for (const [index, fixture] of fixtures.entries()) {
    it(fixture.name, async () => {
      const root = await makeTempDir({ prefix: "knowledge-block-boundary-" });
      try {
        for (const extension of fixture.formats) {
          const filePath = join(root, `document.${extension}`);
          await Deno.writeTextFile(filePath, fixture.body);
          const result = await runKnowledgeParser({
            filePath,
            outputDir: join(root, `out-${index}-${extension}`),
          }, { extractDocumentText: () => Promise.resolve(fixture.body) });
          assertEquals(result.title, fixture.title, `${fixture.name} (${extension})`);
          const output = await Deno.readTextFile(result.sandbox_output_path);
          assertEquals(output.endsWith(fixture.body), true);
          assertEquals(output.includes("# document\n"), fixture.title === "document");
        }
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});
