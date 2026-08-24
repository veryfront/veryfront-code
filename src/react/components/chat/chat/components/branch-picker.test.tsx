import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { BranchPicker } from "./branch-picker.tsx";

/** The `<button ...>` open tag whose aria-label matches, from SSR markup. */
function buttonTag(html: string, label: string): string {
  const tag = html.split("<button").find((chunk) => chunk.includes(`aria-label="${label}"`));
  assert(tag, `Expected a button labelled "${label}"`);
  return tag.slice(0, tag.indexOf(">"));
}

function installDomGlobals(dom: JSDOM): () => void {
  return installComponentDom(dom);
}

describe("BranchPicker", () => {
  it("renders the default previous, count, and next controls", () => {
    const html = renderToString(
      <BranchPicker current={2} total={3} onPrev={() => {}} onNext={() => {}} />,
    );

    assertStringIncludes(html, "Previous variant");
    assertStringIncludes(html, "2/3");
    assertStringIncludes(html, "Next variant");
  });

  it("disables the boundary controls", () => {
    const first = renderToString(
      <BranchPicker current={1} total={3} onPrev={() => {}} onNext={() => {}} />,
    );
    assertStringIncludes(
      buttonTag(first, "Previous variant"),
      'disabled=""',
      "Previous is disabled at the first branch",
    );
    assert(
      !buttonTag(first, "Next variant").includes('disabled=""'),
      "Next is enabled at the first branch",
    );

    const last = renderToString(
      <BranchPicker current={3} total={3} onPrev={() => {}} onNext={() => {}} />,
    );
    assert(
      !buttonTag(last, "Previous variant").includes('disabled=""'),
      "Previous is enabled at the last branch",
    );
    assertStringIncludes(
      buttonTag(last, "Next variant"),
      'disabled=""',
      "Next is disabled at the last branch",
    );
  });

  it("wires the previous and next controls to onPrev and onNext", async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(dom);
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);
      let prevCalls = 0;
      let nextCalls = 0;
      flushSync(() => {
        root.render(
          <BranchPicker
            current={2}
            total={3}
            onPrev={() => prevCalls++}
            onNext={() => nextCalls++}
          />,
        );
      });

      const prev = document.querySelector<HTMLButtonElement>('[aria-label="Previous variant"]');
      const next = document.querySelector<HTMLButtonElement>('[aria-label="Next variant"]');
      assert(prev && next, "Expected both branch controls to render");
      flushSync(() => prev.click());
      assertEquals(prevCalls, 1, "clicking Previous calls onPrev once");
      assertEquals(nextCalls, 0, "clicking Previous does not call onNext");
      flushSync(() => next.click());
      assertEquals(nextCalls, 1, "clicking Next calls onNext once");
      assertEquals(prevCalls, 1, "clicking Next does not call onPrev");

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("renders nothing when there is only one branch", () => {
    const html = renderToString(
      <BranchPicker current={1} total={1} onPrev={() => {}} onNext={() => {}} />,
    );
    assertEquals(html, "");
  });

  it("composes and restyles addressable icon leaves", () => {
    const html = renderToString(
      <BranchPicker current={2} total={3} onPrev={() => {}} onNext={() => {}}>
        <BranchPicker.Next className="vf-next">
          <span data-testid="custom-next">next</span>
        </BranchPicker.Next>
        <BranchPicker.Count className="vf-count" />
        <BranchPicker.Previous className="vf-previous">
          <span data-testid="custom-previous">previous</span>
        </BranchPicker.Previous>
      </BranchPicker>,
    );

    assertStringIncludes(html, "custom-next");
    assertStringIncludes(html, "vf-next");
    assertStringIncludes(html, "vf-count");
    assertStringIncludes(html, "custom-previous");
    assertStringIncludes(html, "vf-previous");
  });

  it("exposes every compound leaf", () => {
    for (const part of ["Root", "Previous", "Count", "Next"]) {
      assertEquals(
        typeof (BranchPicker as unknown as Record<string, unknown>)[part],
        "function",
      );
    }
  });
});
