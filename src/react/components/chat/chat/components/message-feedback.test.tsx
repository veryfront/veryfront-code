import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { MessageFeedback } from "./message-feedback.tsx";

function installDom(): { restore: () => void; window: JSDOM["window"] } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const window = dom.window;
  return { window, restore: installComponentDom(dom, { windowGlobals: ["Event"] }) };
}

describe("MessageFeedback", () => {
  it("renders both default feedback controls", () => {
    const html = renderToString(
      <MessageFeedback messageId="message-1" onFeedback={() => {}} />,
    );

    assertStringIncludes(html, "Helpful");
    assertStringIncludes(html, "Not helpful");
  });

  it("reports the messageId and polarity when a control is clicked", async () => {
    const dom = installDom();
    let root: Root | undefined;
    const calls: [string, string][] = [];

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <MessageFeedback messageId="m1" onFeedback={(id, value) => calls.push([id, value])} />,
        );
      });

      const helpful = rootElement.querySelector<HTMLButtonElement>('button[aria-label="Helpful"]');
      const notHelpful = rootElement.querySelector<HTMLButtonElement>(
        'button[aria-label="Not helpful"]',
      );
      assert(helpful, "Helpful control renders");
      assert(notHelpful, "Not helpful control renders");
      flushSync(() => helpful.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
      flushSync(() =>
        notHelpful.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
      );

      assertEquals(
        calls,
        [["m1", "positive"], ["m1", "negative"]],
        "feedback controls report messageId then polarity",
      );
    } finally {
      if (root) await unmountReactRoot(root);
      dom.restore();
    }
  });

  it("composes per-action icons and classes", () => {
    const html = renderToString(
      <MessageFeedback
        messageId="message-1"
        feedback="positive"
        onFeedback={() => {}}
      >
        <MessageFeedback.Negative
          icon={<span data-testid="custom-negative">no</span>}
          className="vf-negative"
        />
        <MessageFeedback.Positive
          icon={<span data-testid="custom-positive">yes</span>}
          className="vf-positive"
        />
      </MessageFeedback>,
    );

    assertStringIncludes(html, "custom-negative");
    assertStringIncludes(html, "vf-negative");
    assertStringIncludes(html, "custom-positive");
    assertStringIncludes(html, "vf-positive");
    assertStringIncludes(
      html,
      "bg-emerald-500/10",
      "positive feedback renders the active Helpful styling",
    );
    assert(
      !html.includes("hover:text-emerald-500"),
      "active Helpful button must not use the inactive hover class",
    );

    const negative = renderToString(
      <MessageFeedback messageId="message-1" feedback="negative" onFeedback={() => {}} />,
    );
    assertStringIncludes(
      negative,
      "bg-red-500/10",
      "negative feedback renders the active Not helpful styling",
    );
    assert(
      !negative.includes("bg-emerald-500/10"),
      "negative feedback must not render the active Helpful styling",
    );
  });

  it("exposes both feedback leaves", () => {
    for (const part of ["Root", "Positive", "Negative"]) {
      assertEquals(
        typeof (MessageFeedback as unknown as Record<string, unknown>)[part],
        "function",
      );
    }
  });
});
