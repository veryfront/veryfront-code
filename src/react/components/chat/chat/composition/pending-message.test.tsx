import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { PendingMessage } from "./pending-message.tsx";

describe("PendingMessage", () => {
  it("renders a busy <output> region with an accessible waiting label", () => {
    const html = renderToString(<PendingMessage />);
    assertStringIncludes(html, "<output");
    assertStringIncludes(html, 'aria-busy="true"');
    assertStringIncludes(html, "Waiting for a response");
  });

  it("renders two skeleton placeholders — an avatar circle and a name bar", () => {
    const html = renderToString(<PendingMessage />);
    const skeletonMatches = html.match(/animate-pulse/g) ?? [];
    assertEquals(skeletonMatches.length, 2, "expected exactly 2 skeleton placeholders");
    assertStringIncludes(html, "rounded-full!");
    assertStringIncludes(html, "w-28!");
  });

  it("merges a custom className onto the outer element", () => {
    const html = renderToString(<PendingMessage className="vf-custom-pending" />);
    assertStringIncludes(html, "vf-custom-pending");
  });
});
