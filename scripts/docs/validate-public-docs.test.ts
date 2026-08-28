import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectIssues,
  collectUnpublishedLinkIssues,
  destinations,
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
  });

  it("ignores a dynamic JSX href expression", () => {
    assertEquals(destinations("<a href={href}>gate</a>"), []);
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
