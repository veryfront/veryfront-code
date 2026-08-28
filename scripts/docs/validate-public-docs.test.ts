import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectIssues,
  collectUnpublishedLinkIssues,
  destinations,
  publishedTargetCandidates,
} from "./validate-public-docs.ts";

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
        "[nested [label]]: ../architecture/nested.md",
      ),
      ["../architecture/nested.md"],
    );
    assertEquals(
      destinations(
        String.raw`[escaped \] label]: ../architecture/escaped.md`,
      ),
      ["../architecture/escaped.md"],
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

  it("rejects deleted section READMEs with queries", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[concept index](../concepts/README.md?view=1)",
    );

    assertEquals(issues.length, 1);
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
      "https://GitHub.com/veryfront/veryfront-examples",
    );

    assertEquals(issues.length, 1);
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
      destinations("[gate]:\n../architecture/reference.md"),
      ["../architecture/reference.md"],
    );
  });

  it("ends a reference definition at a blank line", () => {
    assertEquals(destinations("[gate]:\n\n../architecture/orphan.md"), []);
  });

  it("finds a reference definition below the first line", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "Intro paragraph.\n\n[gate]: ../architecture/private.md\n",
    );

    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.line, 3);
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
  });

  it("evaluates JavaScript escapes in a JSX href string literal", () => {
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        String.raw`<a href={".\u002fdeploying.md"}>deploy</a>`,
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
        "[private](https://veryfront.com/docs/code/architecture/private)",
      ).length,
      1,
    );
    assertEquals(
      collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "[public](https://veryfront.com/docs/code/guides/deploying)",
      ),
      [],
    );
  });

  it("validates site-root code destinations", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[private](/code/architecture/private) " +
        "[public](/code/guides/deploying)",
    );

    assertEquals(issues.length, 1);
    assertEquals(
      issues[0]?.message.includes("docs/architecture/private"),
      true,
    );
  });

  it("decodes Markdown character references before resolving destinations", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[decimal]: &#46;&#46;/architecture/decimal.md\n" +
        "[hex]: &#x2e;&#x2e;/architecture/hex.md\n" +
        "[named]: &period;&period;&sol;architecture/named.md",
    );

    assertEquals(issues.length, 3);
  });

  it("rejects missing files in newly parsed destination forms", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      '<a href="./does-not-exist.md">missing</a>\n' +
        "[missing]: ./also-does-not-exist.md",
    );

    assertEquals(issues.length, 2);
  });

  it("finds reference definitions inside block quotes", () => {
    assertEquals(
      destinations(
        "> [gate]: ../architecture/private.md\n" +
          "> [wrapped]:\n> ../architecture/wrapped.md",
      ),
      ["../architecture/private.md", "../architecture/wrapped.md"],
    );
  });

  it("finds reference definitions inside list containers", () => {
    assertEquals(
      destinations(
        "- [gate]: ../architecture/private.md\n" +
          "- [wrapped]:\n  ../architecture/wrapped.md",
      ),
      ["../architecture/private.md", "../architecture/wrapped.md"],
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
  });

  it("validates Veryfront documentation autolinks", () => {
    const issues = collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "<https://veryfront.com/docs/code/architecture/private>",
    );

    assertEquals(issues.length, 1);
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
    );

    assertEquals(issues, []);
  });
});
