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
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
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
  // The stub is a real timer, so a frame still queued when the test ends is a
  // pending timer and trips the leak sanitizer. React can schedule a frame right
  // up to unmount, so track outstanding frames and drain them on teardown.
  const pendingFrames = new Set<ReturnType<typeof setTimeout>>();
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    const id = setTimeout(() => {
      pendingFrames.delete(id);
      cb(0);
    }, 0);
    pendingFrames.add(id);
    return id as unknown as number;
  };
  g.cancelAnimationFrame = (id: number) => {
    pendingFrames.delete(id as unknown as ReturnType<typeof setTimeout>);
    clearTimeout(id);
  };
  return () => {
    for (const frame of pendingFrames) clearTimeout(frame);
    pendingFrames.clear();
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
  flushSync(() => {});
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

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

    it("keeps a default-open drawer without a trigger inside the token scope", async () => {
      const { doc, unmount } = render(
        <Wrap>
          <div data-vf-ui="" data-testid="scope">
            <Drawer defaultOpen>
              <DrawerContent>
                <DrawerTitle>Sheet</DrawerTitle>
              </DrawerContent>
            </Drawer>
          </div>
        </Wrap>,
      );
      try {
        await waitFor(
          () => Array.from(doc.querySelectorAll("h2")).some((h) => h.textContent === "Sheet"),
          "default-open drawer did not render without a trigger",
        );
        const title = Array.from(doc.querySelectorAll("h2")).find((h) => h.textContent === "Sheet");
        assert(title, "default-open drawer renders without a trigger");
        const panel = title!.closest('[role="dialog"]');
        assert(panel, "drawer title is contained by the dialog panel");
        assertEquals(
          panel!.closest("[data-vf-ui],[data-vf-chat]"),
          doc.querySelector('[data-testid="scope"]'),
          "no-trigger drawer portal stays inside the token scope",
        );
      } finally {
        unmount();
      }
    });

    it("forwards consumer refs to trigger and close nodes", () => {
      const triggerRef = React.createRef<HTMLButtonElement>();
      const closeRef = React.createRef<HTMLButtonElement>();
      const { doc, unmount } = render(
        <Wrap>
          <Drawer>
            <DrawerTrigger ref={triggerRef}>Open</DrawerTrigger>
            <DrawerContent>
              <DrawerTitle>Sheet</DrawerTitle>
              <DrawerClose ref={closeRef}>Done</DrawerClose>
            </DrawerContent>
          </Drawer>
        </Wrap>,
      );
      try {
        const trigger = Array.from(doc.querySelectorAll("button")).find((button) =>
          button.textContent === "Open"
        );
        assert(trigger, "trigger renders");
        assertEquals(triggerRef.current, trigger, "trigger ref reaches the button node");
        click(trigger);
        const close = Array.from(doc.querySelectorAll("button")).find((button) =>
          button.textContent === "Done"
        );
        assert(close, "close renders while open");
        assertEquals(closeRef.current, close, "close ref reaches the button node");
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
      defaultContentId: "alt-drawer-content",
      defaultDescriptionId: "alt-drawer-description",
      contentId: "alt-drawer-content",
      descriptionId: "alt-drawer-description",
      descriptionPresent: false,
      setContentId: () => {},
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
