import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { type ComponentDomOptions, installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { InlineCitation } from "./inline-citation.tsx";

const DOM_OPTIONS: ComponentDomOptions = {
  windowGlobals: ["self", "innerWidth", "innerHeight"],
};

describe("InlineCitation", () => {
  it("exposes the trigger and hover card as compound parts", async () => {
    assert(typeof InlineCitation.Trigger === "function");
    assert(typeof InlineCitation.Card === "function");

    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);

      flushSync(() => {
        root.render(
          <InlineCitation
            index={0}
            source={{ title: "Veryfront runs", url: "/runs" }}
          >
            <InlineCitation.Trigger className="vf-citation-trigger" />
            <InlineCitation.Card className="vf-citation-card">
              Custom citation card
            </InlineCitation.Card>
          </InlineCitation>,
        );
      });

      const trigger = document.querySelector("button");
      assert(trigger, "Expected citation trigger to render");
      assert(trigger.className.includes("vf-citation-trigger"));

      trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await waitFor(
        () => document.querySelector(".vf-citation-card") !== null,
        { interval: 10, message: "Citation card did not render after hover" },
      );

      const card = document.querySelector(".vf-citation-card");
      assert(card, "Expected citation card to render after hover");
      assertEquals(card.textContent, "Custom citation card");

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("reports the citation index on click unless the trigger prevented it", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);
      const received: number[] = [];

      flushSync(() => {
        root.render(
          <InlineCitation
            index={2}
            source={{ title: "Veryfront runs", url: "/runs" }}
            onClick={(i) => received.push(i)}
          >
            <InlineCitation.Trigger />
            <InlineCitation.Card>x</InlineCitation.Card>
          </InlineCitation>,
        );
      });

      let trigger = document.querySelector("button");
      assert(trigger, "Expected citation trigger to render");
      flushSync(() => trigger!.click());
      assertEquals(
        received,
        [2],
        "clicking the trigger reports the citation index to the root onClick",
      );

      flushSync(() => {
        root.render(
          <InlineCitation
            index={2}
            source={{ title: "Veryfront runs", url: "/runs" }}
            onClick={(i) => received.push(i)}
          >
            <InlineCitation.Trigger onClick={(e) => e.preventDefault()} />
            <InlineCitation.Card>x</InlineCitation.Card>
          </InlineCitation>,
        );
      });

      trigger = document.querySelector("button");
      assert(trigger, "Expected citation trigger to re-render");
      flushSync(() => trigger!.click());
      assertEquals(received, [2], "a defaultPrevented trigger click suppresses onCitationClick");

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("hides the card again when the pointer leaves the trigger", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);

      flushSync(() => {
        root.render(
          <InlineCitation index={0} source={{ title: "Veryfront runs", url: "/runs" }}>
            <InlineCitation.Trigger />
            <InlineCitation.Card className="vf-citation-card">card</InlineCitation.Card>
          </InlineCitation>,
        );
      });

      const trigger = document.querySelector("button");
      assert(trigger, "Expected citation trigger to render");
      trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await waitFor(
        () => document.querySelector(".vf-citation-card") !== null,
        { interval: 10, message: "Citation card did not render after hover" },
      );

      trigger.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      await waitFor(
        () => document.querySelector(".vf-citation-card") === null,
        { interval: 10, message: "Citation card did not hide after the pointer left" },
      );

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });
});
