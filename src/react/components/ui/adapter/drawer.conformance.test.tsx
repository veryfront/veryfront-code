/**
 * Drawer adapter conformance - the `drawer` slot. Proves the Drawer skin works on
 * the builtin (static sheet) AND an independent contract-only drawer engine
 * (stand-in for the Vaul specialist), unchanged. The real Vaul drag physics can't
 * run in jsdom, so this asserts the slot seam (open → sheet present, Close works),
 * not the drag itself.
 *
 * @module react/components/ui/adapter/drawer.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle, DrawerTrigger } from "../drawer.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { Slot } from "../slot.tsx";
import type { DrawerParts } from "./contract.ts";

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
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];
  const prev: Record<string, unknown> = {};
  for (const k of keys) prev[k] = g[k];
  for (const k of keys) g[k] = w[k];
  g.document = w.document;
  g.window = w;
  g.getComputedStyle = (w.getComputedStyle as (e: Element) => CSSStyleDeclaration).bind(w);
  g.ResizeObserver = ResizeObserverStub;
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0);
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  return () => {
    for (const k of keys) g[k] = prev[k];
    dom.window.close();
  };
}

function render(el: React.ReactElement): { doc: Document; unmount: () => void } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(el));
  return {
    doc: dom.window.document as unknown as Document,
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

function runDrawerConformance(label: string, Wrap: React.FC<{ children: React.ReactNode }>): void {
  describe(`Drawer adapter conformance - ${label}`, () => {
    it("open renders the sheet; Close dismisses it", () => {
      // Query `document` - the sheet may portal outside #root. Open via a
      // trigger click (not `defaultOpen`): the click drains the builtin
      // modal-surface's passive `portalReady` effect so the sheet mounts.
      const { doc, unmount } = render(
        <Wrap>
          <Drawer>
            <DrawerTrigger>Open</DrawerTrigger>
            <DrawerContent>
              <DrawerTitle>Sheet</DrawerTitle>
              <DrawerClose>Done</DrawerClose>
            </DrawerContent>
          </Drawer>
        </Wrap>,
      );
      try {
        const trigger = Array.from(doc.querySelectorAll("button")).find((b) =>
          b.textContent === "Open"
        );
        assert(trigger, "trigger renders");
        click(trigger!);
        const title = Array.from(doc.querySelectorAll("h2")).find((h) => h.textContent === "Sheet");
        assert(title, "the drawer sheet is present while open");
        const close = Array.from(doc.querySelectorAll("button")).find((b) =>
          b.textContent === "Done"
        );
        assert(close, "Close button renders");
        click(close!);
        const stillThere = Array.from(doc.querySelectorAll("h2")).find((h) =>
          h.textContent === "Sheet"
        );
        assert(!stillThere, "Close dismisses the sheet");
      } finally {
        unmount();
      }
    });
  });
}

// (1) builtin - the static bottom sheet.
const Identity: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
runDrawerConformance("builtin (default)", Identity);

// (2) an INDEPENDENT contract-only drawer engine (stand-in for Vaul) - its own
// open state + a plain overlay/sheet, same Drawer skin + call-site.
const AltCtx = React.createContext<{ open: boolean; setOpen: (o: boolean) => void } | null>(null);
const altDrawer: DrawerParts = {
  Root: ({ open, defaultOpen, onOpenChange, direction: _dir, children }) => {
    const controlled = open !== undefined;
    const [internal, setInternal] = React.useState(defaultOpen ?? false);
    const isOpen = controlled ? open : internal;
    const setOpen = React.useCallback((next: boolean) => {
      if (!controlled) setInternal(next);
      onOpenChange?.(next);
    }, [controlled, onOpenChange]);
    return <AltCtx.Provider value={{ open: isOpen, setOpen }}>{children}</AltCtx.Provider>;
  },
  Trigger: ({ asChild, onClick, children, ref, ...props }) => {
    const ctx = React.useContext(AltCtx);
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        ref={ref}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          ctx?.setOpen(true);
        }}
        {...props}
      >
        {children}
      </Comp>
    );
  },
  Content: ({ children, lead, ref, ...props }) => {
    const ctx = React.useContext(AltCtx);
    if (!ctx?.open) return null;
    return <div ref={ref} role="dialog" data-alt-drawer {...props}>{lead}{children}</div>;
  },
  Close: ({ asChild, onClick, children, ref, ...props }) => {
    const ctx = React.useContext(AltCtx);
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        ref={ref}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          ctx?.setOpen(false);
        }}
        {...props}
      >
        {children}
      </Comp>
    );
  },
  // This engine wires its own labelling, so the registration surface is inert
  // here - it only has to exist and expose open/close for skin parts.
  useDrawer: () => {
    const ctx = React.useContext(AltCtx);
    return {
      open: ctx?.open ?? false,
      setOpen: (next: boolean) => ctx?.setOpen(next),
      defaultTitleId: "alt-drawer-title",
      defaultDescriptionId: "alt-drawer-description",
      descriptionId: "alt-drawer-description",
      descriptionPresent: false,
      setTitleId: () => {},
      setDescriptionId: () => {},
      setTitlePresent: () => {},
      setDescriptionPresent: () => {},
    };
  },
};

const AltWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UIAdapterProvider adapter={{ name: "independent-alt", drawer: altDrawer }}>
    {children}
  </UIAdapterProvider>
);
runDrawerConformance("independent adapter (Vaul-shaped seam proof)", AltWrap);
