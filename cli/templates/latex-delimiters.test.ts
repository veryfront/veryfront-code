import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl } from "#veryfront/compat/path";
import {
  MATH_SENTINEL,
  normalizeLatexDelimiters,
  readMathPayload,
} from "./files/ai-agent/app/latex-delimiters.ts";

/**
 * The scaffolded renderer cannot render maths without this pass, and each rule
 * below exists because the obvious implementation gets it wrong.
 *
 * The copy under test is `ai-agent`'s. A sibling test asserts every chat
 * starter ships an identical copy, so covering one covers all of them.
 */
describe("cli/templates latex delimiter normalisation", () => {
  it("parks inline and display maths in a code span the renderer decodes", () => {
    // `\(` and `\[` cannot be handled after parsing: CommonMark consumes the
    // backslash as a character escape, so the tree only ever sees `(`.
    const inline = normalizeLatexDelimiters("area is \\(\\pi r^2\\) exactly");
    assertEquals(inline, `area is \`${MATH_SENTINEL}i\\pi r^2\` exactly`);
    assertEquals(readMathPayload(`${MATH_SENTINEL}i\\pi r^2`), {
      tex: "\\pi r^2",
      display: false,
    });

    const display = normalizeLatexDelimiters("\\[x^2 + y^2 = z^2\\]");
    assertEquals(display, `\`${MATH_SENTINEL}dx^2 + y^2 = z^2\``);
    assertEquals(readMathPayload(`${MATH_SENTINEL}dx^2`), { tex: "x^2", display: true });
  });

  it("carries a dollar sign through untouched, escaped or not", () => {
    // This is the whole reason a code span is the carrier. `remark-math` ends an
    // expression at the first `$` and ignores `\$`, while KaTeX will only draw a
    // dollar from a literal one, so a `$`-delimited expression can never show
    // money. Models write `\$15.21` constantly.
    const escaped = normalizeLatexDelimiters("\\(84.50 \\times 0.18 = \\$15.21\\)");
    assertEquals(readMathPayload(escaped.slice(1, -1))?.tex, "84.50 \\times 0.18 = \\$15.21");

    const bare = normalizeLatexDelimiters("\\(\\textbf{ $99.71 }\\)");
    assertEquals(readMathPayload(bare.slice(1, -1))?.tex, "\\textbf{ $99.71 }");
  });

  it("leaves prose currency alone, because $ is not a delimiter", () => {
    const prose = "tip on $84.50 brings it to $99.71";
    assertEquals(normalizeLatexDelimiters(prose), prose);
  });

  it("leaves code untouched", () => {
    // A snippet that happens to contain `$` or `\(` must survive byte for byte,
    // in both fenced blocks and inline spans.
    const inline = 'run `price = "$5.00"` and `f(\\(x\\))`';
    assertEquals(normalizeLatexDelimiters(inline), inline);

    const fenced = '```js\nconst a = "$1.00";\nconst b = \\(x\\);\n```';
    assertEquals(normalizeLatexDelimiters(fenced), fenced);
  });

  it("treats an unterminated fence as code through end of input", () => {
    // CommonMark closes an open fence at end of document. Rewriting the tail as
    // prose would corrupt a snippet that is still being streamed in.
    const streaming = '```js\nconst price = "$5.00";';
    assertEquals(normalizeLatexDelimiters(streaming), streaming);
  });

  it("passes through text with neither maths nor currency", () => {
    const plain = "# Heading\n\nSome **bold** text with a [link](https://example.com).";
    assertEquals(normalizeLatexDelimiters(plain), plain);
  });

  it("ships an identical copy in every chat starter", async () => {
    // The rules above are only verified against `ai-agent`. Each starter is a
    // standalone scaffold with its own copy, so without this the other four
    // could drift and stay green.
    const templatesDir = fromFileUrl(new URL("./files/", import.meta.url));
    const expected = await Deno.readTextFile(`${templatesDir}ai-agent/app/latex-delimiters.ts`);

    const drifted: string[] = [];
    for await (const entry of Deno.readDir(templatesDir)) {
      if (!entry.isDirectory || entry.name === "ai-agent") continue;
      const renderer = `${templatesDir}${entry.name}/app/markdown-renderer.tsx`;
      if (!(await exists(renderer))) continue;

      const copy = `${templatesDir}${entry.name}/app/latex-delimiters.ts`;
      if (!(await exists(copy)) || (await Deno.readTextFile(copy)) !== expected) {
        drifted.push(entry.name);
      }
    }

    assertEquals(
      drifted.toSorted(),
      [],
      "these starters scaffold a Markdown renderer but their latex-delimiters.ts " +
        "is missing or differs from ai-agent's",
    );
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
