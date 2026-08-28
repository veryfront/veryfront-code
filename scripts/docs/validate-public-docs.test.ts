import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectIssues,
  collectUnpublishedLinkIssues,
  destinations,
  publishedTargetCandidates,
  publishedTargetExists,
} from "./validate-public-docs.ts";

const BLOCKED_REPOSITORY = "example-org/private-examples";

function publishedFiles(...paths: string[]) {
  const suffixes = paths.map((path) => `/${path}`);
  return (path: string): { readonly isFile: boolean } => {
    if (suffixes.some((suffix) => path.endsWith(suffix))) {
      return { isFile: true };
    }
    throw new Error("missing fixture");
  };
}

describe("public docs validation", () => {
  it("parses balanced and escaped inline link labels", () => {
    assertEquals(
      destinations(
        "[nested [label]](../architecture/nested.md) and " +
          String.raw`[escaped \] label](../architecture/escaped.md)`,
      ),
      ["../architecture/nested.md", "../architecture/escaped.md"],
    );
  });

  it("parses balanced and escaped reference definition labels", () => {
    assertEquals(
      destinations(
        "[use][nested [label]]\n" +
          "[nested [label]]: ../architecture/nested.md",
      ),
      ["../architecture/nested.md"],
    );
    assertEquals(
      destinations(
        String.raw`[use][escaped \] label]` + "\n" +
          String.raw`[escaped \] label]: ../architecture/escaped.md`,
      ),
      ["../architecture/escaped.md"],
    );
    assertEquals(
      destinations("[ſ]\n[s]: ../architecture/case-folded.md"),
      ["../architecture/case-folded.md"],
    );
  });

  it("parses quoted HTML anchors and angle-bracket destinations", () => {
    assertEquals(
      destinations(
        '<a href="../architecture/html.md">HTML</a> ' +
          "[Markdown](<../architecture/markdown.md>)",
      ),
      ["../architecture/markdown.md", "../architecture/html.md"],
    );
  });

  it("parses static sources but not hyphenated href attributes", () => {
    assertEquals(
      destinations(
        '<img src="../architecture/image.png"> ' +
          '<div data-href="../architecture/data.md"></div>\n' +
          'Configure href="../architecture/prose.md" for the sample.\n' +
          "<a title=\"sample href='../architecture/title.md' text\">safe</a>\n" +
          '<div title="[old](../architecture/title-link.md)"></div>\n' +
          '<div title={"[old](../architecture/expression.md)"}></div>\n' +
          "<Code value={'Configure href=\"../architecture/string.md\"'} />\n" +
          '<div title={"<https://veryfront.com/docs/code/architecture/private>"}></div>\n' +
          String.raw`\<a href="../architecture/escaped.md">literal</a>` +
          "\n" +
          String.raw`\\<a href="../architecture/real.md">real</a>`,
      ),
      ["../architecture/image.png", "../architecture/real.md"],
    );
  });

  it("ignores escaped Markdown link openers", () => {
    assertEquals(
      destinations(String.raw`\[example](../architecture/private.md)`),
      [],
    );
  });

  it("requires a closing inline-link delimiter", () => {
    assertEquals(
      destinations(
        "[plain](./does-not-exist.md\n" +
          "[wrapped](<./also-missing.md>\n" +
          "[paragraph](\n\n../architecture/paragraph.md)\n" +
          "[reference]\n[reference]: <../architecture/reference.md",
      ),
      [],
    );
  });

  it("rejects deleted section READMEs with queries", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[concept index](../concepts/README.md?view=1)",
    );

    assertEquals(issues.length, 1);
  });

  it("validates documentation boundaries from the public README", () => {
    const issues = collectUnpublishedLinkIssues(
      "README.md",
      "[private](docs/architecture/private.md) " +
        "[license](./LICENSE)",
    );

    assertEquals(issues.length, 1);
    assertEquals(
      issues[0]?.message.includes("docs/architecture/private.md"),
      true,
    );
  });

  it("rejects browser-normalized traversal paths", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      String.raw`[windows](..\architecture\private.md)` + "\n" +
        "[encoded](.%2e/architecture/private.md)",
    );

    assertEquals(issues.length, 2);
    assertEquals(
      issues.map((issue) =>
        issue.message.includes("docs/architecture/private.md")
      ),
      [true, true],
    );
  });

  it("renormalizes encoded separators before checking file existence", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[separator](..%2farchitecture/29-environment-access-gate.md)\n" +
        "[encoded](%2e%2e%2farchitecture/29-environment-access-gate.md)",
    );

    assertEquals(issues.length, 2);
    assertEquals(
      issues.map((issue) =>
        issue.message.includes(
          "docs/architecture/29-environment-access-gate.md",
        )
      ),
      [true, true],
    );
  });

  it("rejects case variants of private repository URLs", () => {
    const issues = collectIssues(
      "docs/guides/example.md",
      `https://GitHub.com/${BLOCKED_REPOSITORY}`,
      BLOCKED_REPOSITORY,
    );

    assertEquals(issues.length, 1);
  });

  it("matches only the exact private examples repository URL", () => {
    assertEquals(
      collectIssues(
        "docs/guides/example.md",
        `https://notgithub.com/${BLOCKED_REPOSITORY}\n` +
          `https://github.com/${BLOCKED_REPOSITORY}-public\n` +
          `https://example.com/github.com/${BLOCKED_REPOSITORY}`,
        BLOCKED_REPOSITORY,
      ),
      [],
    );
    assertEquals(
      collectIssues(
        "docs/guides/example.md",
        `See https://github.com/${BLOCKED_REPOSITORY}.\n` +
          `git clone https://github.com/${BLOCKED_REPOSITORY}.git\n` +
          `git clone git@github.com:${BLOCKED_REPOSITORY}.git\n` +
          `git clone ssh://git@github.com/${BLOCKED_REPOSITORY}.git\n` +
          "[encoded](https://github.com/example-org/private&#x2d;examples)\n" +
          String
            .raw`[escaped](https://github.com/example-org/private\-examples)`,
        BLOCKED_REPOSITORY,
      ).length,
      6,
    );
  });

  it("finds destinations that wrap across lines", () => {
    assertEquals(
      destinations("[gate](\n../architecture/wrapped.md)"),
      ["../architecture/wrapped.md"],
    );
    assertEquals(
      destinations("[some\ntext](../architecture/text.md)"),
      ["../architecture/text.md"],
    );
    assertEquals(
      destinations("[gate]\n[gate]:\n../architecture/reference.md"),
      ["../architecture/reference.md"],
    );
  });

  it("ends a reference definition at a blank line", () => {
    assertEquals(
      destinations("[gate]\n[gate]:\n\n../architecture/orphan.md"),
      [],
    );
  });

  it("finds a reference definition below the first line", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[gate]\nIntro paragraph.\n\n" +
        "[gate]: ../architecture/private.md\n",
    );

    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.line, 4);
  });

  it("reads a string literal in a JSX href expression", () => {
    assertEquals(
      destinations('<a href={"../architecture/literal.md"}>gate</a>'),
      ["../architecture/literal.md"],
    );
    assertEquals(
      destinations("<a href={'../architecture/single.md'}>gate</a>"),
      ["../architecture/single.md"],
    );
    assertEquals(
      destinations("<a href={`../architecture/template.md`}>gate</a>"),
      ["../architecture/template.md"],
    );
    assertEquals(
      destinations('<a href={("../architecture/parenthesized.md")}>gate</a>'),
      ["../architecture/parenthesized.md"],
    );
    assertEquals(
      destinations(
        '<a href={(( "../architecture/nested.md" ))}>gate</a>',
      ),
      ["../architecture/nested.md"],
    );
    assertEquals(
      destinations(
        '<a href={("../architecture/missing-close.md"}>gate</a>\n' +
          '<a href={"../architecture/missing-open.md")}>gate</a>\n' +
          '<a href={(("../architecture/too-few.md")}>gate</a>\n' +
          '<a href={("../architecture/too-many.md"))}>gate</a>',
      ),
      [],
    );
  });

  it("evaluates JavaScript escapes in a JSX href string literal", () => {
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        String.raw`<a href={".\u002fdeploying.md"}>deploy</a>`,
        publishedFiles("docs/guides/deploying.md"),
      ),
      [],
    );
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      String.raw`<a href={'.\x2e/architecture/private.md'}>private</a>`,
    );
    assertEquals(issues.length, 1);
    assertEquals(
      issues[0]?.message.includes("docs/architecture/private.md"),
      true,
    );
  });

  it("ignores a dynamic JSX href expression", () => {
    assertEquals(destinations("<a href={href}>gate</a>"), []);
    assertEquals(
      destinations("<a href={`../${section}/private.md`}>gate</a>"),
      [],
    );
  });

  it("validates Veryfront absolute documentation URLs", () => {
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "[private](https://veryfront.com/docs/code/architecture/private) " +
          "[encoded](https://veryfront.com/docs/%63ode/architecture/private) " +
          "[http](http://veryfront.com/docs/code/architecture/private)",
      ).length,
      3,
    );
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "[public](https://veryfront.com/docs/code/guides/deploying)",
        publishedFiles("docs/guides/deploying.md"),
      ),
      [],
    );
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "[other service](https://veryfront.com:8443/docs/code/architecture/private)",
      ),
      [],
    );
  });

  it("validates site-root code destinations", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[private](/code/architecture/private) " +
        "[public](/code/guides/deploying)\n" +
        "[absolute private](https://veryfront.com/code/architecture/private) " +
        "[absolute public](https://veryfront.com/code/guides/deploying)",
      publishedFiles("docs/guides/deploying.md"),
    );

    assertEquals(issues.length, 2);
    assertEquals(
      issues.map((issue) =>
        issue.message.includes("docs/architecture/private")
      ),
      [true, true],
    );
  });

  it("decodes Markdown character references before resolving destinations", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[decimal] [hex] [named]\n" +
        "[decimal]: &#46;&#46;/architecture/decimal.md\n" +
        "[hex]: &#x2e;&#x2e;/architecture/hex.md\n" +
        "[named]: &period;&period;&sol;architecture/named.md",
    );

    assertEquals(issues.length, 3);
  });

  it("decodes Markdown escapes before resolving destinations", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[gate]\n" + String.raw`[gate]: \../architecture/private.md`,
    );

    assertEquals(issues.length, 1);
  });

  it("resolves query-only destinations against the current page", () => {
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/integrations/jira.md",
        "[cloud](?tab=cloud)",
        publishedFiles("docs/guides/integrations/jira.md"),
      ),
      [],
    );
  });

  it("rejects missing files in newly parsed destination forms", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      '<a href="./does-not-exist.md">missing</a>\n' +
        "[missing]\n" +
        "[missing]: ./also-does-not-exist.md",
    );

    assertEquals(issues.length, 2);
  });

  it("finds reference definitions inside block quotes", () => {
    assertEquals(
      destinations(
        "[gate] [wrapped]\n" +
          "> [gate]: ../architecture/private.md\n" +
          "> [wrapped]:\n> ../architecture/wrapped.md",
      ),
      ["../architecture/private.md", "../architecture/wrapped.md"],
    );
  });

  it("finds reference definitions inside list containers", () => {
    assertEquals(
      destinations(
        "[gate] [wrapped]\n" +
          "- [gate]: ../architecture/private.md\n" +
          "- [wrapped]:\n  ../architecture/wrapped.md",
      ),
      ["../architecture/private.md", "../architecture/wrapped.md"],
    );
  });

  it("does not treat footnote definitions as link definitions", () => {
    assertEquals(
      destinations("[^note]: Explanation of the behavior"),
      [],
    );
  });

  it("ignores unused reference definitions", () => {
    assertEquals(
      destinations("[old]: ../architecture/private.md"),
      [],
    );
    assertEquals(
      destinations(
        "[nested [old]](./public.md)\n" +
          "[old]: ../architecture/private.md",
      ),
      ["./public.md"],
    );
    assertEquals(
      destinations(
        '[inline](./public.md "[old]")\n' +
          "[old]: ../architecture/private.md",
      ),
      ["./public.md"],
    );
  });

  it("ignores Markdown destinations inside code", () => {
    assertEquals(
      destinations(
        "`[inline](../architecture/inline.md)`\n" +
          "```md\n[example](../architecture/fenced.md)\n```\n" +
          "    [indented](../architecture/indented.md)\n" +
          '    <a href="../architecture/html.md">HTML</a>\n' +
          "    [reference]: ../architecture/reference.md\n" +
          "    <https://veryfront.com/docs/code/architecture/autolink>\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      destinations(
        "`[example](\n../architecture/private.md)`\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      destinations(
        "`[example](../architecture/private.md)\\`\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      destinations(
        ">     [quoted](../architecture/quoted.md)\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      destinations(
        "`unmatched\n" +
          "```md\n[fenced](../architecture/fenced.md)\n```\n" +
          "[real](../architecture/real.md)\n`",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      destinations(
        "# Heading\n    [atx](../architecture/atx.md)\n" +
          "\nSetext\n=======\n    [setext](../architecture/setext.md)\n" +
          "\n---\n    [thematic](../architecture/thematic.md)",
      ),
      [],
    );
  });

  it("ignores fenced code inside block containers", () => {
    assertEquals(
      destinations(
        "> ```md\n" +
          "> [quoted](../architecture/quoted.md)\n" +
          "> ```\n" +
          "- ```md\n" +
          "  [listed](../architecture/listed.md)\n" +
          "  ```\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      destinations(
        "``` md`bad\n" +
          "[rendered](../architecture/rendered.md)",
      ),
      ["../architecture/rendered.md"],
    );
    assertEquals(
      destinations(
        "\t```md\n" +
          "[rendered](../architecture/tab-rendered.md)",
      ),
      ["../architecture/tab-rendered.md"],
    );
  });

  it("scans rendered paragraphs indented inside list items", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "- Details:\n\n    [gate](../architecture/private.md)",
    );

    assertEquals(issues.length, 1);
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "Intro\n    [gate](../architecture/private.md)",
      ).length,
      1,
    );
  });

  it("ignores destinations inside MDX comments", () => {
    assertEquals(
      destinations(
        "{/* [old](../architecture/private.md) */}\n" +
          '{/*\n<a href="../architecture/html.md">old</a>\n*/}\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      destinations(
        "`{/*`\n" +
          "[inline](../architecture/inline.md)\n" +
          "{/* real comment */}",
      ),
      ["../architecture/inline.md"],
    );
    assertEquals(
      destinations(
        "```md\n{/*\n```\n" +
          "[fenced](../architecture/fenced.md)\n" +
          "{/* real comment */}",
      ),
      ["../architecture/fenced.md"],
    );
    assertEquals(
      destinations(
        '{"{/*"}\n' +
          "[gate](../architecture/private.md)\n" +
          "{/* real */}",
      ),
      ["../architecture/private.md"],
    );
    assertEquals(
      destinations(
        "Unmatched prose {\n\n" +
          "{/* [old](../architecture/commented.md) */}\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
  });

  it("validates Veryfront documentation autolinks", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "<https://veryfront.com/docs/code/architecture/private>",
    );

    assertEquals(issues.length, 1);
    assertEquals(
      destinations(
        String.raw`\<https://veryfront.com/docs/code/guides/does-not-exist>`,
      ),
      [],
    );
  });

  it("does not duplicate angle-bracket Markdown destinations as autolinks", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[private](<https://veryfront.com/docs/code/architecture/private>)",
    );

    assertEquals(issues.length, 1);
  });

  it("validates a URI autolink wrapped in prose parentheses", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "(<https://veryfront.com/docs/code/architecture/private>)",
    );

    assertEquals(issues.length, 1);
  });

  it("accepts MDX published-route candidates", () => {
    assertEquals(
      publishedTargetCandidates("docs/guides/example"),
      [
        "docs/guides/example",
        "docs/guides/example.md",
        "docs/guides/example.mdx",
        "docs/guides/example/index.md",
        "docs/guides/example/index.mdx",
      ],
    );
  });

  it("rejects directory routes without an index page", () => {
    const exists = publishedTargetExists(
      "docs/guides/no-index",
      (path) => {
        if (path.endsWith("/docs/guides/no-index")) {
          return { isFile: false };
        }
        throw new Error("missing");
      },
    );

    assertEquals(exists, false);
    assertEquals(
      publishedTargetCandidates("docs/guides/deploying.md/"),
      [
        "docs/guides/deploying.md/index.md",
        "docs/guides/deploying.md/index.mdx",
      ],
    );
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        '<a href="./deploying.md/">deploy</a>',
        publishedFiles("docs/guides/deploying.md"),
      ).length,
      1,
    );
  });

  it("reports the destination line for a multiline MDX href", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      '<a href={\n  "../architecture/private.md"\n}>gate</a>',
    );

    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.line, 2);
    assertEquals(issues[0]?.text, '"../architecture/private.md"');
  });

  it("reports the line the destination sits on", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "One\nTwo\nThree\n[gate](../architecture/private.md)\n",
    );

    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.line, 4);
  });

  it("accepts published relative, directory, anchor, and site-root links", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[sibling](./deploying.md) [dir](../concepts/) [anchor](#section)\n" +
        "[root](/code/guides/deploying) [query](./deploying.md?x=1)\n",
      publishedFiles(
        "docs/guides/deploying.md",
        "docs/concepts/index.md",
      ),
    );

    assertEquals(issues, []);
  });
});
