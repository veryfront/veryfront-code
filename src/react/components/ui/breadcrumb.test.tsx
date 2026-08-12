/**
 * Breadcrumb behaviour. Pins the observable contract: the root is a
 * `<nav aria-label="Breadcrumb">` landmark, the trail is an `<ol>`, the current
 * page carries `aria-current="page"`, separators are `aria-hidden` presentation
 * nodes, and `ref` forwards to the root `<nav>`.
 *
 * @module react/components/ui/breadcrumb.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb.tsx";

// ---------------------------------------------------------------------------
// jsdom harness — installs a fresh DOM per render and stubs the browser APIs
// jsdom lacks (ResizeObserver, rAF, matchMedia) so effect-driven components mount.
// ---------------------------------------------------------------------------
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function installDom(dom: JSDOM): () => void {
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const keys = [
    "document",
    "window",
    "navigator",
    "HTMLElement",
    "Node",
    "Element",
    "MouseEvent",
    "getComputedStyle",
    "ResizeObserver",
    "matchMedia",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];
  const prev: Record<string, unknown> = {};
  for (const k of keys) prev[k] = g[k];

  g.document = w.document;
  g.window = w;
  g.navigator = w.navigator;
  g.HTMLElement = w.HTMLElement;
  g.Node = w.Node;
  g.Element = w.Element;
  g.MouseEvent = w.MouseEvent;
  g.getComputedStyle = (w.getComputedStyle as (e: Element) => CSSStyleDeclaration).bind(w);
  g.ResizeObserver = ResizeObserverStub;
  g.matchMedia = () => ({
    matches: false,
    media: "",
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  });
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0);
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);

  return () => {
    for (const k of keys) g[k] = prev[k];
    dom.window.close();
  };
}

/** Render `element` into a fresh DOM; returns the host node and a teardown. */
function render(element: React.ReactElement): {
  host: HTMLElement;
  unmount: () => void;
} {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
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

function Trail(): React.ReactElement {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Billing</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

describe("Breadcrumb behaviour", () => {
  it("renders a nav[aria-label='Breadcrumb'] landmark wrapping an ordered list", () => {
    const { host, unmount } = render(<Trail />);
    try {
      const nav = host.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
      assert(nav, "root is a nav labelled 'Breadcrumb'");
      const list = nav.querySelector("ol");
      assert(list, "the trail is rendered as an <ol>");
      assert(list!.querySelectorAll("li").length >= 3, "trail items render as <li>s");
    } finally {
      unmount();
    }
  });

  it("marks the current page with aria-current='page' and hides separators", () => {
    const { host, unmount } = render(<Trail />);
    try {
      const page = host.querySelector('[aria-current="page"]') as HTMLElement;
      assert(page, "the current page carries aria-current='page'");
      assertEquals(page.getAttribute("role"), "link", "current page is a role=link");
      assertEquals(page.textContent, "Billing");

      const separators = host.querySelectorAll('[data-slot="breadcrumb-separator"]');
      assertEquals(separators.length, 3, "three separators render");
      for (const sep of separators) {
        assertEquals(sep.getAttribute("aria-hidden"), "true", "separators are aria-hidden");
      }
    } finally {
      unmount();
    }
  });

  it("forwards ref to the root <nav>", () => {
    const ref = React.createRef<HTMLElement>();
    const { unmount } = render(
      <Breadcrumb ref={ref}>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Home</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    try {
      assert(ref.current, "ref was populated");
      assertEquals(ref.current!.tagName.toLowerCase(), "nav", "ref points at the <nav>");
      assertEquals(ref.current!.getAttribute("aria-label"), "Breadcrumb");
    } finally {
      unmount();
    }
  });
});
