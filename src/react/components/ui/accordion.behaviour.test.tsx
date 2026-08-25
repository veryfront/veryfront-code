/**
 * Accordion behaviour: proves the disclosure-slot re-plumb works end-to-end:
 * the Accordion still owns single/multiple/collapsible coordination while each
 * item's collapse runs through `useAdapter().disclosure`.
 *
 * @module react/components/ui/accordion.behaviour.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
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
    unmount: async () => {
      try {
        await unmountReactRoot(root);
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
  it("emits complete default and custom ARIA wiring during SSR", () => {
    for (const custom of [false, true]) {
      const html = renderToString(
        <Accordion>
          <AccordionItem
            value="shipping"
            triggerId={custom ? "shipping-trigger" : undefined}
            contentId={custom ? "shipping-content" : undefined}
          >
            <AccordionTrigger>
              Shipping
            </AccordionTrigger>
            <AccordionContent>Body</AccordionContent>
          </AccordionItem>
        </Accordion>,
      );
      const document = new JSDOM(html).window.document;
      const trigger = document.querySelector("button")!;
      const content = document.querySelector<HTMLElement>("[role=region]")!;
      assert(trigger.id.length > 0 && content.id.length > 0, "SSR realizes both ids");
      assert(trigger.getAttribute("aria-controls") === content.id, "SSR trigger controls content");
      assert(content.getAttribute("aria-labelledby") === trigger.id, "SSR content names trigger");
      if (custom) {
        assert(trigger.id === "shipping-trigger", "SSR preserves custom trigger id");
        assert(content.id === "shipping-content", "SSR preserves custom content id");
      }
    }
  });

  it("single mode: opening one section closes the other", async () => {
    const values: string[] = [];
    const { host, unmount } = render(
      <Accordion type="single" collapsible onValueChange={(value) => values.push(value)}>
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
      assertEquals(
        values,
        ["a", "b", ""],
        "single mode emits the opened item value and an empty string on collapse",
      );
    } finally {
      await unmount();
    }
  });

  it("multiple mode opens several sections and closes them independently", async () => {
    const values: string[][] = [];
    const { host, unmount } = render(
      <Accordion type="multiple" onValueChange={(value) => values.push(value)}>
        <AccordionItem value="a">
          <AccordionTrigger>A</AccordionTrigger>
          <AccordionContent>A body</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>B</AccordionTrigger>
          <AccordionContent>B body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    try {
      const [triggerA, triggerB] = Array.from(host.querySelectorAll("button"));
      assert(triggerA && triggerB, "two triggers render");

      click(triggerA!);
      click(triggerB!);
      assertEquals(
        [triggerA!.getAttribute("aria-expanded"), triggerB!.getAttribute("aria-expanded")],
        ["true", "true"],
        "multiple mode keeps both sections open",
      );

      click(triggerA!);
      assertEquals(
        [triggerA!.getAttribute("aria-expanded"), triggerB!.getAttribute("aria-expanded")],
        ["false", "true"],
        "closing one section leaves the other open",
      );

      assertEquals(
        values,
        [["a"], ["a", "b"], ["b"]],
        "multiple mode reports the full value array on every toggle",
      );
    } finally {
      await unmount();
    }
  });

  it("wraps triggers in headings and wires custom ids bidirectionally", async () => {
    const { host, unmount } = render(
      <Accordion>
        <AccordionItem
          value="a"
          triggerId="shipping-trigger"
          contentId="shipping-content"
        >
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
      await unmount();
    }
  });

  it("keeps AccordionItem as the synchronous id owner through opaque composition", () => {
    function ExtractedTrigger(): React.ReactElement {
      return <AccordionTrigger id="opaque-trigger">Shipping</AccordionTrigger>;
    }
    function ExtractedContent(): React.ReactElement {
      return <AccordionContent id="opaque-content">Body</AccordionContent>;
    }

    const html = renderToString(
      <Accordion>
        <AccordionItem
          value="shipping"
          triggerId="opaque-trigger"
          contentId="opaque-content"
        >
          <ExtractedTrigger />
          <ExtractedContent />
        </AccordionItem>
      </Accordion>,
    );
    const document = new JSDOM(html).window.document;
    const trigger = document.querySelector("button")!;
    const content = document.querySelector<HTMLElement>("[role=region]")!;
    assert(trigger.id === "opaque-trigger", "opaque trigger receives the item-owned id");
    assert(content.id === "opaque-content", "opaque content receives the item-owned id");
    assert(trigger.getAttribute("aria-controls") === content.id, "opaque trigger controls content");
    assert(content.getAttribute("aria-labelledby") === trigger.id, "opaque content names trigger");
  });

  it("preserves a composed trigger child id during SSR when the item owns it", () => {
    const html = renderToString(
      <Accordion>
        <AccordionItem value="shipping" triggerId="shipping-link">
          <AccordionTrigger asChild>
            <a id="shipping-link" href="#shipping">Shipping</a>
          </AccordionTrigger>
          <AccordionContent>Body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    const document = new JSDOM(html).window.document;
    const trigger = document.querySelector<HTMLAnchorElement>("a")!;
    const content = document.querySelector<HTMLElement>("[role=region]")!;
    assert(trigger.id === "shipping-link", "SSR preserves the composed child id");
    assert(trigger.getAttribute("aria-controls") === content.id, "SSR trigger controls content");
    assert(content.getAttribute("aria-labelledby") === trigger.id, "SSR content names trigger");
  });

  it("keeps part-owned composed trigger references resolvable during SSR", () => {
    const html = renderToString(
      <Accordion>
        <AccordionItem value="shipping">
          <AccordionTrigger asChild>
            <a id="shipping-link" href="#shipping">Shipping</a>
          </AccordionTrigger>
          <AccordionContent>Body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    const document = new JSDOM(html).window.document;
    const trigger = document.querySelector<HTMLAnchorElement>("a")!;
    const content = document.querySelector<HTMLElement>("[role=region]")!;
    const labelId = content.getAttribute("aria-labelledby")!;
    const label = document.getElementById(labelId);
    assert(trigger.id === "shipping-link", "SSR preserves the composed child id");
    assert(label?.tagName === "H3", "the containing heading labels the pre-hydration region");
    assert(label?.contains(trigger), "the SSR label contains the composed trigger text");
  });

  it("does not notify controlled or uncontrolled consumers for a non-collapsible no-op", async () => {
    for (const controlled of [false, true]) {
      const values: string[] = [];
      const item = (
        <AccordionItem value="a">
          <AccordionTrigger>A</AccordionTrigger>
          <AccordionContent>A body</AccordionContent>
        </AccordionItem>
      );
      const { host, unmount } = render(
        controlled
          ? <Accordion value="a" onValueChange={(value) => values.push(value)}>{item}</Accordion>
          : (
            <Accordion defaultValue="a" onValueChange={(value) => values.push(value)}>
              {item}
            </Accordion>
          ),
      );
      try {
        click(host.querySelector("button")!);
        assert(
          values.length === 0,
          `${controlled ? "controlled" : "uncontrolled"} no-op is silent`,
        );
        assert(
          host.querySelector("button")?.getAttribute("aria-expanded") === "true",
          "the open item stays open",
        );
      } finally {
        await unmount();
      }
    }
  });

  it("hydrates generated id wiring without recoverable errors", async () => {
    let hydrated = false;
    const tree = (
      <Accordion
        defaultValue="shipping"
        ref={() => {
          hydrated = true;
        }}
      >
        <AccordionItem value="shipping">
          <AccordionTrigger>Shipping</AccordionTrigger>
          <AccordionContent>Body</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const html = renderToString(tree);
    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${html}</div></body></html>`,
      { pretendToBeVisual: true },
    );
    const restore = installDom(dom);
    const host = dom.window.document.getElementById("root")!;
    const recoverableErrors: unknown[] = [];
    const root = hydrateRoot(host, tree, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
    try {
      const startedAt = Date.now();
      while (!hydrated) {
        if (Date.now() - startedAt > 3000) throw new Error("timed out waiting for accordion");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const trigger = host.querySelector("button")!;
      const content = host.querySelector<HTMLElement>("[role=region]")!;
      assert(recoverableErrors.length === 0, "hydration reports no recoverable errors");
      assert(
        trigger.getAttribute("aria-controls") === content.id,
        "hydrated trigger controls content",
      );
      assert(
        content.getAttribute("aria-labelledby") === trigger.id,
        "hydrated content names trigger",
      );
    } finally {
      await unmountReactRoot(root);
      await new Promise((resolve) => setTimeout(resolve, 0));
      restore();
    }
  });

  it("normalizes retained uncontrolled values when mode changes", async () => {
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
      await unmount();
    }
  });
});
