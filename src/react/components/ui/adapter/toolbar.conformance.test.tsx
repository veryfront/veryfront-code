/**
 * Toolbar adapter conformance: the `toolbar` slot. One shared behaviour suite
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
import { UIAdapterProvider, useAdapter } from "./context.tsx";
import { composeRefs, Slot } from "../slot.tsx";
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
  describe(`Toolbar adapter conformance: ${label}`, () => {
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

    it("moves focus with arrows and preserves the focused stop across rerenders", () => {
      function Probe(): React.ReactElement {
        const [renders, setRenders] = React.useState(0);
        return (
          <Wrap>
            <Toolbar data-renders={renders}>
              <ToolbarButton>A</ToolbarButton>
              <ToolbarButton onClick={() => setRenders((value) => value + 1)}>B</ToolbarButton>
            </Toolbar>
          </Wrap>
        );
      }
      const { host, unmount } = render(<Probe />);
      try {
        const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
        const [first, second] = Array.from(
          host.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
        );
        first!.focus();
        keydown(bar, "ArrowRight");
        assert(second === document.activeElement, "ArrowRight focuses next item");
        click(second!);
        assert(bar.dataset.renders === "1", "parent rerender occurred");
        assert(second!.tabIndex === 0 && first!.tabIndex === -1, "focused stop survives rerender");
      } finally {
        unmount();
      }
    });

    it("skips disabled items and honors a consumer-cancelled navigation event", () => {
      let cancel = true;
      const { host, unmount } = render(
        <Wrap>
          <Toolbar onKeyDown={(event) => cancel && event.preventDefault()}>
            <ToolbarButton>A</ToolbarButton>
            <ToolbarButton disabled>Disabled</ToolbarButton>
            <ToolbarButton>B</ToolbarButton>
          </Toolbar>
        </Wrap>,
      );
      try {
        const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
        const [first, disabled, last] = Array.from(
          host.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
        );
        first!.focus();
        keydown(bar, "ArrowRight");
        assert(document.activeElement === first, "cancelled event leaves focus unchanged");
        cancel = false;
        keydown(bar, "ArrowRight");
        assert(document.activeElement === last, "navigation skips disabled item");
        assert(disabled!.tabIndex === -1, "disabled item is never the resting stop");
      } finally {
        unmount();
      }
    });

    it("updates the resting stop on focus and isolates nested, hidden, inert, and editable content", () => {
      const { host, unmount } = render(
        <Wrap>
          <Toolbar>
            <ToolbarButton>A</ToolbarButton>
            <ToolbarButton>B</ToolbarButton>
            <div hidden>
              <ToolbarButton>Hidden</ToolbarButton>
            </div>
            <div inert>
              <ToolbarButton>Inert</ToolbarButton>
            </div>
            <EditableToolbarItem />
            <Toolbar>
              <ToolbarButton>Nested A</ToolbarButton>
              <ToolbarButton>Nested B</ToolbarButton>
            </Toolbar>
          </Toolbar>
        </Wrap>,
      );
      try {
        const bars = host.querySelectorAll<HTMLElement>('[role="toolbar"]');
        const outer = bars[0]!;
        const direct = Array.from(outer.querySelectorAll<HTMLElement>("[data-toolbar-item]"))
          .filter(
            (item) => item.closest('[role="toolbar"]') === outer,
          );
        direct[1]!.focus();
        assert(direct[1]!.tabIndex === 0 && direct[0]!.tabIndex === -1, "focus updates stop");
        const editable = outer.querySelector<HTMLElement>("[contenteditable]")!;
        editable.focus();
        keydown(editable, "ArrowRight");
        assert(document.activeElement === editable, "editable target keeps arrow handling");
        const nestedItems = bars[1]!.querySelectorAll<HTMLElement>("[data-toolbar-item]");
        nestedItems[0]!.focus();
        keydown(nestedItems[0]!, "ArrowRight");
        assert(document.activeElement === nestedItems[1], "nested toolbar owns its event");
        assert(direct[2]!.tabIndex !== 0 && direct[3]!.tabIndex !== 0, "hidden and inert excluded");
      } finally {
        unmount();
      }
    });

    it("uses visual arrow direction in RTL and runs React 19 callback-ref cleanup", () => {
      let firstCleanups = 0;
      let secondCleanups = 0;
      function Probe(): React.ReactElement {
        const [secondRef, setSecondRef] = React.useState(false);
        const first = React.useCallback(() => () => {
          firstCleanups += 1;
        }, []);
        const second = React.useCallback(() => () => {
          secondCleanups += 1;
        }, []);
        return (
          <Wrap>
            <Toolbar style={{ direction: "rtl" }} ref={secondRef ? second : first}>
              <ToolbarButton>A</ToolbarButton>
              <ToolbarButton onClick={() => setSecondRef(true)}>B</ToolbarButton>
            </Toolbar>
          </Wrap>
        );
      }
      const { host, unmount } = render(<Probe />);
      const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
      const [first, second] = Array.from(host.querySelectorAll<HTMLElement>("[data-toolbar-item]"));
      first!.focus();
      keydown(bar, "ArrowLeft");
      assert(second === document.activeElement, "ArrowLeft moves forward in RTL");
      click(second!);
      assert(firstCleanups === 1, "old callback ref cleanup runs when the ref changes");
      unmount();
      assert(secondCleanups === 1, "current callback ref cleanup runs on unmount");
    });
  });
}

function EditableToolbarItem(): React.ReactElement {
  const { toolbar } = useAdapter();
  return (
    <toolbar.Item asChild>
      <div contentEditable suppressContentEditableWarning>edit</div>
    </toolbar.Item>
  );
}

// (1) builtin.
const Identity: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
runToolbarConformance("builtin (default)", Identity);

// (2) an INDEPENDENT contract-only engine: its own roving over [data-toolbar-item],
// same skin + call-site.
function altItems(root: HTMLElement): HTMLElement[] {
  return altScopedItems(root).filter((item) =>
    item.closest("[data-alt-toolbar]") === root &&
    !item.hasAttribute("disabled") &&
    item.getAttribute("aria-disabled") !== "true" &&
    !item.closest('[hidden], [inert], [aria-hidden="true"]') &&
    !item.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")
  );
}

function altScopedItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-toolbar-item]")).filter(
    (item) => item.closest("[data-alt-toolbar]") === root,
  );
}

const altToolbar: ToolbarParts = {
  Root: ({
    orientation = "horizontal",
    children,
    ref,
    onKeyDown,
    onFocusCapture,
    ...props
  }) => {
    const innerRef = React.useRef<HTMLDivElement | null>(null);
    const composedRef = React.useMemo(() => composeRefs(innerRef, ref), [ref]);
    React.useLayoutEffect(() => {
      const root = innerRef.current;
      if (!root) return;
      const items = altItems(root);
      const active = items.find((item) =>
        item === root.ownerDocument.activeElement || item.tabIndex === 0
      ) ?? items[0];
      altScopedItems(root).forEach((item) => item.tabIndex = item === active ? 0 : -1);
    });
    const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      const root = innerRef.current;
      const target = event.target as HTMLElement;
      if (
        !root || target.closest("[data-alt-toolbar]") !== root ||
        target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")
      ) return;
      const items = altItems(root);
      const current = items.indexOf(root.ownerDocument.activeElement as HTMLElement);
      const rtl = root.ownerDocument.defaultView?.getComputedStyle(root).direction === "rtl";
      const forward = orientation === "vertical" ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
      const backward = orientation === "vertical" ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
      let index = current;
      if (event.key === forward) index = current < 0 ? 0 : (current + 1) % items.length;
      else if (event.key === backward) {
        index = current < 0 ? 0 : (current - 1 + items.length) % items.length;
      } else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = items.length - 1;
      else return;
      event.preventDefault();
      items.forEach((item, itemIndex) => item.tabIndex = itemIndex === index ? 0 : -1);
      items[index]?.focus();
    };
    return (
      <div
        ref={composedRef}
        role="toolbar"
        data-orientation={orientation}
        data-alt-toolbar=""
        onKeyDown={move}
        onFocusCapture={(event) => {
          onFocusCapture?.(event);
          const root = innerRef.current;
          const target = event.target as HTMLElement;
          if (!root || target.closest("[data-alt-toolbar]") !== root) return;
          const items = altItems(root);
          if (items.includes(target)) {
            items.forEach((item) => item.tabIndex = item === target ? 0 : -1);
          }
        }}
        {...props}
      >
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
