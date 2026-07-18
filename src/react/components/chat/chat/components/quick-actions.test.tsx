import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { QuickAction } from "./quick-actions.tsx";
import { QuickActions } from "./quick-actions.tsx";

const actions: QuickAction[] = [
  { id: "summarize", label: "Summarize" },
  { id: "translate", label: "Translate" },
];

describe("QuickActions", () => {
  it("renders nothing when actions is undefined", () => {
    const html = renderToString(<QuickActions />);
    assertEquals(html, "");
  });

  it("renders nothing when actions is an empty array", () => {
    const html = renderToString(<QuickActions actions={[]} />);
    assertEquals(html, "");
  });

  it("renders one button per action, in order", () => {
    const html = renderToString(<QuickActions actions={actions} />);
    assertStringIncludes(html, "Summarize");
    assertStringIncludes(html, "Translate");
    assertEquals(html.indexOf("Summarize") < html.indexOf("Translate"), true);
  });

  it("restyles: className merges onto the wrapper", () => {
    const html = renderToString(<QuickActions actions={actions} className="vf-custom-actions" />);
    assertStringIncludes(html, "vf-custom-actions");
  });
});
