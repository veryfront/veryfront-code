import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { Markdown } from "./markdown.tsx";

describe("Markdown", () => {
  it("keeps long source links within the chat column", () => {
    const html = renderToString(
      <Markdown>
        {"long-source-link-without-natural-break-points"}
      </Markdown>,
    );

    assertStringIncludes(html, "min-w-0");
    assertStringIncludes(html, "overflow-hidden");
    assertStringIncludes(html, "break-words");
    assertStringIncludes(html, "[overflow-wrap:anywhere]");
  });
});
