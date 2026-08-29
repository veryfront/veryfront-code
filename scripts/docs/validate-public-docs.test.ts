import {
  assertEquals,
  assertLess,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectIssues,
  collectUnpublishedLinkIssues,
  destinations,
  PublicDocSyntaxError,
  publishedTargetCandidates,
  publishedTargetExists,
  scanDestinations,
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

function mdxDestinations(text: string): Promise<string[]> {
  return destinations(text, "mdx");
}

describe("public docs validation", () => {
  it("parses balanced and escaped inline link labels", async () => {
    assertEquals(
      await destinations(
        "[nested [label]](../architecture/nested.md) and " +
          String.raw`[escaped \] label](../architecture/escaped.md)`,
      ),
      ["../architecture/nested.md", "../architecture/escaped.md"],
    );
    assertEquals(
      await destinations(
        "[outer [public](./deploying.md)](../architecture/private.md)",
      ),
      ["./deploying.md"],
    );
    assertEquals(
      await destinations(
        "[outer [plain bracket]](../architecture/private.md)",
      ),
      ["../architecture/private.md"],
    );
    assertEquals(
      await destinations(
        "[outer <https://veryfront.com/docs/code/guides/deploying>]" +
          "(../architecture/private.md)",
      ),
      [
        "../architecture/private.md",
        "https://veryfront.com/docs/code/guides/deploying",
      ],
    );
    assertEquals(
      await destinations(
        "[outer ![diagram](../architecture/private.png)](./deploying.md)",
      ),
      ["./deploying.md", "../architecture/private.png"],
    );
    assertEquals(
      await destinations(
        "[outer https://veryfront.com/docs/code/guides/deploying]" +
          "(./deploying.md)",
      ),
      ["./deploying.md"],
    );
    assertEquals(
      await destinations(
        "![alt <https://veryfront.com/docs/code/architecture/private>]" +
          "(./diagram.png)",
      ),
      ["./diagram.png"],
    );
    assertEquals(
      await destinations(
        '![alt <a href="../architecture/private.md">old</a>][ref]\n' +
          "![later](./later.png)\n\n" +
          "[ref]: ./image.png",
      ),
      ["./later.png", "./image.png"],
    );
    assertEquals(
      await destinations(
        '![outer ![one](./one.png) ![two](./two.png) ![three](./three.png) <a href="../architecture/private.md">old</a>][ref]\n' +
          "![later](./later.png)\n\n" +
          "[ref]: ./image.png",
      ),
      [
        "./later.png",
        "./image.png",
      ],
    );
    assertEquals(
      await destinations(
        "[outer ![alt <https://veryfront.com/docs/code/architecture/private>]" +
          "(./diagram.png)](./deploying.md)",
      ),
      ["./deploying.md", "./diagram.png"],
    );
    assertEquals(
      await destinations("[`]`](docs/architecture/private.md)"),
      ["docs/architecture/private.md"],
    );
    assertEquals(
      await destinations(
        '[<span title="]">gate</span>](docs/architecture/private.md)',
      ),
      ["docs/architecture/private.md"],
    );
    for (
      const token of [
        "<!-- ] -->",
        "<?pi ] ?>",
        "<!DECL ] >",
        "<![CDATA[]]]>",
      ]
    ) {
      assertEquals(
        (await scanDestinations(
          `[${token}gate](docs/architecture/private.md)`,
          "markdown",
        )).map((destination) => destination.href),
        ["docs/architecture/private.md"],
      );
    }
    assertEquals(
      await scanDestinations(
        "[<!-- ] gate](docs/architecture/private.md)",
        "markdown",
      ),
      [],
    );
  });

  it("validates reference definition labels", async () => {
    assertEquals(
      await destinations(
        "[use][nested [label]]\n\n" +
          "[nested [label]]: ../architecture/nested.md",
      ),
      [],
    );
    assertEquals(
      await destinations(
        String.raw`[use][escaped \] label]` + "\n\n" +
          String.raw`[escaped \] label]: ../architecture/escaped.md`,
      ),
      ["../architecture/escaped.md"],
    );
    assertEquals(
      await destinations(
        "[collapsed][]\n\n[collapsed]: ../architecture/valid.md",
      ),
      ["../architecture/valid.md"],
    );
    const overlyLongLabel = "a".repeat(1000);
    assertEquals(
      await destinations(
        `[${overlyLongLabel}]\n\n` +
          `[${overlyLongLabel}]: ../architecture/too-long.md`,
      ),
      [],
    );
    assertEquals(
      await destinations("[ſ]\n\n[s]: ../architecture/case-folded.md"),
      ["../architecture/case-folded.md"],
    );
    assertEquals(
      await destinations("[ẞ]\n\n[ss]: ../architecture/capital-sharp.md"),
      ["../architecture/capital-sharp.md"],
    );
    assertEquals(
      await destinations(
        "[a\tb]\n\n[a b]: ../architecture/actual-whitespace.md",
      ),
      ["../architecture/actual-whitespace.md"],
    );
    assertEquals(
      await destinations(
        "[a&Tab;b] [a&colon;b] [a&#32;b]\n\n" +
          "[a b]: ../architecture/entity-whitespace.md\n" +
          "[a:b]: ../architecture/entity-colon.md",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "[first] [second]\r\n\r\n" +
          "[first]: ../architecture/first.md\r\n" +
          "[second]: ../architecture/second.md",
      ),
      ["../architecture/first.md", "../architecture/second.md"],
    );
    assertEquals(
      await scanDestinations(
        '[unused]: <> "https://veryfront.com/docs/code/guides/missing"',
        "markdown",
      ),
      [],
    );
    assertEquals(
      await destinations("[used]: <>\n\n[used]"),
      [],
    );
    assertEquals(
      await destinations(
        "[outer [public][ref]](../architecture/private.md)\n\n" +
          "[ref]: ./deploying.md",
      ),
      ["./deploying.md"],
    );
    assertEquals(
      await destinations(
        "[outer ![diagram][ref]](./deploying.md)\n\n" +
          "[ref]: ../architecture/private.png",
      ),
      ["./deploying.md", "../architecture/private.png"],
    );
    assertEquals(
      await destinations(
        "![alt <https://veryfront.com/docs/code/architecture/private>][img]\n\n" +
          "[img]: ./diagram.png",
      ),
      ["./diagram.png"],
    );
    assertEquals(
      await destinations(
        '![alt <a href="../architecture/private.md">old</a>][img]\n\n' +
          "[img]: ./diagram.png",
      ),
      ["./diagram.png"],
    );
  });

  it("parses quoted HTML anchors and angle-bracket destinations", async () => {
    assertEquals(
      await destinations(
        '<a href="../architecture/html.md">HTML</a> ' +
          "[Markdown](<../architecture/markdown.md>)",
      ),
      ["../architecture/markdown.md", "../architecture/html.md"],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        '<a href="docs/architecture/private.md">private</a>\n' +
          '<img src="docs/architecture/private.png">',
      )).map((issue) => issue.line),
      [1, 2],
    );
    await assertRejects(
      () =>
        scanDestinations(
          "<a href=docs/architecture/private.md>private</a>",
          "mdx",
        ),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<pre>\n" +
          "<script>\n" +
          "<a href=docs/architecture/not-rendered.md>raw</a>\n" +
          "</script>\n" +
          '<a href="docs/architecture/private.md">live</a>\n' +
          "</pre>",
      )).map((issue) => issue.line),
      [5],
    );
    for (
      const source of [
        "<a href=docs/architecture/private=bad.md>private</a>",
        "<a href=docs/architecture/<bad.md>private</a>",
        "<a href\n\n=docs/architecture/private.md>private</a>",
        "<a href=\n\ndocs/architecture/private.md>private</a>",
        "<a href\n=\ndocs/architecture/private.md>private</a>",
      ]
    ) {
      assertEquals(await scanDestinations(source, "markdown"), []);
    }
    assertEquals(
      (await scanDestinations(
        "<a href=\n" +
          '"docs/architecture/private.md" title=sample>private</a>',
        "markdown",
      )).map((destination) => destination.href),
      ["docs/architecture/private.md"],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        '<span title="x\\">ok</span>\n' +
          '<a href="docs/architecture/private.md">private</a>',
      )).map((issue) => issue.line),
      [2],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<foo [gate](docs/architecture/private.md)>",
      )).map((issue) => issue.line),
      [1],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "README.md",
        '<foo href="docs/architecture/private.md" [invalid]>',
      ),
      [],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<foo [invalid]>\n" +
          '<a href="docs/architecture/private.md">private</a>',
      )).map((issue) => issue.line),
      [2],
    );
  });

  it("preserves raw HTML destinations normalized by CommonMark", async () => {
    const nul = "\0";

    assertEquals(
      await destinations(
        `<a href="docs/architecture/private${nul}.md">private</a>`,
        "markdown",
      ),
      ["docs/architecture/private\uFFFD.md"],
    );
  });

  it("ignores Markdown-looking text inside raw HTML blocks", async () => {
    for (const tag of ["pre", "script", "style", "textarea"]) {
      assertEquals(
        await collectUnpublishedLinkIssues(
          "README.md",
          `<${tag}>\n[x](docs/architecture/private.md)\n</${tag}>`,
        ),
        [],
      );
    }
    for (const opener of ["<pre", "<pre ", "<pre/>"]) {
      assertEquals(
        await collectUnpublishedLinkIssues(
          "README.md",
          `${opener}\n[x](docs/architecture/private.md)`,
        ),
        [],
      );
    }
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<script src=docs/architecture/private.js>\n" +
          "[x](docs/architecture/not-rendered.md)\n" +
          "</script>",
      )).map((issue) => issue.line),
      [1],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<pre>\n" +
          "<a href=docs/architecture/private.md>raw</a>\n" +
          "</pre>",
      )).map((issue) => issue.line),
      [2],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "README.md",
        "<script>\n" +
          "<a href=docs/architecture/not-rendered.md>raw</a>\n" +
          "</script>",
      ),
      [],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "> <PrE class=sample>\n" +
          "> [hidden](docs/architecture/hidden.md)\n" +
          "[visible](docs/architecture/visible.md)",
      )).map((issue) => issue.line),
      [3],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<Warning bad*name=value>\n" +
          "[visible](docs/architecture/visible.md)",
      )).map((issue) => issue.line),
      [2],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "> <div>\n" +
          "> [hidden](docs/architecture/hidden.md)\n" +
          "[visible](docs/architecture/visible.md)",
      )).map((issue) => issue.line),
      [3],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "before <pre>[visible](docs/architecture/private.md)</pre> after",
      )).map((issue) => issue.line),
      [1],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        "<pre>\n[x](../architecture/private.md)\n</pre>",
      )).map((issue) => issue.line),
      [2],
    );
    for (
      const [opening, closing] of [
        ["<?target", "?>"],
        ["<!declaration", ">"],
        ["<![CDATA[", "]]>"],
      ]
    ) {
      assertEquals(
        (await collectUnpublishedLinkIssues(
          "README.md",
          `${opening}\n` +
            "[hidden](docs/architecture/hidden.md)\n" +
            `${closing}\n` +
            "[visible](docs/architecture/visible.md)",
        )).map((issue) => issue.line),
        [4],
      );
    }
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<![CDATA[\n" +
          "<a href=docs/architecture/hidden.md>raw data</a>\n" +
          "]]>\n" +
          '<a href="docs/architecture/visible.md">rendered</a>',
      )).map((issue) => issue.line),
      [4],
    );
  });

  it("honors blank-line-terminated Markdown HTML blocks", async () => {
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "paragraph\n" +
          "<div>\n" +
          "[hidden](docs/architecture/hidden.md)\n" +
          "</div>\n\n" +
          "[visible](docs/architecture/visible.md)",
      )).map((issue) => issue.line),
      [6],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<Warning>\n" +
          "[hidden](docs/architecture/hidden.md)\n" +
          "</Warning>\n\n" +
          "[visible](docs/architecture/visible.md)",
      )).map((issue) => issue.line),
      [5],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "paragraph\n" +
          "<Warning>\n" +
          "[visible](docs/architecture/visible.md)\n" +
          "</Warning>",
      )).map((issue) => issue.line),
      [3],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "<div>\n" +
          "<a href=docs/architecture/private.md>live</a>\n" +
          "</div>",
      )).map((issue) => issue.line),
      [2],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        "<div>\n[x](../architecture/private.md)\n</div>",
      )).map((issue) => issue.line),
      [2],
    );
  });

  it("parses static sources but not hyphenated href attributes", async () => {
    assertEquals(
      await mdxDestinations(
        '<img src="../architecture/image.png" /> ' +
          '<div data-href="../architecture/data.md"></div>\n' +
          'Configure href="../architecture/prose.md" for the sample.\n' +
          "<a title=\"sample href='../architecture/title.md' text\">safe</a>\n" +
          '<a data-ok={true /* } > */} href="../architecture/commented-tag.md">ok</a>\n' +
          '<a data-ok={value /* c */ / divisor} href="../architecture/comment-division.md">ok</a>\n' +
          '<a data-ok={{ value: /* } > */ true }} href="../architecture/nested-comment.md">ok</a>\n' +
          '<a data-ok={true // } >\n} href="../architecture/line-comment.md">ok</a>\n' +
          '<a data-ok={/<}>/.test(value)} href="../architecture/regex.md">ok</a>\n' +
          '<a title="<!--" href="../architecture/comment-token.md">ok</a>\n' +
          '<a data-ok={/[}>]/.test(value)} href="../architecture/regex-class.md">ok</a>\n' +
          '<a data-ok={typeof /}>/} href="../architecture/typeof-regex.md">ok</a>\n' +
          '<a data-ok={void /}>/} href="../architecture/void-regex.md">ok</a>\n' +
          '<a data-ok={delete /}>/} href="../architecture/delete-regex.md">ok</a>\n' +
          '<a data-ok={"x" in /}>/} href="../architecture/in-regex.md">ok</a>\n' +
          '<a data-ok={value instanceof /}>/} href="../architecture/instanceof-regex.md">ok</a>\n' +
          '<a data-ok={(async () => await /}>/.test(x))()} href="../architecture/await-regex.md">ok</a>\n' +
          '<a data-ok={(function* () { yield /}>/.test(x) })()} href="../architecture/yield-regex.md">ok</a>\n' +
          '<a data-ok={class extends /[}>]/.constructor {}} href="../architecture/extends-regex.md">ok</a>\n' +
          '<a data-ok={(() => { class Sample {} /[}>]/.test(value) })()} href="../architecture/class-block-regex.md">ok</a>\n' +
          '<a data-ok={(() => { class Sample extends factory(Base) {} /[}>]/.test(value) })()} href="../architecture/class-heritage-regex.md">ok</a>\n' +
          '<a data-ok={(() => { if (x) {} else /[}>]/.test(x); do /[}>]/.test(x); while (false); })()} href="../architecture/statement-regex.md">ok</a>\n' +
          '<a data-ok={(() => { class Sample {} /[}>]/.test(value); return true })()} href="../architecture/class-block-regex.md">ok</a>\n' +
          '<a data-ok={(() => { {} /[}>]/.test(value); return true })()} href="../architecture/bare-block-regex.md">ok</a>\n' +
          '<a data-ok={(function () { class Sample {} /[}>]/.test(value); return true })()} href="../architecture/function-body-regex.md">ok</a>\n' +
          '<a data-ok={({ method() { {} /[}>]/.test(value) } })} href="../architecture/method-body-regex.md">ok</a>\n' +
          '<a data-ok={(class { method() { {} /[}>]/.test(value) } })} href="../architecture/class-method-body-regex.md">ok</a>\n' +
          '<a data-ok={class Sample { static { {} /[}>]/.test(value) } }} href="../architecture/class-static-block-regex.md">ok</a>\n' +
          '<a data-ok={(() => { return\n{} /[}>]/.test(value) })()} href="../architecture/return-asi-regex.md">ok</a>\n' +
          '<a data-ok={(() => { label: {} /[}>]/.test(value) })()} href="../architecture/labeled-block-regex.md">ok</a>\n' +
          '<a data-ok={<Foo></Foo>} href="../architecture/paired-jsx.md">ok</a>\n' +
          '<a data-ok={<Foo>child</Foo>} href="../architecture/jsx-child-text.md">ok</a>\n' +
          '<a data-ok={value </foo>/.source} href="../architecture/less-than-regex.md">ok</a>\n' +
          '<a data-ok={<Foo>{value </foo>/.source}</Foo>} href="../architecture/jsx-child-less-than-regex.md">ok</a>\n' +
          '<a data-ok={(() => { for (const x of /[}>]/.source) {} return true })()} href="../architecture/for-of-regex.md">ok</a>\n' +
          '<a data-ok={(() => { for (let x of values\n/ ({ marker: ">/" }).length) {} return true })()} href="../architecture/for-of-rhs-division.md">ok</a>\n' +
          '<a data-ok={(() => { for (var x in values\n/ ({ marker: ">/" }).length) {} return true })()} href="../architecture/for-in-rhs-division.md">ok</a>\n' +
          '<a data-ok={(() => { for (using of /[}>]/.source) {} return true })()} href="../architecture/for-using-of-regex.md">ok</a>\n' +
          '<a data-ok={(async () => { for await (const x of /[}>]/.source) {} return true })()} href="../architecture/for-await-of-regex.md">ok</a>\n' +
          '<a data-ok={(() => { for (item1 of /[}>]/.source) {} return true })()} href="../architecture/for-digit-identifier-of-regex.md">ok</a>\n' +
          '<a data-ok={(() => { for (item_ of /[}>]/.source) {} return true })()} href="../architecture/for-underscore-identifier-of-regex.md">ok</a>\n' +
          '<a data-ok={(() => { for (item$ of /[}>]/.source) {} return true })()} href="../architecture/for-dollar-identifier-of-regex.md">ok</a>\n' +
          '<a data-ok={(() => { for (π of /[}>]/.source) {} return true })()} href="../architecture/for-unicode-identifier-of-regex.md">ok</a>\n' +
          String
            .raw`<a data-ok={(() => { for (\u{10400}item of /[}>]/.source) {} return true })()} href="../architecture/for-escaped-start-identifier-of-regex.md">ok</a>` +
          "\n" +
          String
            .raw`<a data-ok={(() => { for (item\u0031 of /[}>]/.source) {} return true })()} href="../architecture/for-escaped-end-identifier-of-regex.md">ok</a>` +
          "\n" +
          '<a data-ok={(() => { for (of / ({ marker: ">/" }).length; false;) {} return true })()} href="../architecture/for-of-division.md">ok</a>\n' +
          '<a data-ok={(() => { for (const x = { value: of / ({ marker: ">/" }).length }; false;) {} return true })()} href="../architecture/for-header-nested-of-division.md">ok</a>\n' +
          '<a data-ok={of / ({ marker: ">/" }).length} href="../architecture/of-division.md">ok</a>\n' +
          '<a data-ok={(function () {}) / ({ marker: ">/" }).length} href="../architecture/function-expression-division.md">ok</a>\n' +
          '<a data-ok={(class Sample {}) / ({ marker: ">/" }).length} href="../architecture/class-expression-division.md">ok</a>\n' +
          '<a data-ok={<Foo></Foo>} href="../architecture/paired-jsx.md">ok</a>\n' +
          '<a data-ok={<Foo>child</Foo>} href="../architecture/paired-jsx-text.md">ok</a>\n' +
          '<a data-ok={<Foo/> / ({ marker: ">/" }).length} href="../architecture/jsx-division.md">ok</a>\n' +
          '<Comp value={<a href="../architecture/nested-jsx-link.md">x</a>} />\n' +
          "<Comp title=\"<a href='../architecture/quoted-jsx-link.md'>\" value={true} />\n" +
          '<a data-ok={(() => { let value\n/[}>]/.test(input); var other\n/[}>]/.test(input) })()} href="../architecture/declaration-asi-regex.md">ok</a>\n' +
          '<a data-ok={(() => { let first, second\n/[}>]/.test(input); var third, fourth\n/[}>]/.test(input) })()} href="../architecture/declaration-list-asi-regex.md">ok</a>\n' +
          '<a data-ok={(() => { breakfast\n/ ({ marker: ">/" }).length; continueValue\n/ ({ marker: ">/" }).length; debuggerValue\n/ ({ marker: ">/" }).length; return true })()} href="../architecture/asi-prefix-division.md">ok</a>\n' +
          '<a data-ok={(() => { while (value) { break\n/[}>]/.test(value) } while (value) { continue\n/[}>]/.test(value) } debugger\n/[}>]/.test(value); return true })()} href="../architecture/asi-regex.md">ok</a>\n' +
          '<a data-ok={(() => { let value\n/[}>]/.test(input); return true })()} href="../architecture/uninitialized-let-asi-regex.md">ok</a>\n' +
          '<a data-ok={(() => { var value\n/[}>]/.test(input); return true })()} href="../architecture/uninitialized-var-asi-regex.md">ok</a>\n' +
          '<a data-ok={(() => { let value, other\n/[}>]/.test(input); return true })()} href="../architecture/uninitialized-let-list-asi-regex.md">ok</a>\n' +
          '<a data-ok={(() => { var value, other\n/[}>]/.test(input); return true })()} href="../architecture/uninitialized-var-list-asi-regex.md">ok</a>\n' +
          '<a data-ok={(() => { let value = input\n/ ({ marker: ">/" }).length; return true })()} href="../architecture/initialized-let-division.md">ok</a>\n' +
          '<a data-ok={(() => { let value, other = input\n/ ({ marker: ">/" }).length; return true })()} href="../architecture/initialized-let-list-division.md">ok</a>\n' +
          '<a data-ok={(async () => await (x) / ({ marker: "}>/" }).length)()} href="../architecture/await-group-division.md">ok</a>\n' +
          '<a data-ok={`x ${"`"} >`} href="../architecture/template.md">ok</a>\n' +
          '<a data-ok={value / count > 1} href="../architecture/division.md">ok</a>\n' +
          '<a data-ok={++/{/.lastIndex} href="../architecture/prefix-update.md">ok</a>\n' +
          '<a data-ok={--/}/.lastIndex} href="../architecture/prefix-decrement.md">ok</a>\n' +
          '<a data-ok={value++ / count > 1} href="../architecture/postfix-update.md">ok</a>\n' +
          '<a data-ok={value-- / count > 1} href="../architecture/postfix-decrement.md">ok</a>\n' +
          '<a data-ok={[...++/{/.lastIndex]} href="../architecture/spread-update.md">ok</a>\n' +
          '<a data-ok={πinstanceof / ({ marker: "}>/" }).length} href="../architecture/unicode-identifier.md">ok</a>\n' +
          '<a data-ok={𐐀instanceof / ({ marker: "}>/" }).length} href="../architecture/astral-identifier.md">ok</a>\n' +
          String
            .raw`<a data-ok={\u{10400}instanceof / ({ marker: ">/" }).length} href="../architecture/escaped-astral-identifier.md">ok</a>` +
          "\n" +
          '<div title="[old](../architecture/title-link.md)"></div>\n' +
          '<div title={"[old](../architecture/expression.md)"}></div>\n' +
          "<Code value={'Configure href=\"../architecture/string.md\"'} />\n" +
          '<div title={"<https://veryfront.com/docs/code/architecture/private>"}></div>\n' +
          String.raw`\\<a href="../architecture/real.md">real</a>`,
      ),
      [
        "../architecture/image.png",
        "../architecture/commented-tag.md",
        "../architecture/comment-division.md",
        "../architecture/nested-comment.md",
        "../architecture/line-comment.md",
        "../architecture/regex.md",
        "../architecture/comment-token.md",
        "../architecture/regex-class.md",
        "../architecture/typeof-regex.md",
        "../architecture/void-regex.md",
        "../architecture/delete-regex.md",
        "../architecture/in-regex.md",
        "../architecture/instanceof-regex.md",
        "../architecture/await-regex.md",
        "../architecture/yield-regex.md",
        "../architecture/extends-regex.md",
        "../architecture/class-block-regex.md",
        "../architecture/class-heritage-regex.md",
        "../architecture/statement-regex.md",
        "../architecture/class-block-regex.md",
        "../architecture/bare-block-regex.md",
        "../architecture/function-body-regex.md",
        "../architecture/method-body-regex.md",
        "../architecture/class-method-body-regex.md",
        "../architecture/class-static-block-regex.md",
        "../architecture/return-asi-regex.md",
        "../architecture/labeled-block-regex.md",
        "../architecture/paired-jsx.md",
        "../architecture/jsx-child-text.md",
        "../architecture/less-than-regex.md",
        "../architecture/jsx-child-less-than-regex.md",
        "../architecture/for-of-regex.md",
        "../architecture/for-of-rhs-division.md",
        "../architecture/for-in-rhs-division.md",
        "../architecture/for-using-of-regex.md",
        "../architecture/for-await-of-regex.md",
        "../architecture/for-digit-identifier-of-regex.md",
        "../architecture/for-underscore-identifier-of-regex.md",
        "../architecture/for-dollar-identifier-of-regex.md",
        "../architecture/for-unicode-identifier-of-regex.md",
        "../architecture/for-escaped-start-identifier-of-regex.md",
        "../architecture/for-escaped-end-identifier-of-regex.md",
        "../architecture/for-of-division.md",
        "../architecture/for-header-nested-of-division.md",
        "../architecture/of-division.md",
        "../architecture/function-expression-division.md",
        "../architecture/class-expression-division.md",
        "../architecture/paired-jsx.md",
        "../architecture/paired-jsx-text.md",
        "../architecture/jsx-division.md",
        "../architecture/nested-jsx-link.md",
        "../architecture/declaration-asi-regex.md",
        "../architecture/declaration-list-asi-regex.md",
        "../architecture/asi-prefix-division.md",
        "../architecture/asi-regex.md",
        "../architecture/uninitialized-let-asi-regex.md",
        "../architecture/uninitialized-var-asi-regex.md",
        "../architecture/uninitialized-let-list-asi-regex.md",
        "../architecture/uninitialized-var-list-asi-regex.md",
        "../architecture/initialized-let-division.md",
        "../architecture/initialized-let-list-division.md",
        "../architecture/await-group-division.md",
        "../architecture/template.md",
        "../architecture/division.md",
        "../architecture/prefix-update.md",
        "../architecture/prefix-decrement.md",
        "../architecture/postfix-update.md",
        "../architecture/postfix-decrement.md",
        "../architecture/spread-update.md",
        "../architecture/unicode-identifier.md",
        "../architecture/astral-identifier.md",
        "../architecture/escaped-astral-identifier.md",
        "../architecture/real.md",
      ],
    );
    assertEquals(
      await mdxDestinations(
        '<a data-ok={`x ${`nested ${">"}`} >`} ' +
          'href="../architecture/nested-template.md">ok</a>',
      ),
      ["../architecture/nested-template.md"],
    );
    await assertRejects(
      () =>
        mdxDestinations(
          '<a data-ok={this.#instanceof / ({ marker: "}>/" }).length} />',
        ),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
    await assertRejects(
      () =>
        mdxDestinations(
          String.raw`\<a href="../architecture/escaped.md">literal</a>`,
        ),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
  });

  it("does not rescan quoted JSX attributes as nested tags", async () => {
    assertEquals(
      await mdxDestinations(
        "<Comp title=\"<a href='./literal.md'>\" value={true} />",
      ),
      [],
    );
    assertEquals(
      await mdxDestinations(
        "<Comp title=\"<a href='./literal.md'>\" " +
          'value={<a href="../architecture/real.md">x</a>} />',
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "{<Comp title=\"<a href='./literal.md'>\" " +
          'value={<a href="../architecture/nested.md">x</a>} />}',
      ),
      ["../architecture/nested.md"],
    );
  });

  it("keeps for-in and for-of right-hand division inside JSX attributes", async () => {
    assertEquals(
      await mdxDestinations(
        "<a data-ok={(() => { for (let value of values\n" +
          '/ ({ marker: ">/" }).length) {} return true })()} ' +
          'href="../architecture/for-of-rhs-division.md">ok</a>\n' +
          "<a data-ok={(() => { for (var key in object\n" +
          '/ ({ marker: ">/" }).length) {} return true })()} ' +
          'href="../architecture/for-in-rhs-division.md">ok</a>',
      ),
      [
        "../architecture/for-of-rhs-division.md",
        "../architecture/for-in-rhs-division.md",
      ],
    );
  });

  it("keeps object and class method bodies in statement context", async () => {
    assertEquals(
      await mdxDestinations(
        "<a data-ok={({ method() { {} /[}>]/.test(value) } })} " +
          'href="../architecture/object-method-regex.md">ok</a>\n' +
          "<a data-ok={class Sample { method() { {} /[}>]/.test(value) } }} " +
          'href="../architecture/class-method-regex.md">ok</a>\n' +
          '<a data-ok={({ ["method"]() { {} /[}>]/.test(value) } })} ' +
          'href="../architecture/computed-method-regex.md">ok</a>\n' +
          "<a data-ok={class Sample { static { {} /[}>]/.test(value) } }} " +
          'href="../architecture/static-class-block-regex.md">ok</a>\n' +
          "<a data-ok={({ method() { return value " +
          '/ ({ marker: ">/" }).length } })} ' +
          'href="../architecture/object-method-division.md">ok</a>\n' +
          "<a data-ok={class Sample { static { value " +
          '/ ({ marker: ">/" }).length } }} ' +
          'href="../architecture/static-class-block-division.md">ok</a>',
      ),
      [
        "../architecture/object-method-regex.md",
        "../architecture/class-method-regex.md",
        "../architecture/computed-method-regex.md",
        "../architecture/static-class-block-regex.md",
        "../architecture/object-method-division.md",
        "../architecture/static-class-block-division.md",
      ],
    );
  });

  it("ends a bare return at its line terminator", async () => {
    assertEquals(
      await mdxDestinations(
        "<a data-ok={(() => { return\n{} /[}>]/.test(value) })()} " +
          'href="../architecture/bare-return-regex.md">ok</a>\n' +
          "<a data-ok={(() => { return value\n" +
          '/ ({ marker: ">/" }).length })()} ' +
          'href="../architecture/return-value-division.md">ok</a>',
      ),
      [
        "../architecture/bare-return-regex.md",
        "../architecture/return-value-division.md",
      ],
    );
  });

  it("keeps switch clause blocks in statement context", async () => {
    assertEquals(
      await mdxDestinations(
        "<a data-ok={(() => { switch (x) { case 1: {} " +
          '/[}>]/.test(x) } })()} href="../architecture/switch-case-regex.md">ok</a>\n' +
          "<a data-ok={(() => { switch (x) { case condition ? 1 : 2: {} " +
          '/[}>]/.test(x) } })()} href="../architecture/switch-ternary-case-regex.md">ok</a>\n' +
          "<a data-ok={(() => { switch (x) { case 1: value " +
          '/ ({ marker: ">/" }).length } })()} ' +
          'href="../architecture/switch-case-division.md">ok</a>\n' +
          "<a data-ok={(() => { switch (x) { default: {} " +
          '/[}>]/.test(x) } })()} href="../architecture/switch-default-regex.md">ok</a>',
      ),
      [
        "../architecture/switch-case-regex.md",
        "../architecture/switch-ternary-case-regex.md",
        "../architecture/switch-case-division.md",
        "../architecture/switch-default-regex.md",
      ],
    );
  });

  it("does not treat newline-separated blocks as method bodies", async () => {
    assertEquals(
      await mdxDestinations(
        "<a data-ok={(() => { foo()\n{}\n/[}>]/.test(x) })()} " +
          'href="../architecture/newline-call-block-regex.md" />\n' +
          "<a data-ok={(() => { foo()\n" +
          '/ ({ marker: ">/" }).length })()} ' +
          'href="../architecture/newline-call-division.md" />',
      ),
      [
        "../architecture/newline-call-block-regex.md",
        "../architecture/newline-call-division.md",
      ],
    );
  });

  it("ignores escaped Markdown link openers", async () => {
    assertEquals(
      await destinations(String.raw`\[example](../architecture/private.md)`),
      [],
    );
  });

  it("requires a closing inline-link delimiter", async () => {
    assertEquals(
      await destinations(
        "[plain](./does-not-exist.md\n" +
          "[wrapped](<./also-missing.md>\n" +
          "[pointy](<../architecture/\nprivate.md>)\n" +
          "[nested](./does-not-exist(\npath).md)\n" +
          "[paragraph](\n\n../architecture/paragraph.md)\n" +
          "[reference]\n\n[reference]: <../architecture/reference.md",
      ),
      [],
    );
    assertEquals(
      await destinations(
        '[sample](../architecture/private.md "first\n\nsecond")',
      ),
      [],
    );
    assertEquals(
      await destinations('[sample](./deploying.md "first\nsecond\nthird")'),
      ["./deploying.md"],
    );
    assertEquals(
      await destinations(
        '[sample](../architecture/private.md "first\r\rsecond")',
      ),
      [],
    );
    assertEquals(
      await destinations(
        "[label]( \"tooltip\") and [label]( 'tooltip') and " +
          "[label]( (tooltip))",
      ),
      ['"tooltip"', "'tooltip'", "(tooltip)"],
    );
    assertEquals(await destinations('[label](<> "tooltip")'), []);
    assertEquals(
      await destinations(
        '[sample](../architecture/private.md "title"\n\n)',
      ),
      [],
    );
    assertEquals(
      await destinations('[sample](./deploying.md "title"\n)'),
      ["./deploying.md"],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "[gate](\n\n[gate]: docs/architecture/private.md",
      )).map((issue) => issue.line),
      [3],
    );
    assertEquals(
      await destinations(
        "[gate](./public.md)\n\n" +
          "[gate]: ../architecture/private.md",
      ),
      ["./public.md"],
    );
    assertEquals(
      await destinations(
        '[gate](./public.md "first\n\nsecond")\n\n' +
          "[gate]: ../architecture/private.md",
      ),
      ["../architecture/private.md"],
    );
    assertEquals(
      await destinations("[pointy](<../architecture/<private.md>)"),
      [],
    );
    assertEquals(
      await destinations(String.raw`[pointy](<../architecture/\<private.md>)`),
      [String.raw`../architecture/\<private.md`],
    );
    assertEquals(
      await destinations(
        "[pointy]\n\n[pointy]: <../architecture/<private.md>",
      ),
      [],
    );
    assertEquals(
      await destinations(
        String.raw`[pointy]

[pointy]: <../architecture/\<private.md>`,
      ),
      [String.raw`../architecture/\<private.md`],
    );
    assertEquals(
      await destinations(
        "[deep](../architecture/" + "(".repeat(33) + "private" +
          ")".repeat(33) + ".md)",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "[deep]\n\n[deep]: ../architecture/" + "(".repeat(33) + "private" +
          ")".repeat(33) + ".md",
      ),
      [
        "../architecture/" + "(".repeat(33) + "private" +
        ")".repeat(33) + ".md",
      ],
    );
    assertEquals(
      await destinations(
        "[deep](../architecture/" + "(".repeat(32) + "private" +
          ")".repeat(32) + ".md)",
      ),
      [
        "../architecture/" + "(".repeat(32) + "private" +
        ")".repeat(32) + ".md",
      ],
    );
    assertEquals(
      await destinations(
        "[deep]\n\n[deep]: ../architecture/" + "(".repeat(32) +
          "private" + ")".repeat(32) + ".md",
      ),
      [
        "../architecture/" + "(".repeat(32) + "private" +
        ")".repeat(32) + ".md",
      ],
    );
  });

  it("rejects deleted section READMEs with queries", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[concept index](../concepts/README.md?view=1)",
    );

    assertEquals(issues.length, 1);
  });

  it("validates documentation boundaries from the public README", async () => {
    const issues = await collectUnpublishedLinkIssues(
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

  it("rejects browser-normalized traversal paths", async () => {
    const issues = await collectUnpublishedLinkIssues(
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

  it("renormalizes encoded separators before checking file existence", async () => {
    const issues = await collectUnpublishedLinkIssues(
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

  it("rejects case variants of private repository URLs", async () => {
    const issues = await collectIssues(
      "docs/guides/example.md",
      `https://GitHub.com/${BLOCKED_REPOSITORY}`,
      BLOCKED_REPOSITORY,
    );

    assertEquals(issues.length, 1);
  });

  it("matches only the exact private examples repository URL", async () => {
    assertEquals(
      await collectIssues(
        "docs/guides/example.md",
        `https://notgithub.com/${BLOCKED_REPOSITORY}\n` +
          `https://github.com/${BLOCKED_REPOSITORY}-public\n` +
          `https://example.com/github.com/${BLOCKED_REPOSITORY}\n` +
          `https://%67ithub.com.example/${BLOCKED_REPOSITORY}\n` +
          `https://github.com@example.com/${BLOCKED_REPOSITORY}\n` +
          `https://github.com/${BLOCKED_REPOSITORY}_public\n` +
          "https://github.com/example-org/private%2Dexamples%23-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%2Ffork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%3Ffork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%20-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%29-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%3E-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%5D-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%2C-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%3B-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%3A-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%27-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%22-fork/%ZZ\n" +
          "https://github.com/example-org/private%2Dexamples%21-fork/%ZZ\n" +
          `_https://github.com/${BLOCKED_REPOSITORY}_public_`,
        BLOCKED_REPOSITORY,
      ),
      [],
    );
    assertEquals(
      (await collectIssues(
        "docs/guides/example.mdx",
        `See https://github.com/${BLOCKED_REPOSITORY}.\n` +
          `git clone https://github.com/${BLOCKED_REPOSITORY}.git\n` +
          `git clone git@github.com:${BLOCKED_REPOSITORY}.git\n` +
          `git clone ssh://git@github.com/${BLOCKED_REPOSITORY}.git\n` +
          "[encoded](https://github.com/example-org/private&#x2d;examples)\n" +
          '<a href={"https://github.com/example-org/private\\x2dexamples"}>x</a>\n' +
          `https://%67ithub.com/${BLOCKED_REPOSITORY}\n` +
          String
            .raw`[escaped](https://github.com/example-org/private\-examples)` +
          `\n_https://github.com/${BLOCKED_REPOSITORY}_\n` +
          `**https://%67ithub.com/example-org/private%2dexamples**\n` +
          `https://github.com/example-org/private%2Dexamples/%ZZ\n` +
          `***https://github.com/${BLOCKED_REPOSITORY}***\n` +
          `___https://github.com/${BLOCKED_REPOSITORY}___\n` +
          `****https://github.com/${BLOCKED_REPOSITORY}****\n` +
          `____https://github.com/${BLOCKED_REPOSITORY}____\n` +
          `~https://github.com/${BLOCKED_REPOSITORY}~`,
        BLOCKED_REPOSITORY,
      )).length,
      16,
    );
    assertEquals(
      (await collectIssues(
        "docs/guides/example.mdx",
        '<a href={\n  "https://github.com/example-org/private\\x2dexamples"\n}>x</a>',
        BLOCKED_REPOSITORY,
      )).length,
      1,
    );
    assertEquals(
      (await collectIssues(
        "docs/guides/example.mdx",
        `https://github.com/${BLOCKED_REPOSITORY} ` +
          '<a href={"https://github.com/example-org/private\\x2dexamples"}>x</a>',
        BLOCKED_REPOSITORY,
      )).length,
      1,
    );
    assertEquals(
      (await collectIssues(
        "docs/guides/example.md",
        `https://github.com/example-org/private%2Dexamples/${
          "%FF".repeat(512)
        }`,
        BLOCKED_REPOSITORY,
      )).length,
      1,
    );
  });

  it("finds destinations that wrap across lines", async () => {
    assertEquals(
      await destinations("[gate](\n../architecture/wrapped.md)"),
      ["../architecture/wrapped.md"],
    );
    assertEquals(
      await destinations("[some\ntext](../architecture/text.md)"),
      ["../architecture/text.md"],
    );
    assertEquals(
      await destinations(
        '> <a href="../architecture/wrapped\n> .md">wrapped</a>',
      ),
      ["../architecture/wrapped\n.md"],
    );
    for (const blankLine of ["\n\n", "\r\n\r\n", "\n \t\n"]) {
      assertEquals(
        await destinations(
          `[some${blankLine}text](../architecture/not-a-link.md)`,
        ),
        [],
      );
    }
    assertEquals(
      await destinations(
        "[some\n\ntext]: ../architecture/not-a-definition.md\n\n[some text]",
      ),
      [],
    );
    assertEquals(
      await destinations("[gate]\n\n[gate]:\n../architecture/reference.md"),
      ["../architecture/reference.md"],
    );
  });

  it("ends a reference definition at a blank line", async () => {
    assertEquals(
      await destinations("[gate]\n\n[gate]:\n\n../architecture/orphan.md"),
      [],
    );
    assertEquals(
      await destinations(
        "[old]\nIntro paragraph.\n[old]: ../architecture/not-a-definition.md",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "[old]\n\n- Intro\n  [old]: ../architecture/list-paragraph.md",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "[old]\n\n[old]: ../architecture/pri)vate.md",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "[old]\n\n[old]: ../architecture/pri(vate).md",
      ),
      ["../architecture/pri(vate).md"],
    );
    assertEquals(
      await destinations(
        "[public]: ./deploying.md\n" +
          '  "https://veryfront.com/docs/code/guides/does-not-exist"\n\n' +
          "[link][public]",
      ),
      ["./deploying.md"],
    );
    for (const indentation of ["    ", "\t"]) {
      assertEquals(
        await destinations(
          "[public]: ./deploying.md\n" +
            `${indentation}"https://veryfront.com/docs/code/guides/title"\n\n` +
            "[public]",
        ),
        ["./deploying.md"],
      );
    }
    assertEquals(
      await destinations(
        '[public]: ./deploying.md "first\n' +
          'https://veryfront.com/docs/code/guides/title"\n\n' +
          "[public]",
      ),
      ["./deploying.md"],
    );
    assertEquals(
      await destinations(
        '[public]: ./deploying.md "[hidden](../architecture/private.md)"\n\n' +
          "[public]",
      ),
      ["./deploying.md"],
    );
    assertEquals(
      await destinations(
        "[public]: ./deploying.md\n" +
          '  "[hidden](../architecture/private.md)"\n\n' +
          "[public]",
      ),
      ["./deploying.md"],
    );
    assertEquals(
      await destinations(
        '[public]: ./deploying.md "first\n' +
          '[hidden](../architecture/private.md)"\n\n' +
          "[public]",
      ),
      ["./deploying.md"],
    );
    assertEquals(
      await scanDestinations(
        '[unused]: ./deploying.md\r  "https://veryfront.com/docs/code/guides/does-not-exist"',
        "markdown",
      ),
      [],
    );
  });

  it("does not let reference definitions interrupt paragraphs", async () => {
    assertEquals(
      await destinations(
        "[old]\nIntro paragraph.\n" +
          "[old]: ../architecture/private.md",
      ),
      [],
    );
    assertEquals(
      await destinations("[old]\n\n[old]: ../architecture/real.md"),
      ["../architecture/real.md"],
    );
    for (const newline of ["\n", "\r\n"]) {
      assertEquals(
        (await collectUnpublishedLinkIssues(
          "README.md",
          `<!-- note -->${newline}` +
            `[gate]: docs/architecture/private.md${newline}${newline}[gate]`,
        )).map((issue) => issue.line),
        [2],
      );
      for (const tag of ["pre", "script", "style", "textarea"]) {
        assertEquals(
          (await collectUnpublishedLinkIssues(
            "README.md",
            `<${tag}>${newline}</${tag}>${newline}` +
              `[gate]: docs/architecture/private.md${newline}${newline}` +
              "[gate]",
          )).map((issue) => issue.line),
          [3],
        );
      }
    }
    assertEquals(
      await collectUnpublishedLinkIssues(
        "README.md",
        "<script>\n" +
          "[gate]: docs/architecture/private.md\n\n" +
          "[gate]",
      ),
      [],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "README.md",
        "<div>\n</div>\n" +
          "[gate]: docs/architecture/private.md\n\n" +
          "[gate]",
      ),
      [],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "> <script>\n> </script>\n" +
          "[gate]: docs/architecture/private.md\n\n" +
          "[gate]",
      )).map((issue) => issue.line),
      [3],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "README.md",
        "text <!-- note -->\n" +
          "[gate]: docs/architecture/private.md\n\n[gate]",
      ),
      [],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "README.md",
        "<!-- note\n[gate]: docs/architecture/private.md\n\n[gate]",
      ),
      [],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "> <!-- note -->\n" +
          "> [gate]: docs/architecture/private.md\n" +
          ">\n" +
          "> [gate]",
      )).map((issue) => issue.line),
      [2],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "- <!-- note -->\n" +
          "  [gate]: docs/architecture/private.md\n\n" +
          "  [gate]",
      )).map((issue) => issue.line),
      [2],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "> <!-- note -->\n" +
          "[gate]: docs/architecture/private.md\n\n" +
          "[gate]",
      )).map((issue) => issue.line),
      [2],
    );
    assertEquals(
      await destinations(
        "> Intro\n[old]: ../architecture/lazy-quote.md\n\n[old]",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "- Intro\n  [old]: ../architecture/lazy-list.md\n\n[old]",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "Intro\n2. [old]: ../architecture/ordered.md\n\n[old]",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "- Intro\n  2. [old]: ../architecture/nested-ordered.md\n\n" +
          "     [old]",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "Intro\n1. [old]: ../architecture/ordered.md\n\n[old]",
      ),
      ["../architecture/ordered.md"],
    );
    assertEquals(
      await destinations(
        "1. Intro\n2. [old]: ../architecture/ordered-sibling.md\n\n[old]",
      ),
      ["../architecture/ordered-sibling.md"],
    );
    assertEquals(
      await destinations(
        "9. Intro\n10. [old]: ../architecture/wide-ordered-sibling.md\n\n" +
          "[old]",
      ),
      ["../architecture/wide-ordered-sibling.md"],
    );
    assertEquals(
      await destinations(
        "    code\n[after-code]: ../architecture/after-code.md\n\n[after-code]",
      ),
      ["../architecture/after-code.md"],
    );
  });

  it("finds a reference definition below the first line", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[gate]\nIntro paragraph.\n\n" +
        "[gate]: ../architecture/private.md\n",
    );

    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.line, 4);
  });

  it("reads a string literal in a JSX href expression", async () => {
    assertEquals(
      await mdxDestinations('<a href={"../architecture/literal.md"}>gate</a>'),
      ["../architecture/literal.md"],
    );
    assertEquals(
      await mdxDestinations("<a href={'../architecture/single.md'}>gate</a>"),
      ["../architecture/single.md"],
    );
    assertEquals(
      await mdxDestinations("<a href={`../architecture/template.md`}>gate</a>"),
      ["../architecture/template.md"],
    );
    assertEquals(
      await mdxDestinations(
        '<a href={("../architecture/parenthesized.md")}>gate</a>',
      ),
      ["../architecture/parenthesized.md"],
    );
    assertEquals(
      await mdxDestinations(
        '<a href={(( "../architecture/nested.md" ))}>gate</a>',
      ),
      ["../architecture/nested.md"],
    );
    assertEquals(
      await mdxDestinations(
        '<a href={/* note */ "../architecture/leading-comment.md"}>gate</a>\n' +
          '<a href={"../architecture/trailing-comment.md" /* note */}>gate</a>\n' +
          '<a href={(/* note */ "../architecture/parenthesized-comment.md")}>gate</a>\n' +
          '<a href={// note\n"../architecture/line-comment.md"}>gate</a>\n' +
          '<img src={/* note */ "../architecture/commented-source.png"} />',
      ),
      [
        "../architecture/leading-comment.md",
        "../architecture/trailing-comment.md",
        "../architecture/parenthesized-comment.md",
        "../architecture/line-comment.md",
        "../architecture/commented-source.png",
      ],
    );
    for (
      const source of [
        '<a href={("../architecture/missing-close.md"}>gate</a>',
        '<a href={"../architecture/missing-open.md")}>gate</a>',
        '<a href={(("../architecture/too-few.md")}>gate</a>',
        '<a href={("../architecture/too-many.md"))}>gate</a>',
      ]
    ) {
      await assertRejects(
        () => mdxDestinations(source),
        PublicDocSyntaxError,
        "Invalid MDX syntax",
      );
    }
  });

  it("evaluates JavaScript escapes in a JSX href string literal", async () => {
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        String.raw`<a href={".\u002fdeploying.md"}>deploy</a>`,
        publishedFiles("docs/guides/deploying.md"),
      ),
      [],
    );
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.mdx",
      String.raw`<a href={'.\x2e/architecture/private.md'}>private</a>`,
    );
    assertEquals(issues.length, 1);
    assertEquals(
      issues[0]?.message.includes("docs/architecture/private.md"),
      true,
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        '<a href={"./deploying.md&#35;section"}>broken</a>\n' +
          '<a href="./deploying.md&#35;section">published</a>',
        publishedFiles("docs/guides/deploying.md"),
      )).length,
      1,
    );
  });

  it("uses parser-cooked JavaScript destination values", async () => {
    const lineSeparator = "\u2028";
    assertEquals(
      await mdxDestinations(
        `<a href={"../architecture/string\\${lineSeparator}.md"}>string</a>\n` +
          `<a href={\`../architecture/template\\${lineSeparator}.md\`}>template</a>`,
      ),
      [
        "../architecture/string.md",
        "../architecture/template.md",
      ],
    );
  });

  it("preserves character references in JSX expression strings", async () => {
    const published = publishedFiles("docs/guides/deploying.md");
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        '<a href={"./deploying.md&#35;section"}>deploy</a>',
        published,
      )).length,
      1,
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        '<a href="./deploying.md&#35;section">deploy</a>\n' +
          "[deploy](./deploying.md&#35;section)",
        published,
      ),
      [],
    );
  });

  it("ignores a dynamic JSX href expression", async () => {
    assertEquals(await mdxDestinations("<a href={href}>gate</a>"), []);
    assertEquals(
      await mdxDestinations("<a href={`../${section}/private.md`}>gate</a>"),
      [],
    );
    assertEquals(
      await mdxDestinations(
        '<a href={/* note */ "../architecture/private.md" + suffix}>gate</a>',
      ),
      [],
    );
  });

  it("validates Veryfront absolute documentation URLs", async () => {
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "[private](https://veryfront.com/docs/code/architecture/private) " +
          "[encoded](https://veryfront.com/docs/%63ode/architecture/private) " +
          "[http](http://veryfront.com/docs/code/architecture/private)",
      )).length,
      3,
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "[public](https://veryfront.com/docs/code/guides/deploying)",
        publishedFiles("docs/guides/deploying.md"),
      ),
      [],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "[other service](https://veryfront.com:8443/docs/code/architecture/private)",
      ),
      [],
    );
  });

  it("validates site-root code destinations", async () => {
    const issues = await collectUnpublishedLinkIssues(
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

  it("decodes Markdown character references before resolving destinations", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[decimal] [hex] [named]\n\n" +
        "[decimal]: &#46;&#46;/architecture/decimal.md\n" +
        "[hex]: &#x2e;&#x2e;/architecture/hex.md\n" +
        "[named]: &period;&period;&sol;architecture/named.md",
    );

    assertEquals(issues.length, 3);
  });

  it("decodes Markdown escapes before resolving destinations", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[gate]\n\n" + String.raw`[gate]: \../architecture/private.md`,
    );

    assertEquals(issues.length, 1);
  });

  it("resolves query-only destinations against the current page", async () => {
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/integrations/jira.md",
        "[cloud](?tab=cloud)",
        publishedFiles("docs/guides/integrations/jira.md"),
      ),
      [],
    );
  });

  it("rejects missing files in newly parsed destination forms", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      '<a href="./does-not-exist.md">missing</a>\n' +
        "<a href=\"'./quote-does-not-exist.md'\">quoted</a>\n" +
        "[missing]\n\n" +
        "[missing]: ./also-does-not-exist.md",
    );

    assertEquals(issues.length, 3);
  });

  it("finds reference definitions inside block quotes", async () => {
    assertEquals(
      await destinations(
        "[gate] [wrapped]\n" +
          "> [gate]: ../architecture/private.md\n" +
          "> [wrapped]:\n> ../architecture/wrapped.md",
      ),
      ["../architecture/private.md", "../architecture/wrapped.md"],
    );
  });

  it("finds reference definitions inside list containers", async () => {
    assertEquals(
      await destinations(
        "[gate] [wrapped]\n" +
          "- [gate]: ../architecture/private.md\n" +
          "- [wrapped]:\n  ../architecture/wrapped.md",
      ),
      ["../architecture/private.md", "../architecture/wrapped.md"],
    );
  });

  it("does not treat footnote definitions as link definitions", async () => {
    assertEquals(
      await destinations("[^note]: Explanation of the behavior"),
      [],
    );
  });

  it("ignores unused reference definitions", async () => {
    assertEquals(
      await destinations("[old]: ../architecture/private.md"),
      [],
    );
    assertEquals(
      await destinations(
        "[old]: <https://veryfront.com/docs/code/architecture/private>",
      ),
      [],
    );
    assertEquals(
      await destinations(
        "[old]\n\n" +
          "[old]: <https://veryfront.com/docs/code/architecture/private>",
      ),
      ["https://veryfront.com/docs/code/architecture/private"],
    );
    assertEquals(
      await destinations(
        "[nested [old]](./public.md)\n\n" +
          "[old]: ../architecture/private.md",
      ),
      ["../architecture/private.md"],
    );
    assertEquals(
      await destinations(
        '[inline](./public.md "[old]")\n\n' +
          "[old]: ../architecture/private.md",
      ),
      ["./public.md"],
    );
  });

  it("ignores Markdown destinations inside code", async () => {
    assertEquals(
      await destinations(
        "`[inline](../architecture/inline.md)`\n" +
          "`sample\r\n\r\n[crlf](../architecture/crlf-code-span.md)`\n" +
          "```md\n[example](../architecture/fenced.md)\n```\n" +
          "    [indented](../architecture/indented.md)\n" +
          '    <a href="../architecture/html.md">HTML</a>\n' +
          "    [reference]: ../architecture/reference.md\n" +
          "    <https://veryfront.com/docs/code/architecture/autolink>\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/crlf-code-span.md", "../architecture/real.md"],
    );
    assertEquals(
      await destinations(
        "`[example](\n../architecture/private.md)`\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await destinations(
        "`[example](../architecture/private.md)\\`\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await destinations(
        ">     [quoted](../architecture/quoted.md)\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await destinations(
        "`unmatched\n" +
          "```md\n[fenced](../architecture/fenced.md)\n```\n" +
          "[real](../architecture/real.md)\n`",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await destinations(
        "# Heading\n    [atx](../architecture/atx.md)\n" +
          "\nSetext\n=======\n    [setext](../architecture/setext.md)\n" +
          "\n---\n    [thematic](../architecture/thematic.md)",
      ),
      [],
    );
  });

  it("ends code spans at bare-CR paragraph boundaries", async () => {
    assertEquals(
      await destinations("`sample\r\r[x](docs/architecture/private.md)`"),
      ["docs/architecture/private.md"],
    );
    assertEquals(
      await destinations("[`sample\r\r]`](../architecture/private.md)"),
      [],
    );
    assertEquals(
      await destinations("`[hidden](../architecture/hidden.md)\rcontinuation`"),
      [],
    );
  });

  it("ignores fenced code inside block containers", async () => {
    assertEquals(
      await destinations(
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
      await destinations(
        "``` md`bad\n" +
          "[rendered](../architecture/rendered.md)",
      ),
      ["../architecture/rendered.md"],
    );
    assertEquals(
      await destinations(
        "\t```md\n" +
          "[rendered](../architecture/tab-rendered.md)",
      ),
      ["../architecture/tab-rendered.md"],
    );
    assertEquals(
      await destinations(
        "> ```md\n" +
          "> [quoted](../architecture/quoted.md)\n" +
          "[root](../architecture/root.md)\n" +
          "> ```",
      ),
      ["../architecture/root.md"],
    );
    assertEquals(
      await destinations(
        "- ```md\n" +
          "  [listed](../architecture/listed.md)\n" +
          "[root](../architecture/root.md)\n" +
          "  ```",
      ),
      ["../architecture/root.md"],
    );
    assertEquals(
      await destinations(
        "```md\r\n" +
          "[hidden](../architecture/hidden.md)\r\n" +
          "```\r\n" +
          "[rendered](../architecture/crlf.md)",
      ),
      ["../architecture/crlf.md"],
    );
    assertEquals(
      await destinations(
        "   ```md\n" +
          "[hidden](../architecture/hidden.md)\n" +
          "```\n" +
          "[rendered](../architecture/root-indented-fence.md)",
      ),
      ["../architecture/root-indented-fence.md"],
    );
    assertEquals(
      await destinations(
        "```md\n" +
          "- ```\n" +
          "[still code](../architecture/still-code.md)",
      ),
      [],
    );
  });

  it("scans rendered paragraphs indented inside list items", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "- Details:\n\n    [gate](../architecture/private.md)",
    );

    assertEquals(issues.length, 1);
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "Intro\n    [gate](../architecture/private.md)",
      )).length,
      1,
    );
  });

  it("ignores destinations inside MDX comments", async () => {
    assertEquals(
      await mdxDestinations(
        "{/* [old](../architecture/private.md) */}\n" +
          '{/*\n<a href="../architecture/html.md">old</a>\n*/}\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "`{/*`\n" +
          "[inline](../architecture/inline.md)\n" +
          "{/* real comment */}",
      ),
      ["../architecture/inline.md"],
    );
    assertEquals(
      await mdxDestinations(
        "```md\n{/*\n```\n" +
          "[fenced](../architecture/fenced.md)\n" +
          "{/* real comment */}",
      ),
      ["../architecture/fenced.md"],
    );
    assertEquals(
      await mdxDestinations(
        '{"{/*"}\n' +
          "[gate](../architecture/private.md)\n" +
          "{/* real */}",
      ),
      ["../architecture/private.md"],
    );
    await assertRejects(
      () =>
        mdxDestinations(
          "Unmatched prose {\n\n" +
            "{/* [old](../architecture/commented.md) */}\n" +
            "[real](../architecture/real.md)",
        ),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
    assertEquals(
      await mdxDestinations(
        '{"[plain](../architecture/expression.md)"}\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
  });

  it("scans MDX-only syntax as Markdown in README files", async () => {
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "README.md",
        "{/* [visible](docs/guides/does-not-exist.md) */}",
      )).map((issue) => issue.line),
      [1],
    );
  });

  it("ignores destinations inside HTML comments", async () => {
    assertEquals(
      (await scanDestinations(
        "<!-- [old](../architecture/markdown.md)\n" +
          '<a href="../architecture/html.md">old</a>\n' +
          "https://veryfront.com/docs/code/architecture/autolink -->\n" +
          "[real](../architecture/real.md)",
        "markdown",
      )).map((destination) => destination.href),
      ["../architecture/real.md"],
    );
    assertEquals(
      await scanDestinations(
        "<!-- [hidden](../architecture/unclosed.md)\n" +
          "https://veryfront.com/docs/code/architecture/also-hidden",
        "markdown",
      ),
      [],
    );
    assertEquals(
      (await scanDestinations(
        "before <!-- unfinished\n" +
          "[gate](../architecture/private.md)",
        "markdown",
      )).map((destination) => destination.href),
      ["../architecture/private.md"],
    );
    assertEquals(
      (await scanDestinations(
        String.raw`\<!-- [visible](../architecture/escaped.md) -->` +
          '\ntext <div title="<!--"></div>\n' +
          "[real](../architecture/real.md)",
        "markdown",
      )).map((destination) => destination.href),
      ["../architecture/escaped.md", "../architecture/real.md"],
    );
    assertEquals(await destinations("<!--".repeat(1_000)), []);
  });

  it("ignores Markdown syntax inside complete MDX expressions", async () => {
    assertEquals(
      await mdxDestinations(
        '{"[expression](../architecture/private.md)"}\n' +
          '{condition && <a href="../architecture/expression.md">link</a>}\n' +
          "{\ntrue\n\n" +
          '    ? <a href="../architecture/multiline.md">link</a>\n' +
          "    : null\n}\n" +
          "{'<a href=\"../architecture/string.md\">old</a>'}\n" +
          '{"<https://veryfront.com/docs/code/architecture/autolink>"}\n' +
          "[real](../architecture/real.md)",
      ),
      [
        "../architecture/real.md",
        "../architecture/expression.md",
        "../architecture/multiline.md",
      ],
    );
    assertEquals(
      await mdxDestinations(
        '{true /* } */ ? "[plain](../architecture/comment.md)" : ""}\n' +
          '{true // }\n ? "[line](../architecture/line-comment.md)" : ""}\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        '{/<}>/.test(value) ? "[old](../architecture/regex.md)" : ""}\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        '{new /[}]/ ? "[old](../architecture/new-regex.md)" : ""}\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    await assertRejects(
      () =>
        mdxDestinations(
          "export const sample = `${x++ / value} / ` +\n" +
            "[old](../architecture/postfix.md)",
        ),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
    assertEquals(
      await mdxDestinations(
        "export const sample = `${++/{/.lastIndex} / \\` " +
          "[old](../architecture/prefix-update.md)`",
      ),
      [],
    );
    assertEquals(
      await mdxDestinations(
        '{(() => { if (value) /[}]/.test(value); return "[old](../architecture/expression-control.md)"; })()}\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        '{(() => { for (item1 of /[}]/.source) {} return "[old](../architecture/expression-for-of.md)"; })()}\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export const sample = `${(() => { for (item_ of /[}]/.source) {} return '[old](../architecture/template-for-of.md)'; })()}`\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export const sample = `${--/}/.lastIndex} / \\` " +
          "[old](../architecture/prefix-decrement.md)`",
      ),
      [],
    );
  });

  it("ignores Markdown syntax inside MDX ESM blocks", async () => {
    assertEquals(
      await mdxDestinations(
        'import value from "example"\n' +
          "export const checked = /[}]/.test(value)\n" +
          'export const hidden = "[old](../architecture/import-regex.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export { value } from "example"\n' +
          "export const checked = /[}]/.test(value)\n" +
          'export const hidden = "[old](../architecture/export-regex.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample() {}\n" +
          "export const checked = /[}]/.test(value);\n" +
          'export const hidden = "[old](../architecture/block-regex.md)";\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export default async function* sample() {}\n" +
          "export const checked = /[}]/.test(value);\n" +
          'export const hidden = "[old](../architecture/async-block-regex.md)";\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export class Sample {}\n" +
          "export const checked = /[}]/.test(value);\n" +
          'export const hidden = "[old](../architecture/class-block-regex.md)";\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export default class Sample extends Base {}\n" +
          "export const checked = /[}]/.test(value);\n" +
          'export const hidden = "[old](../architecture/default-class-block-regex.md)";\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export class Sample extends mixin({ marker: "ok" }) {}\n' +
          "export const checked = /[}]/.test(value);\n" +
          'export const hidden = "[old](../architecture/class-extends-string-regex.md)";\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export class Sample extends mixin({ test: /[}]/ }) {}\n" +
          "export const checked = /[}]/.test(value);\n" +
          'export const hidden = "[old](../architecture/class-extends-regex.md)";\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample(value) {\n" +
          "  try {} catch {}\n" +
          "  /[}]/.test(value);\n" +
          '  return "[old](../architecture/catch-block-regex.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample(input) {\n" +
          "  let first, second\n" +
          "  /[}]/.test(input);\n" +
          "  var third, fourth\n" +
          "  /[}]/.test(input);\n" +
          '  return "[old](../architecture/declaration-list-asi.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample(input) {\n" +
          "  let first = <Foo>{input}</Foo>\n" +
          '  / ({ marker: "}/" }).length;\n' +
          '  return "[old](../architecture/jsx-initializer-division.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample(input) {\n" +
          "  let first = <Foo />, second\n" +
          "  /[}]/.test(input);\n" +
          '  return "[old](../architecture/jsx-list-regex.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample(value) {\n" +
          "  {}\n" +
          "  /[}]/.test(value);\n" +
          '  return "[old](../architecture/statement-block-regex.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export const sample = function () {}\n" +
          '/ ({ marker: "}/" }).length;\n' +
          'export const hidden = "[old](../architecture/function-division.md)";\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export const Sample = (class {}) / ({ marker: "}/" }).length;\n' +
          'export const arrow = (() => {}) / ({ marker: "}/" }).length;\n' +
          'export const object = ({}) / ({ marker: "}/" }).length;\n' +
          'export const hidden = "[old](../architecture/expression-division.md)";\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    await assertRejects(
      () =>
        mdxDestinations(
          "export const sample = <Foo>" +
            "[old](../architecture/mismatched-jsx.md)</Bar>",
        ),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
    assertEquals(
      await mdxDestinations(
        'import sample from "[old](../architecture/import.md)"\n' +
          "export const metadata = {\n" +
          '  sample: "[old](../architecture/export.md)",\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export const increment = ++/{/.lastIndex ? "[old](../architecture/prefix.md)" : ""\n' +
          'export const decrement = --/}/.lastIndex ? "[old](../architecture/prefix-decrement.md)" : ""\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export const increment = value++ / total ? "[old](../architecture/postfix.md)" : ""\n' +
          'export const decrement = value-- / total ? "[old](../architecture/postfix-decrement.md)" : ""\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export const value = sample\n" +
          "export const updated = ++/{/.lastIndex\n" +
          'export const hidden = "[old](../architecture/line-break.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export function sample(value) { if (value) /[}]/.test(value); return "[old](../architecture/control-header.md)"; }\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export async function sample(items, value) {\n" +
          "  for await (const item of items) /[}]/.test(item);\n" +
          "  if (value) {} else /[}]/.test(value);\n" +
          "  do /[}]/.test(value); while (false);\n" +
          '  return "[old](../architecture/statement-context.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample() {\n" +
          "  for (π of /[}]/.source) {}\n" +
          '  return "[old](../architecture/esm-for-of.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample(value) {\n" +
          "  outer1: while (value) {\n" +
          "    break outer1\n" +
          "    /[}]/.test(value);\n" +
          "  }\n" +
          "  while (value) {\n" +
          "    break\n" +
          "    /[}]/.test(value);\n" +
          "  }\n" +
          "  \\u03c0: while (value) {\n" +
          "    continue \\u03c0\n" +
          "    /[}]/.test(value);\n" +
          "  }\n" +
          "  while (value) {\n" +
          "    continue\n" +
          "    /[}]/.test(value);\n" +
          "  }\n" +
          "  debugger\n" +
          "  /[}]/.test(value);\n" +
          '  return "[old](../architecture/asi-statement.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export const sample = `${(() => { if (value) /[}]/.test(value); return "[old](../architecture/template-control.md)"; })()}`\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        'export const sample = [\n  "[old](../architecture/private.md)",\n];\n\n' +
          "[real](../architecture/also-private.md)",
      )).map((issue) => issue.line),
      [5],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        'export const sample = {\n\n  old: "[old](../architecture/private.md)",\n};',
      ),
      [],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        "export const sample = condition\n" +
          '  ? "[old](../architecture/ternary.md)"\n' +
          '  : ""',
      ),
      [],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        ' export const sample = "[old](../architecture/indented.md)"',
      )).length,
      1,
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        'export const sample = condition\n  ? "[old](../architecture/private.md)"\n' +
          '  : ""\n\n[real](../architecture/real.md)',
      )).map((issue) => issue.line),
      [5],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        'export const sample = `x ${"`"} [old](../architecture/private.md)`',
      ),
      [],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        'export const sample = `${foo / /}`/.test(x) ? "[old](../architecture/private.md)" : ""}`',
      ),
      [],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.mdx",
        "export const sample = `${/a/ / value} / \\` [old](../architecture/private.md)`",
      ),
      [],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        'export const sample = "[old](../architecture/markdown.md)"',
      )).length,
      1,
    );
  });

  it("keeps regex and division grammar after module declarations", async () => {
    assertEquals(
      await mdxDestinations(
        'import sample from "sample"\n' +
          "export const checked = /[}]/.test(sample)\n" +
          'export const hidden = "[old](../architecture/import-regex.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export { sample } from "sample"\n' +
          "export const checked = /[}]/.test(sample)\n" +
          'export const hidden = "[old](../architecture/export-regex.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export default value\n" +
          '/ ({ marker: "}/" }).length\n' +
          'export const hidden = "[old](../architecture/export-division.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "import sample\n" +
          'from "sample"\n' +
          "export const checked = /[}]/.test(sample)\n" +
          'export const hidden = "[old](../architecture/multiline-import-regex.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export { sample }\n" +
          'from "sample"\n' +
          "export const checked = /[}]/.test(sample)\n" +
          'export const hidden = "[old](../architecture/multiline-export-regex.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    await assertRejects(
      () =>
        mdxDestinations(
          'import data from "sample"\n' +
            'with { type: "json" }\n' +
            "export const checked = /[}]/.test(data)\n" +
            'export const hidden = "[old](../architecture/import-attributes-regex.md)"',
        ),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
    assertEquals(
      await mdxDestinations(
        'export const sample = import("sample");\n' +
          "export const checked = /[}]/.test(sample)\n" +
          'export const hidden = "[old](../architecture/dynamic-import-regex.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        'export const sample = import("sample")\n' +
          '/ ({ marker: "}/" }).length\n' +
          'export const hidden = "[old](../architecture/dynamic-import-division.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export const sample = import.meta.url;\n" +
          "export const checked = /[}]/.test(sample)\n" +
          'export const hidden = "[old](../architecture/import-meta-regex.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export const sample = import.meta.url\n" +
          '/ ({ marker: "}/" }).length\n' +
          'export const hidden = "[old](../architecture/import-meta-division.md)"\n\n' +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
  });

  it("keeps labeled blocks in statement context in MDX ESM", async () => {
    assertEquals(
      await mdxDestinations(
        "export function sample(value) {\n" +
          "label: { {} /[}]/.test(value); }\n" +
          'return "[old](../architecture/labeled-block-regex.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
    assertEquals(
      await mdxDestinations(
        "export function sample(value) {\n" +
          'label: { value / ({ marker: "}/" }).length; }\n' +
          'return "[old](../architecture/labeled-block-division.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
  });

  it("keeps labels after control headers in statement context", async () => {
    assertEquals(
      await mdxDestinations(
        "export function sample(value) {\n" +
          "if (value) label: {}\n" +
          "/[}]/.test(value)\n" +
          'return "[old](../architecture/control-label-regex.md)"\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
  });

  it("starts declarations after ASI line breaks", async () => {
    assertEquals(
      await mdxDestinations(
        "export function sample(value) {\n" +
          "doSomething()\n" +
          "class Inner {}\n" +
          "/[}]/.test(value)\n" +
          'return "[old](../architecture/asi-declaration-regex.md)"\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
  });

  it("starts labels after ASI line breaks", async () => {
    assertEquals(
      await mdxDestinations(
        "export function sample(value) {\n" +
          "doSomething()\n" +
          "label: {}\n" +
          "/[}]/.test(value)\n" +
          'return "[old](../architecture/asi-label-regex.md)"\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
  });

  it("keeps switch clause blocks in statement context in MDX ESM", async () => {
    assertEquals(
      await mdxDestinations(
        "export function sample(x, condition, value) {\n" +
          "switch (x) {\n" +
          "case 1: { {} /[}]/.test(x); }\n" +
          "case condition ? 2 : 3: { {} /[}]/.test(x); }\n" +
          'default: { value / ({ marker: "}/" }).length; }\n' +
          "}\n" +
          'return "[old](../architecture/switch-clause-regex.md)";\n' +
          "}\n\n" +
          "[real](../architecture/real.md)",
      ),
      ["../architecture/real.md"],
    );
  });

  it("scans division-heavy MDX ESM template interpolations in linear time", async () => {
    const interpolation = Array.from({ length: 1_001 }, () => "value").join(
      "/",
    );
    const source = "export const sample = `value ${" + interpolation +
      "}`\n\n[real](../architecture/real.md)";
    const startedAt = performance.now();

    assertEquals(await mdxDestinations(source), ["../architecture/real.md"]);
    const capacitySource = "export const sample = `value ${" +
      Array.from({ length: 32_001 }, () => "value").join("/") + "}`";
    await assertRejects(
      () => mdxDestinations(capacitySource),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
    assertLess(
      performance.now() - startedAt,
      2_000,
      "division-heavy template interpolation scanning must stay linear",
    );
  });

  it("scans long MDX ESM identifiers in linear time", async () => {
    const identifier = `value${"x".repeat(32_000)}`;
    const source = `export const ${identifier} = 1\n\n` +
      "[real](../architecture/real.md)";
    const startedAt = performance.now();

    assertEquals(await mdxDestinations(source), ["../architecture/real.md"]);
    assertLess(
      performance.now() - startedAt,
      2_000,
      "long identifier scanning must stay linear",
    );
  });

  it("propagates malformed nested JSX diagnostics", async () => {
    const depth = 64;
    const source = "<a data-ok={" +
      "<A value={".repeat(depth) +
      "null}".repeat(depth) + ">";

    await assertRejects(
      () => mdxDestinations(source),
      PublicDocSyntaxError,
      "Invalid MDX syntax",
    );
  });

  it("preserves destinations after nested JSX", async () => {
    const depth = 64;
    const source = "<a data-ok={" +
      "<A>{".repeat(depth) +
      "value" +
      "}</A>".repeat(depth) +
      '} href="../architecture/deep-jsx.md">ok</a>';

    assertEquals(await mdxDestinations(source), [
      "../architecture/deep-jsx.md",
    ]);
  });

  it("preserves destinations after nested JSX attributes", async () => {
    const depth = 64;
    const source = "<a data-ok={" +
      "<A value={".repeat(depth) +
      "null" +
      "} />".repeat(depth) +
      '} href="../architecture/deep-jsx-attributes.md">ok</a>';

    assertEquals(await mdxDestinations(source), [
      "../architecture/deep-jsx-attributes.md",
    ]);
  });

  it("uses parser grammar for nested JSX attributes and their JavaScript context", async () => {
    assertEquals(
      await mdxDestinations(
        '{<Card {...props} href="../architecture/nested-spread.md" />}',
      ),
      ["../architecture/nested-spread.md"],
    );
    assertEquals(
      await mdxDestinations(
        "{(function* () { return <Card value={yield source} /> })}",
      ),
      [],
    );
    const invalid = await collectIssues(
      "docs/guides/example.mdx",
      '{<Card href=="../architecture/not-rendered.md" />}',
    );
    assertEquals(invalid.length, 1);
    assertStringIncludes(invalid[0]?.message ?? "", "Fix invalid MDX syntax");
  });

  it("validates SVG destinations at every JSX depth and spelling", async () => {
    assertEquals(
      await mdxDestinations(
        '<svg><a xlinkHref="../architecture/top-svg.md" /></svg>\n' +
          '<svg><a xlink:href={"../architecture/top-colon-svg.md"} /></svg>\n' +
          '{<svg><a xlinkHref={"../architecture/nested-svg.md"} />' +
          '<a xlink:href="../architecture/nested-colon-svg.md" /></svg>}',
      ),
      [
        "../architecture/top-svg.md",
        "../architecture/top-colon-svg.md",
        "../architecture/nested-svg.md",
        "../architecture/nested-colon-svg.md",
      ],
    );
  });

  it("scans multiline MDX ESM block comments in linear time", async () => {
    const comment = Array.from(
      { length: 80_001 },
      (_, index) => `line ${index} [old](../architecture/private.md)`,
    ).join("\n");
    const source = `export const sample = /*\n${comment}\n*/ "done"\n\n` +
      "[real](../architecture/real.md)";
    const startedAt = performance.now();

    assertEquals(await mdxDestinations(source), ["../architecture/real.md"]);
    assertLess(
      performance.now() - startedAt,
      2_000,
      "multiline block comment scanning must stay linear",
    );
  });

  it("ignores destinations inside initial YAML frontmatter", async () => {
    const source = '---\ntitle: "[sample](./does-not-exist.md)"\n' +
      "canonical: https://veryfront.com/docs/code/architecture/private\n---\n" +
      "[real](../architecture/real.md)";
    assertEquals(
      (await collectUnpublishedLinkIssues("docs/guides/example.md", source))
        .map(
          (issue) => issue.line,
        ),
      [5],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues("docs/guides/example.mdx", source))
        .map(
          (issue) => issue.line,
        ),
      [5],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "Intro\n\n---\n[visible](../architecture/visible.md)\n---",
      )).map((issue) => issue.line),
      [4],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        '---\ntitle: "[visible](./does-not-exist.md)"\n...\n',
      )).map((issue) => issue.line),
      [2],
    );
  });

  it("reports malformed YAML frontmatter through positioned syntax diagnostics", async () => {
    for (const extension of ["md", "mdx"] as const) {
      const issues = await collectIssues(
        `docs/guides/example.${extension}`,
        "---\ntitle: [unterminated\n---\n",
      );
      assertEquals(issues.length, 1);
      assertEquals(issues[0]?.line, 2);
      assertStringIncludes(
        issues[0]?.message ?? "",
        `Fix invalid ${extension === "mdx" ? "MDX" : "Markdown"} syntax`,
      );
      assertStringIncludes(
        issues[0]?.message ?? "",
        "Invalid YAML frontmatter",
      );

      assertEquals(
        await collectIssues(
          `docs/guides/example.${extension}`,
          "---\rtitle: [unterminated\r---\r",
        ),
        [],
      );
      assertEquals(
        await collectIssues(
          `docs/guides/example.${extension}`,
          "---\ntitle: [unterminated\n---   \n",
        ),
        [],
      );

      const inlineFenceIssues = await collectIssues(
        `docs/guides/example.${extension}`,
        "---\ntitle: [---\nVisible",
      );
      assertEquals(inlineFenceIssues.length, 1);
      assertEquals(inlineFenceIssues[0]?.line, 2);
      assertStringIncludes(
        inlineFenceIssues[0]?.message ?? "",
        "Invalid YAML frontmatter",
      );
    }
  });

  it("keeps multiline MDX expressions from opening false comments", async () => {
    assertEquals(
      await mdxDestinations(
        '{\ntrue\n\n? "{/*"\n: ""\n}\n' +
          "[real](../architecture/real.md)\n" +
          '{"*/}"}',
      ),
      ["../architecture/real.md"],
    );
  });

  it("validates Veryfront documentation autolinks", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "<https://veryfront.com/docs/code/architecture/private>\n" +
        "https://veryfront.com/docs/code/architecture/bare\n" +
        String.raw`\https://veryfront.com/docs/code/architecture/backslash` +
        "\n_https://veryfront.com/docs/code/architecture/underscore_",
    );

    assertEquals(issues.length, 4);
    assertEquals(
      await destinations(
        "<user@example.com> user@example.com www.example.com",
      ),
      [
        "mailto:user@example.com",
        "mailto:user@example.com",
        "http://www.example.com",
      ],
    );
    assertEquals(
      await mdxDestinations(
        String.raw`\<https://veryfront.com/docs/code/guides/does-not-exist>`,
      ),
      [],
    );
    for (const source of [
      "<https://veryfront.com/docs/code/guides/does-not-exist>",
      "<user@example.com>",
    ]) {
      await assertRejects(
        () => mdxDestinations(source),
        PublicDocSyntaxError,
        "Invalid MDX syntax",
      );
    }
    assertEquals(
      await destinations(
        "[<https://veryfront.com/docs/code/architecture/label>](./public.md)",
      ),
      [
        "./public.md",
        "https://veryfront.com/docs/code/architecture/label",
      ],
    );
    assertEquals(
      await destinations(
        '[public](./public.md "<https://veryfront.com/docs/code/architecture/title>")',
      ),
      ["./public.md"],
    );
    assertEquals(
      await destinations(
        "[public]\n\n[public]: ./public.md\n" +
          '  "https://veryfront.com/docs/code/architecture/title"',
      ),
      ["./public.md"],
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        '[public](./deploying.md "https://veryfront.com/docs/code/guides/does-not-exist")\n' +
          "*https://veryfront.com/docs/code/guides/deploying*\n" +
          "_https://veryfront.com/docs/code/guides/deploying_\n" +
          "~https://veryfront.com/docs/code/guides/deploying~",
        publishedFiles("docs/guides/deploying.md"),
      ),
      [],
    );
    assertEquals(
      await mdxDestinations(
        "https://veryfront.com/docs/code/architecture/bare.\n" +
          "https://veryfront.com/docs/code/guides/balanced_(path)\n" +
          "https://veryfront.com/docs/code/guides/emphasis*\n" +
          "https://veryfront.com/docs/code/guides/strong_\n" +
          "https://veryfront.com/docs/code/guides/strike~\n" +
          "`https://veryfront.com/docs/code/architecture/code`\n" +
          '{"https://veryfront.com/docs/code/architecture/expression"}',
      ),
      [
        "https://veryfront.com/docs/code/architecture/bare",
        "https://veryfront.com/docs/code/guides/balanced_(path)",
        "https://veryfront.com/docs/code/guides/emphasis",
        "https://veryfront.com/docs/code/guides/strong",
        "https://veryfront.com/docs/code/guides/strike",
      ],
    );
    assertEquals(
      await destinations(
        "https://veryfront.com/docs/code/guides/a[b]\n" +
          "https://veryfront.com/docs/code/guides/a[b]c\n" +
          "https://veryfront.com/docs/code/guides/a{b}}\n" +
          "https://veryfront.com/docs/code/guides/a(b))",
      ),
      [
        "https://veryfront.com/docs/code/guides/a[b",
        "https://veryfront.com/docs/code/guides/a[b]c",
        "https://veryfront.com/docs/code/guides/a{b}}",
        "https://veryfront.com/docs/code/guides/a(b)",
      ],
    );
    assertEquals(
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        "https://veryfront.com/docs/code/guides/a&#35;anchor\n" +
          "<https://veryfront.com/docs/code/guides/a&#35;anchor>\n" +
          String.raw`https://veryfront.com/docs/code/guides/deploying\.md` +
          "\n" +
          String.raw`<https://veryfront.com/docs/code/guides/deploying\.md>`,
        publishedFiles("docs/guides/a.md", "docs/guides/deploying.md"),
      )).length,
      4,
    );
    assertEquals(
      await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        String
          .raw`[deploy](https://veryfront.com/docs/code/guides/deploying\.md)`,
        publishedFiles("docs/guides/deploying.md"),
      ),
      [],
    );
    assertEquals(
      await destinations(
        "[inline](https://veryfront.com/docs/code/guides/inline)\n" +
          '[public](./deploying.md "https://veryfront.com/docs/code/architecture/title")\n' +
          "<https://veryfront.com/docs/code/guides/angle>\n\n" +
          "[unused]: https://veryfront.com/docs/code/architecture/unused",
      ),
      [
        "https://veryfront.com/docs/code/guides/inline",
        "./deploying.md",
        "https://veryfront.com/docs/code/guides/angle",
      ],
    );
    assertEquals(
      await destinations(
        "[https://veryfront.com/docs/code/architecture/label](./public.md)\n" +
          "[https://veryfront.com/docs/code/architecture/reference][public]\n\n" +
          "[public]: ./reference.md",
      ),
      ["./public.md", "./reference.md"],
    );
    assertEquals(
      await destinations(
        "[https://veryfront.com/docs/code/architecture/definition]: ./public.md\n" +
          '[unused]: ./reference.md "https://veryfront.com/docs/code/architecture/title"',
      ),
      [],
    );
    assertEquals(
      await destinations(
        "prefixhttps://veryfront.com/docs/code/architecture/not-an-autolink\n" +
          "_https://veryfront.com/docs/code/guides/underscore-boundary\n" +
          String.raw`\https://veryfront.com/docs/code/architecture/backslash`,
      ),
      [
        "https://veryfront.com/docs/code/guides/underscore-boundary",
        "https://veryfront.com/docs/code/architecture/backslash",
      ],
    );
  });

  it("does not duplicate angle-bracket Markdown destinations as autolinks", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "[private](<https://veryfront.com/docs/code/architecture/private>)",
    );

    assertEquals(issues.length, 1);
  });

  it("validates a URI autolink wrapped in prose parentheses", async () => {
    const issues = await collectUnpublishedLinkIssues(
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

  it("rejects directory routes without an index page", async () => {
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
      (await collectUnpublishedLinkIssues(
        "docs/guides/example.md",
        '<a href="./deploying.md/">deploy</a>',
        publishedFiles("docs/guides/deploying.md"),
      )).length,
      1,
    );
  });

  it("reports the destination line for a multiline MDX href", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.mdx",
      '<a href={\n  "../architecture/private.md"\n}>gate</a>',
    );

    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.line, 2);
    assertEquals(issues[0]?.text, '"../architecture/private.md"');
  });

  it("reports HTML and JSX form submission override destinations", async () => {
    const htmlIssues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      '<button formaction="../architecture/private-html.md">Submit</button>',
      publishedFiles(),
    );
    const jsxIssues = await collectUnpublishedLinkIssues(
      "docs/guides/example.mdx",
      '<Button formAction="../architecture/private-jsx.md" />',
      publishedFiles(),
    );

    assertEquals(htmlIssues.map((issue) => issue.line), [1]);
    assertEquals(jsxIssues.map((issue) => issue.line), [1]);
  });

  it("reports colon-spelled SVG href destinations", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.mdx",
      '<svg><a xlink:href="../architecture/private-top-svg.md" /></svg>\n' +
        '{<svg><a xlink:href={"../architecture/private-nested-svg.md"} /></svg>}',
      publishedFiles(),
    );

    assertEquals(issues.map((issue) => issue.line), [1, 2]);
  });

  it("reports the line the destination sits on", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "One\nTwo\nThree\n[gate](../architecture/private.md)\n",
    );

    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.line, 4);
  });

  it("reports destination text after bare-CR line endings", async () => {
    const issues = await collectUnpublishedLinkIssues(
      "docs/guides/example.md",
      "One\rTwo\r[gate](../architecture/private.md)\r",
    );

    assertEquals(issues.length, 1);
    assertEquals(issues[0]?.line, 3);
    assertEquals(issues[0]?.text, "[gate](../architecture/private.md)");
  });

  it("accepts published relative, directory, anchor, and site-root links", async () => {
    const issues = await collectUnpublishedLinkIssues(
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

  it("reports positioned MDX syntax failures while Markdown stays tolerant", async () => {
    const mdx = await collectIssues(
      "docs/guides/example.mdx",
      "Intro\n\n{const =}",
    );
    const markdown = await collectIssues(
      "docs/guides/example.md",
      "Intro\n\n{const =}",
    );

    assertEquals(mdx.length, 1);
    assertEquals(mdx[0]?.line, 3);
    assertStringIncludes(mdx[0]?.message ?? "", "Fix invalid MDX syntax");
    assertStringIncludes(mdx[0]?.message ?? "", "Unexpected");
    assertEquals(markdown, []);
  });

  it("rejects destination-only scans when parser syntax is invalid", async () => {
    await assertRejects(
      async () => await scanDestinations("{const =}", "mdx"),
      Error,
      "Invalid MDX syntax",
    );
  });
});
