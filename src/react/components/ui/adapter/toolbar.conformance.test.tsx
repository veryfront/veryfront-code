/**
 * Toolbar adapter conformance — the `toolbar` slot. One shared behaviour suite
 * runs against the builtin engine and an independent, contract-only engine,
 * proving the slot is a real seam a third-party engine satisfies with the skin
 * (`toolbar.tsx`) unchanged. Roving-tabindex is DOM focus management, so the
 * assertion is the resting roving state (first item tabbable, rest not) + click.
 *
 * @module react/components/ui/adapter/toolbar.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "../toolbar.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { Slot } from "../slot.tsx";
import type { ToolbarParts } from "./contract.ts";

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
    "KeyboardEvent",
    "MouseEvent",
  ];
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

function render(element: React.ReactElement): { host: HTMLElement; unmount: () => void } {
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

function click(node: Element): void {
  const MouseEventCtor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  flushSync(() =>
    node.dispatchEvent(new MouseEventCtor("click", { bubbles: true, cancelable: true }))
  );
}

function keydown(node: Element, key: string): void {
  const KeyboardEventCtor = (globalThis as unknown as { KeyboardEvent: typeof KeyboardEvent })
    .KeyboardEvent;
  flushSync(() =>
    node.dispatchEvent(new KeyboardEventCtor("keydown", { bubbles: true, cancelable: true, key }))
  );
}

function runToolbarConformance(label: string, Wrap: React.FC<{ children: React.ReactNode }>): void {
  describe(`Toolbar adapter conformance — ${label}`, () => {
    it("renders role=toolbar with one roving tab stop; items click", () => {
      let clicked = false;
      const { host, unmount } = render(
        <Wrap>
          <Toolbar aria-label="Format">
            <ToolbarButton onClick={() => (clicked = true)}>B</ToolbarButton>
            <ToolbarButton>I</ToolbarButton>
            <ToolbarSeparator />
            <ToolbarButton>U</ToolbarButton>
          </Toolbar>
        </Wrap>,
      );
      try {
        const bar = host.querySelector('[role="toolbar"]');
        assert(bar, "renders role=toolbar");
        const items = Array.from(host.querySelectorAll<HTMLElement>("[data-toolbar-item]"));
        assert(items.length === 3, "three roving items (separator excluded)");
        assert(items[0]!.tabIndex === 0, "first item is the tab stop");
        assert(items[1]!.tabIndex === -1 && items[2]!.tabIndex === -1, "rest are not tabbable");
        click(items[0]!);
        assert(clicked, "item click fires");
      } finally {
        unmount();
      }
    });
  });
}

// (1) builtin.
const Identity: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
runToolbarConformance("builtin (default)", Identity);

describe("Builtin Toolbar keyboard lifecycle", () => {
  it("moves focus with arrows and preserves the roving stop across rerenders", () => {
    function Probe(): React.ReactElement {
      const [renders, setRenders] = React.useState(0);
      return (
        <Toolbar data-renders={renders}>
          <ToolbarButton>A</ToolbarButton>
          <ToolbarButton onClick={() => setRenders((value) => value + 1)}>B</ToolbarButton>
        </Toolbar>
      );
    }

    const { host, unmount } = render(<Probe />);
    try {
      const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
      const [first, second] = Array.from(host.querySelectorAll<HTMLElement>("[data-toolbar-item]"));
      first!.focus();
      keydown(bar, "ArrowRight");
      assert(second === document.activeElement, "ArrowRight focuses the next item");
      assert(second!.tabIndex === 0 && first!.tabIndex === -1, "next item becomes the tab stop");
      click(second!);
      assert(bar.dataset.renders === "1", "parent rerender occurred");
      assert(second!.tabIndex === 0, "rerender preserves the current roving stop");
    } finally {
      unmount();
    }
  });

  it("uses visual arrow direction for horizontal RTL toolbars", () => {
    const { host, unmount } = render(
      <Toolbar style={{ direction: "rtl" }}>
        <ToolbarButton>A</ToolbarButton>
        <ToolbarButton>B</ToolbarButton>
      </Toolbar>,
    );
    try {
      const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
      const [first, second] = Array.from(host.querySelectorAll<HTMLElement>("[data-toolbar-item]"));
      first!.focus();
      keydown(bar, "ArrowLeft");
      assert(second === document.activeElement, "ArrowLeft moves forward in RTL");
    } finally {
      unmount();
    }
  });
});

// (2) an INDEPENDENT contract-only engine — its own roving over [data-toolbar-item],
// same skin + call-site.
const altToolbar: ToolbarParts = {
  Root: ({ orientation = "horizontal", children, ref, ...props }) => {
    const innerRef = React.useRef<HTMLDivElement | null>(null);
    const setRef = (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = node;
    };
    React.useLayoutEffect(() => {
      const root = innerRef.current;
      if (!root) return;
      Array.from(root.querySelectorAll<HTMLElement>("[data-toolbar-item]")).forEach((el, i) => {
        el.tabIndex = i === 0 ? 0 : -1;
      });
    });
    return (
      <div ref={setRef} role="toolbar" data-orientation={orientation} data-alt-toolbar {...props}>
        {children}
      </div>
    );
  },
  Item: ({ asChild, ref, ...props }) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        ref={ref}
        data-toolbar-item=""
        {...props}
      />
    );
  },
};

const AltWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UIAdapterProvider adapter={{ name: "independent-alt", toolbar: altToolbar }}>
    {children}
  </UIAdapterProvider>
);
runToolbarConformance("independent adapter (contract-is-a-real-seam proof)", AltWrap);
