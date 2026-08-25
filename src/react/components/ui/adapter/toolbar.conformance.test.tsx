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
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Toolbar, ToolbarButton, ToolbarLink, ToolbarSeparator } from "../toolbar.tsx";
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

function render(
  element: React.ReactElement,
): { host: HTMLElement; unmount: () => Promise<void> } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
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

function keydown(node: Element, key: string): KeyboardEvent {
  const KeyboardEventCtor = (globalThis as unknown as { KeyboardEvent: typeof KeyboardEvent })
    .KeyboardEvent;
  let event!: KeyboardEvent;
  flushSync(() =>
    node.dispatchEvent(
      event = new KeyboardEventCtor("keydown", { bubbles: true, cancelable: true, key }),
    )
  );
  return event;
}

function keyup(node: Element, key: string): KeyboardEvent {
  const KeyboardEventCtor = (globalThis as unknown as { KeyboardEvent: typeof KeyboardEvent })
    .KeyboardEvent;
  let event!: KeyboardEvent;
  flushSync(() =>
    node.dispatchEvent(
      event = new KeyboardEventCtor("keyup", { bubbles: true, cancelable: true, key }),
    )
  );
  return event;
}

function auxclick(node: Element): MouseEvent {
  const MouseEventCtor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  let event!: MouseEvent;
  flushSync(() =>
    node.dispatchEvent(
      event = new MouseEventCtor("auxclick", { bubbles: true, button: 1, cancelable: true }),
    )
  );
  return event;
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("timed out waiting for toolbar");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function runToolbarConformance(label: string, Wrap: React.FC<{ children: React.ReactNode }>): void {
  describe(`Toolbar adapter conformance: ${label}`, () => {
    it("keeps items untabbable during SSR", () => {
      const html = renderToString(
        <Wrap>
          <Toolbar>
            <ToolbarButton>A</ToolbarButton>
          </Toolbar>
        </Wrap>,
      );
      const document = new JSDOM(html).window.document;
      assert(document.querySelector<HTMLElement>('[role="toolbar"]')!.tabIndex === 0);
      assert(document.querySelector<HTMLElement>("[data-toolbar-item]")!.tabIndex === -1);
    });

    it("renders role=toolbar with one roving tab stop; items click", async () => {
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
        await unmount();
      }
    });

    it("moves focus with arrows and preserves the focused stop across rerenders", async () => {
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
        await unmount();
      }
    });

    it("wraps at both ends and honours Home/End", async () => {
      const { host, unmount } = render(
        <Wrap>
          <Toolbar>
            <ToolbarButton>A</ToolbarButton>
            <ToolbarButton>B</ToolbarButton>
            <ToolbarButton>C</ToolbarButton>
          </Toolbar>
        </Wrap>,
      );
      try {
        const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
        const [first, , last] = Array.from(
          host.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
        );
        last!.focus();
        keydown(bar, "ArrowRight");
        assert(
          document.activeElement === first,
          "ArrowRight wraps from the last item to the first",
        );
        keydown(bar, "End");
        assert(document.activeElement === last, "End jumps to the last item");
        keydown(bar, "Home");
        assert(document.activeElement === first, "Home jumps to the first item");
        keydown(bar, "ArrowLeft");
        assert(document.activeElement === last, "ArrowLeft wraps backwards to the last item");
      } finally {
        await unmount();
      }
    });

    it("navigates a vertical toolbar with Up/Down and ignores the cross-axis arrows", async () => {
      const { host, unmount } = render(
        <Wrap>
          <Toolbar orientation="vertical">
            <ToolbarButton>A</ToolbarButton>
            <ToolbarButton>B</ToolbarButton>
          </Toolbar>
        </Wrap>,
      );
      try {
        const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
        const [first, second] = Array.from(
          host.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
        );
        first!.focus();
        keydown(bar, "ArrowDown");
        assert(document.activeElement === second, "ArrowDown moves to the next vertical item");
        keydown(bar, "ArrowUp");
        assert(document.activeElement === first, "ArrowUp moves back to the previous item");
        keydown(bar, "ArrowRight");
        assert(document.activeElement === first, "the cross-axis arrow leaves focus unchanged");
      } finally {
        await unmount();
      }
    });

    it("skips disabled items and honors a consumer-cancelled navigation event", async () => {
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
        await unmount();
      }
    });

    it("blocks and skips a disabled toolbar link", async () => {
      const linkActivations: string[] = [];
      const { host, unmount } = render(
        <Wrap>
          <Toolbar>
            <ToolbarButton>A</ToolbarButton>
            <ToolbarLink
              disabled
              href="#danger"
              onClick={() => linkActivations.push("click")}
              onAuxClick={() => linkActivations.push("auxclick")}
              onKeyDown={() => linkActivations.push("keydown")}
              onKeyUp={() => linkActivations.push("keyup")}
            >
              Disabled link
            </ToolbarLink>
            <ToolbarButton>B</ToolbarButton>
          </Toolbar>
        </Wrap>,
      );
      try {
        const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
        const [first, link, last] = Array.from(
          host.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
        );
        assert(link!.getAttribute("aria-disabled") === "true", "exposes disabled semantics");
        assert(link!.getAttribute("href") === null, "removes disabled link navigation");
        assert(link!.tabIndex === -1, "removes the disabled link from sequential focus");
        assert(
          link!.className.includes("aria-disabled:pointer-events-none") &&
            link!.className.includes("aria-disabled:opacity-50"),
          "exposes the disabled visual state",
        );
        click(link!);
        const auxiliary = auxclick(link!);
        const enter = keydown(link!, "Enter");
        const space = keydown(link!, " ");
        const enterUp = keyup(link!, "Enter");
        const spaceUp = keyup(link!, " ");
        assert(auxiliary.defaultPrevented, "prevents disabled auxiliary navigation");
        assert(enter.defaultPrevented && space.defaultPrevented, "prevents keyboard activation");
        assert(
          enterUp.defaultPrevented && spaceUp.defaultPrevented,
          "prevents keyup activation",
        );
        assert(linkActivations.length === 0, "suppresses every disabled activation handler");
        first!.focus();
        keydown(bar, "ArrowRight");
        assert(document.activeElement === last, "roving focus skips the disabled link");
      } finally {
        await unmount();
      }
    });

    it("moves focus when the active item becomes disabled", async () => {
      let disableActive!: () => void;
      function Probe(): React.ReactElement {
        const [disabled, setDisabled] = React.useState(false);
        disableActive = () => setDisabled(true);
        return (
          <Wrap>
            <Toolbar>
              <ToolbarButton disabled={disabled}>A</ToolbarButton>
              <ToolbarButton>B</ToolbarButton>
            </Toolbar>
          </Wrap>
        );
      }

      const { host, unmount } = render(<Probe />);
      try {
        const [first, second] = Array.from(
          host.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
        );
        first!.focus();
        assert(document.activeElement === first, "first item owns focus before disabling");
        flushSync(() => disableActive());
        assert(first!.tabIndex === -1, "disabled item releases the roving stop");
        assert(second!.tabIndex === 0, "next enabled item becomes the roving stop");
        assert(document.activeElement === second, "focus follows the enabled fallback");
      } finally {
        await unmount();
      }
    });

    it("updates the resting stop on focus and isolates nested, hidden, inert, and editable content", async () => {
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
        await unmount();
      }
    });

    it("uses visual arrow direction in RTL and runs React 19 callback-ref cleanup", async () => {
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
      try {
        const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
        const [first, second] = Array.from(
          host.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
        );
        first!.focus();
        keydown(bar, "ArrowLeft");
        assert(second === document.activeElement, "ArrowLeft moves forward in RTL");
        click(second!);
        assert(firstCleanups === 1, "old callback ref cleanup runs when the ref changes");
      } finally {
        await unmount();
      }
      assert(secondCleanups === 1, "current callback ref cleanup runs on unmount");
    });
  });
}

