/**
 * Accordion behaviour — proves the disclosure-slot re-plumb works end-to-end:
 * the Accordion still owns single/multiple/collapsible coordination while each
 * item's collapse runs through `useAdapter().disclosure`.
 *
 * @module react/components/ui/accordion.behaviour.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion.tsx";

function installDom(dom: JSDOM): () => void {
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const keys = ["document", "window", "navigator", "HTMLElement", "Node", "Element", "MouseEvent"];
  const prev: Record<string, unknown> = {};
  for (const k of keys) prev[k] = g[k];
  for (const k of keys) g[k] = w[k];
  g.document = w.document;
  g.window = w;
  return () => {
    for (const k of keys) g[k] = prev[k];
    dom.window.close();
  };
}

function render(el: React.ReactElement) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(el));
  return {
    host: host as unknown as HTMLElement,
    unmount: () => {
      try {
        root.unmount();
      } finally {
        restore();
      }
    },
  };
}

function click(node: Element): void {
  const MouseEventCtor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  flushSync(() =>
    node.dispatchEvent(new MouseEventCtor("click", { bubbles: true, cancelable: true }))
  );
}

describe("Accordion — disclosure-slot behaviour (builtin)", () => {
  it("single mode: opening one section closes the other", () => {
    const { host, unmount } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="a">
          <AccordionTrigger>A</AccordionTrigger>
          <AccordionContent>
            <span data-body="a">Body A</span>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>B</AccordionTrigger>
          <AccordionContent>
            <span data-body="b">Body B</span>
          </AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    try {
      const [triggerA, triggerB] = Array.from(host.querySelectorAll("button"));
      assert(triggerA && triggerB, "two triggers render");
      assert(!host.querySelector("[data-body]"), "all sections closed initially");

      click(triggerA!);
      assert(host.querySelector('[data-body="a"]'), "A opens on click");
      assert(triggerA!.getAttribute("aria-expanded") === "true", "A trigger expanded");

      click(triggerB!);
      assert(host.querySelector('[data-body="b"]'), "B opens");
      assert(!host.querySelector('[data-body="a"]'), "single mode closed A");

      click(triggerB!);
      assert(!host.querySelector("[data-body]"), "collapsible closes B back to none");
    } finally {
      unmount();
    }
  });
});
