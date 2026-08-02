/**
 * Accordion behaviour: proves the disclosure-slot re-plumb works end-to-end:
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

describe("Accordion: disclosure-slot behaviour (builtin)", () => {
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
      const bodyA = host.querySelector<HTMLElement>('[data-body="a"]')!;
      const bodyB = host.querySelector<HTMLElement>('[data-body="b"]')!;
      assert(bodyA.closest<HTMLElement>("[data-state]")?.hidden, "A starts hidden");
      assert(bodyB.closest<HTMLElement>("[data-state]")?.hidden, "B starts hidden");

      click(triggerA!);
      assert(!bodyA.closest<HTMLElement>("[data-state]")?.hidden, "A opens on click");
      assert(triggerA!.getAttribute("aria-expanded") === "true", "A trigger expanded");

      click(triggerB!);
      assert(!bodyB.closest<HTMLElement>("[data-state]")?.hidden, "B opens");
      assert(bodyA.closest<HTMLElement>("[data-state]")?.hidden, "single mode closed A");

      click(triggerB!);
      assert(bodyB.closest<HTMLElement>("[data-state]")?.hidden, "collapsible closes B");
    } finally {
      unmount();
    }
  });

  it("wraps triggers in headings and wires custom ids bidirectionally", () => {
    const { host, unmount } = render(
      <Accordion>
        <AccordionItem value="a">
          <AccordionTrigger id="shipping-trigger" headingLevel={2}>Shipping</AccordionTrigger>
          <AccordionContent id="shipping-content">Body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    try {
      const heading = host.querySelector("h2")!;
      const trigger = heading.querySelector("button")!;
      const content = host.querySelector<HTMLElement>("[role=region]")!;
      assert(trigger.id === "shipping-trigger", "realized trigger id is preserved");
      assert(content.id === "shipping-content", "realized content id is preserved");
      assert(trigger.getAttribute("aria-controls") === content.id, "trigger controls region");
      assert(content.getAttribute("aria-labelledby") === trigger.id, "region names trigger");
    } finally {
      unmount();
    }
  });

  it("normalizes retained uncontrolled values when mode changes", () => {
    function Probe(): React.ReactElement {
      const [multiple, setMultiple] = React.useState(true);
      const items = (
        <>
          <AccordionItem value="a">
            <AccordionTrigger>A</AccordionTrigger>
            <AccordionContent>A body</AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>B</AccordionTrigger>
            <AccordionContent>B body</AccordionContent>
          </AccordionItem>
        </>
      );
      return (
        <>
          <button type="button" data-switch onClick={() => setMultiple(false)}>Switch</button>
          {multiple
            ? <Accordion type="multiple" defaultValue={["a", "b"]}>{items}</Accordion>
            : <Accordion type="single">{items}</Accordion>}
        </>
      );
    }
    const { host, unmount } = render(<Probe />);
    try {
      click(host.querySelector("[data-switch]")!);
      const triggers = Array.from(host.querySelectorAll("h3 button"));
      assert(triggers[0]?.getAttribute("aria-expanded") === "true", "first value remains open");
      assert(triggers[1]?.getAttribute("aria-expanded") === "false", "extra value closes");
    } finally {
      unmount();
    }
  });
});
