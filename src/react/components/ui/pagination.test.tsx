/**
 * Pagination behaviour. Pins the observable contract of the paging compound: the
 * root is a `role="navigation"` landmark labelled `pagination`, the active page
 * link carries `aria-current="page"`, and `ref` forwards to the `<nav>` node.
 *
 * @module react/components/ui/pagination.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./pagination.tsx";

// ---------------------------------------------------------------------------
// jsdom harness (copied from conformance.test.tsx) - fresh DOM per render with
// the browser-API stubs (ResizeObserver/matchMedia/rAF) effect-driven mounts need.
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

function Fixture(props: { ref?: React.Ref<HTMLElement> }): React.ReactElement {
  return (
    <Pagination ref={props.ref}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive>2</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">3</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

describe("Pagination behaviour", () => {
  it("renders a role=navigation landmark labelled 'pagination' wrapping the page list", () => {
    const { host, unmount } = render(<Fixture />);
    try {
      const nav = host.querySelector('nav[role="navigation"]') as HTMLElement;
      assert(nav, "root renders nav[role=navigation]");
      assertEquals(nav.getAttribute("aria-label"), "pagination");
      assert(nav.querySelector("ul"), "wraps a PaginationContent <ul>");
      assertEquals(nav.querySelectorAll("li").length, 6, "renders six page items");
    } finally {
      unmount();
    }
  });

  it("marks the active page link with aria-current='page' (and no other link)", () => {
    const { host, unmount } = render(<Fixture />);
    try {
      const current = host.querySelectorAll('a[aria-current="page"]');
      assertEquals(current.length, 1, "exactly one active link");
      assertEquals(current[0]!.textContent, "2", "page 2 is the active link");
    } finally {
      unmount();
    }
  });

  it("forwards ref to the Pagination <nav> node", () => {
    const ref = React.createRef<HTMLElement>();
    const { host, unmount } = render(<Fixture ref={ref} />);
    try {
      assert(ref.current, "ref is assigned");
      assertEquals(ref.current, host.querySelector("nav"), "ref points at the nav node");
      assertEquals(ref.current?.getAttribute("aria-label"), "pagination");
    } finally {
      unmount();
    }
  });
});
