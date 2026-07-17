import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { RichCodeBlock } from "./code-block.tsx";

describe("RichCodeBlock — inline mode", () => {
  it("renders an inline <code> element with no language label or copy button", () => {
    const html = renderToString(<RichCodeBlock code="const x = 1;" inline />);
    assertStringIncludes(html, "<code");
    assertStringIncludes(html, "const x = 1;");
    assert(!html.includes("Copy"), "inline code should not render the copy control");
  });

  it("restyles: className merges onto the inline <code> element", () => {
    const html = renderToString(<RichCodeBlock code="1" inline className="vf-inline" />);
    assertStringIncludes(html, "vf-inline");
  });
});

describe("RichCodeBlock — block mode", () => {
  it("renders the language label and code body when a language is given", () => {
    const html = renderToString(<RichCodeBlock code="const x = 1;" language="ts" />);
    assertStringIncludes(html, "ts");
    assertStringIncludes(html, "const x = 1;");
    assertStringIncludes(html, "language-ts");
  });

  it('falls back to the "text" language label when none is given', () => {
    const html = renderToString(<RichCodeBlock code="plain" />);
    assertStringIncludes(html, ">text<");
  });

  it("renders the un-copied Copy control by default (no clipboard interaction at SSR time)", () => {
    const html = renderToString(<RichCodeBlock code="const x = 1;" language="ts" />);
    assertStringIncludes(html, "Copy");
    assert(!html.includes(">Copied<"), "should not start in the copied state");
  });

  it("restyles: className merges onto the block wrapper", () => {
    const html = renderToString(
      <RichCodeBlock code="const x = 1;" language="ts" className="vf-custom-block" />,
    );
    assertStringIncludes(html, "vf-custom-block");
  });
});
