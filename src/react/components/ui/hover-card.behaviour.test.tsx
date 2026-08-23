/**
 * HoverCard behaviour test.
 *
 * Mirrors the Popover adapter conformance harness (JSDOM + createRoot +
 * flushSync + installDomGlobals + mountInScope), but drives the hover-open path:
 * synthetic focus/keyboard events do not reach React handlers in this
 * deno+jsdom+React harness, so the card is opened by dispatching a bubbling
 * `mouseover` MouseEvent on the trigger (which React maps to `onMouseEnter`) and
 * closed with `mouseout` (`onMouseLeave`). Delays are set to 0 so no timer is
 * armed. Unlike a click (a discrete event that `flushSync` flushes eagerly),
 * hover is a *continuous*-priority event: React schedules its state update on a
 * non-sync lane that only drains on the next scheduler task, so each hover step
 * `await`s a macrotask (`tick`) before asserting.
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card.tsx";

/** Let React's scheduler drain a continuous-priority (hover) update. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

async function waitForElement(
  container: ParentNode,
  selector: string,
  message: string,
): Promise<HTMLElement> {
  const deadline = Date.now() + 250;
  let element = container.querySelector<HTMLElement>(selector);
  while (!element && Date.now() < deadline) {
    await tick();
    element = container.querySelector<HTMLElement>(selector);
  }
  assert(element, message);
  return element;
}

async function waitForNoElement(
  container: ParentNode,
  selector: string,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 250;
  while (container.querySelector(selector) && Date.now() < deadline) {
    await tick();
  }
  assertEquals(container.querySelector(selector), null, message);
}

function installDomGlobals(dom: JSDOM): () => void {
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "MouseEvent",
    "KeyboardEvent",
    "getComputedStyle",
  ] as const;
  const previous: Record<string, unknown> = {};
  for (const k of keys) previous[k] = (globalThis as Record<string, unknown>)[k];

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
  });

  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

/** Mount `element` inside a `[data-vf-ui]` token scope; return the scope + hover helpers. */
function mountInScope(element: React.ReactElement): {
  scope: HTMLElement;
  root: Root;
  hoverIn: () => Promise<void>;
  hoverOut: () => Promise<void>;
  cleanup: () => void;
} {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"></div></body></html>`,
    { url: "https://example.com/", pretendToBeVisual: true },
  );
  const restore = installDomGlobals(dom);
  const host = document.getElementById("root")!;
  const scope = document.createElement("div");
  scope.setAttribute("data-vf-ui", "");
  host.appendChild(scope);
  const root = createRoot(scope);
  flushSync(() => root.render(element));

  const trigger = () => {
    const el = scope.querySelector<HTMLElement>("button, [aria-haspopup], a");
    if (!el) throw new Error("no trigger found");
    return el;
  };
  // React derives `onMouseEnter`/`onMouseLeave` from bubbling mouseover/mouseout;
  // a null relatedTarget reads as entering/leaving from outside the element. The
  // update lands on a continuous lane, so `await tick()` lets it flush.
  const hoverIn = async () => {
    trigger().dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }));
    await tick();
  };
  const hoverOut = async () => {
    trigger().dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true }));
    await tick();
  };

  return {
    scope,
    root,
    hoverIn,
    hoverOut,
    cleanup: () => {
      root.unmount();
      restore();
    },
  };
}

describe("HoverCard behaviour", () => {
  it("opens on pointer enter and portals the content into the token scope", async () => {
    const { scope, hoverIn, cleanup } = mountInScope(
      <HoverCard openDelay={0} closeDelay={0}>
        <HoverCardTrigger>@koji</HoverCardTrigger>
        <HoverCardContent data-testid="hc">Preview</HoverCardContent>
      </HoverCard>,
    );
    try {
      assertEquals(scope.querySelector('[data-testid="hc"]'), null, "closed initially");
      await hoverIn();
      const content = await waitForElement(
        scope,
        '[data-testid="hc"]',
        "content renders once the trigger is hovered",
      );
      // MANDATORY: the portalled surface stays inside the [data-vf-ui] token
      // scope, never escaping to <body>.
      assertEquals(
        content.closest("[data-vf-ui],[data-vf-chat]"),
        scope,
        "portalled content must stay within the token scope, not document.body",
      );
      assert(content.textContent?.includes("Preview"), "content renders children");
      assertEquals(content.getAttribute("data-state"), "open", "data-state flips to open");
    } finally {
      cleanup();
    }
  });

  it("closes on pointer leave", async () => {
    const { scope, hoverIn, hoverOut, cleanup } = mountInScope(
      <HoverCard openDelay={0} closeDelay={0}>
        <HoverCardTrigger>@koji</HoverCardTrigger>
        <HoverCardContent data-testid="hc">Preview</HoverCardContent>
      </HoverCard>,
    );
    try {
      await hoverIn();
      await waitForElement(scope, '[data-testid="hc"]', "open after hover in");
      await hoverOut();
      await waitForNoElement(
        scope,
        '[data-testid="hc"]',
        "content unmounts after the pointer leaves",
      );
    } finally {
      cleanup();
    }
  });

  it("honours controlled open (open prop drives visibility)", () => {
    function Controlled({ open }: { open: boolean }): React.ReactElement {
      return (
        <HoverCard open={open} onOpenChange={() => {}}>
          <HoverCardTrigger>@koji</HoverCardTrigger>
          <HoverCardContent data-testid="hc">Preview</HoverCardContent>
        </HoverCard>
      );
    }
    const { scope, root, cleanup } = mountInScope(<Controlled open={false} />);
    try {
      assertEquals(scope.querySelector('[data-testid="hc"]'), null, "closed when open=false");
      flushSync(() => root.render(<Controlled open />));
      assert(scope.querySelector('[data-testid="hc"]'), "opens when open=true");
    } finally {
      cleanup();
    }
  });

  it("merges consumer className onto the surface, preserving base classes", async () => {
    const { scope, hoverIn, cleanup } = mountInScope(
      <HoverCard openDelay={0} closeDelay={0}>
        <HoverCardTrigger>@koji</HoverCardTrigger>
        <HoverCardContent data-testid="hc" className="vf-test-consumer">Preview</HoverCardContent>
      </HoverCard>,
    );
    try {
      await hoverIn();
      const content = await waitForElement(scope, '[data-testid="hc"]', "content renders");
      assert(
        content.className.includes("bg-[var(--popover)]"),
        "base surface class is preserved",
      );
      assert(
        content.className.includes("vf-test-consumer"),
        "consumer className is merged in",
      );
    } finally {
      cleanup();
    }
  });

  it("asChild merges trigger behaviour onto the consumer element (no extra button)", async () => {
    const { scope, hoverIn, cleanup } = mountInScope(
      <HoverCard openDelay={0} closeDelay={0}>
        <HoverCardTrigger asChild>
          <a href="#koji" data-testid="link">@koji</a>
        </HoverCardTrigger>
        <HoverCardContent data-testid="hc">Preview</HoverCardContent>
      </HoverCard>,
    );
    try {
      const link = scope.querySelector('[data-testid="link"]') as HTMLElement;
      assert(link, "asChild renders the consumer element");
      assertEquals(link.tagName.toLowerCase(), "a", "no wrapper button is injected");
      assertEquals(scope.querySelector("button"), null, "the anchor is the trigger");
      await hoverIn();
      await waitForElement(scope, '[data-testid="hc"]', "hovering the link opens the card");
    } finally {
      cleanup();
    }
  });
});