describe("Builtin Toolbar SSR ownership", () => {
  it("emits exactly one deterministic tab stop before hydration", () => {
    const html = renderToString(
      <Toolbar>
        <ToolbarButton>A</ToolbarButton>
        <ToolbarLink href="#b">B</ToolbarLink>
        <ToolbarButton>C</ToolbarButton>
      </Toolbar>,
    );
    const document = new JSDOM(html).window.document;
    const root = document.querySelector<HTMLElement>('[role="toolbar"]')!;
    const items = [...document.querySelectorAll<HTMLElement>("[data-toolbar-item]")];
    assert(root.tabIndex === 0, "toolbar root owns the pre-hydration tab stop");
    assert(items.length === 3 && items.every((item) => item.tabIndex === -1), "items opt out");
  });

  it("forwards focus from the toolbar root to the first item", async () => {
    const { host, unmount } = render(
      <Toolbar>
        <ToolbarButton>A</ToolbarButton>
        <ToolbarButton>B</ToolbarButton>
      </Toolbar>,
    );
    try {
      const bar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
      const items = Array.from(host.querySelectorAll<HTMLElement>("[data-toolbar-item]"));
      flushSync(() => bar.focus());
      assert(
        document.activeElement === items[0],
        "focusing the toolbar root forwards focus to the first item",
      );
      assert(bar.tabIndex === -1, "the root never keeps the tab stop once an item can hold it");
    } finally {
      await unmount();
    }
  });

  it("hydrates to one item-owned tab stop without recoverable errors", async () => {
    const tree = (
      <Toolbar>
        <ToolbarButton>A</ToolbarButton>
        <ToolbarLink href="#b">B</ToolbarLink>
        <ToolbarButton>C</ToolbarButton>
      </Toolbar>
    );
    const html = renderToString(tree);
    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${html}</div></body></html>`,
      { pretendToBeVisual: true },
    );
    const restore = installDom(dom);
    const host = dom.window.document.getElementById("root")!;
    const recoverableErrors: unknown[] = [];
    const reactRoot = hydrateRoot(host, tree, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
    try {
      await waitFor(() => host.querySelector<HTMLElement>('[role="toolbar"]')?.tabIndex === -1);
      const toolbar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
      const items = [...host.querySelectorAll<HTMLElement>("[data-toolbar-item]")];
      assert(recoverableErrors.length === 0, "hydration reports no recoverable errors");
      assert(toolbar.tabIndex === -1, "root releases the hydrated tab stop");
      assert(items[0]?.tabIndex === 0, "first enabled item owns the hydrated tab stop");
      assert(items.slice(1).every((item) => item.tabIndex === -1), "other items remain untabbable");
    } finally {
      await unmountReactRoot(reactRoot);
      restore();
    }
  });
});

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
    const lastFocusedItemRef = React.useRef<HTMLElement | null>(null);
    const composedRef = React.useMemo(() => composeRefs(innerRef, ref), [ref]);
    React.useLayoutEffect(() => {
      const root = innerRef.current;
      if (!root) return;
      const items = altItems(root);
      const previousFocusedItem = lastFocusedItemRef.current;
      const activeElement = root.ownerDocument.activeElement;
      const focusBecameDisabled = previousFocusedItem !== null &&
        !items.includes(previousFocusedItem) &&
        (activeElement === previousFocusedItem ||
          (activeElement === root.ownerDocument.body && root.ownerDocument.hasFocus()));
      const active = items.find((item) => item === activeElement || item.tabIndex === 0) ??
        items[0];
      root.tabIndex = active ? -1 : 0;
      altScopedItems(root).forEach((item) => item.tabIndex = item === active ? 0 : -1);
      if (focusBecameDisabled && active) {
        lastFocusedItemRef.current = active;
        active.focus();
      }
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
        tabIndex={0}
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
            lastFocusedItemRef.current = target;
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
        tabIndex={-1}
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
