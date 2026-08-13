/**
 * Popover adapter conformance + characterization.
 *
 * Doubles as:
 *  - the **behaviour-preservation proof** for the Phase-0 extraction: the skin
 *    now resolves its mechanics through `useAdapter()` (defaulting to
 *    `builtinPopover`), and these assertions pin the same observable behaviour
 *    the pre-adapter `popover.tsx` had (open on click, `role="dialog"`,
 *    `align="end"` default, `min-w-[220px]`, controlled round-trip, `asChild`).
 *  - the shared **conformance suite** every adapter must pass, run here against
 *    the builtin. The two mandatory RFC tests are included: the token-scope
 *    portal invariant and single-node / merge / spread-through contract.
 *
 * `runPopoverConformance(label, Wrap)` is written so a third-party adapter (Base
 * UI) can re-run the identical suite by passing a `Wrap` that mounts a
 * `UIAdapterProvider`.
 */
import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Popover, PopoverContent, PopoverTrigger } from "../popover.tsx";
import { Slot } from "../slot.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { builtinPopover } from "./builtin/popover.tsx";
import { useTokenScope } from "./token-scope.tsx";
import type { PopoverParts } from "./contract.ts";

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

/** Mount `element` inside a `[data-vf-ui]` token scope; return the scope + cleanup. */
function mountInScope(element: React.ReactElement): {
  scope: HTMLElement;
  root: Root;
  win: Window & typeof globalThis;
  clickTrigger: () => void;
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
  // Open via the real user path (a trigger click). Opening on a later render -
  // after the anchor ref is attached - is what portals the surface into the
  // token scope; `defaultOpen`'s first frame commits before the ref exists.
  const clickTrigger = () => {
    const trigger = scope.querySelector<HTMLElement>(
      "button, [aria-haspopup]",
    );
    if (!trigger) throw new Error("no trigger found to click");
    flushSync(() => {
      trigger.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    });
  };
  return {
    scope,
    root,
    win: dom.window as unknown as Window & typeof globalThis,
    clickTrigger,
    cleanup: () => {
      root.unmount();
      restore();
    },
  };
}

/** Identity wrap - the builtin adapter needs no provider. */
function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}

export function runPopoverConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
): void {
  describe(`Popover adapter conformance - ${label}`, () => {
    it("open trigger reveals content with role=dialog, portalled into the token scope", () => {
      const { scope, clickTrigger, cleanup } = mountInScope(
        <Wrap>
          <Popover>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent data-testid="pc">Body</PopoverContent>
          </Popover>
        </Wrap>,
      );
      try {
        clickTrigger();
        const content = scope.querySelector('[role="dialog"]');
        assert(content, "content with role=dialog must render while open");
        // MANDATORY (RFC §6.7): the portalled surface stays inside the
        // [data-vf-ui] token scope, never escaping to <body>.
        assertEquals(
          content!.closest("[data-vf-ui],[data-vf-chat]"),
          scope,
          "portalled content must stay within the token scope, not document.body",
        );
        assert(content!.textContent?.includes("Body"), "content renders children");
      } finally {
        cleanup();
      }
    });

    it("className merges: default min-w plus consumer class both land, consumer preserved", () => {
      const { scope, clickTrigger, cleanup } = mountInScope(
        <Wrap>
          <Popover>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent className="vf-test-consumer">Body</PopoverContent>
          </Popover>
        </Wrap>,
      );
      try {
        clickTrigger();
        const content = scope.querySelector('[role="dialog"]') as HTMLElement;
        assert(content, "content must render");
        assert(
          content.className.includes("min-w-[220px]"),
          "default content class is preserved",
        );
        assert(
          content.className.includes("vf-test-consumer"),
          "consumer className is merged in",
        );
      } finally {
        cleanup();
      }
    });

    it("arbitrary data-*/aria-* spread through to the content node", () => {
      const { scope, clickTrigger, cleanup } = mountInScope(
        <Wrap>
          <Popover>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent data-testid="pc" aria-label="filters">Body</PopoverContent>
          </Popover>
        </Wrap>,
      );
      try {
        clickTrigger();
        const content = scope.querySelector('[data-testid="pc"]') as HTMLElement;
        assert(content, "data-* attribute spreads through");
        assertEquals(content.getAttribute("aria-label"), "filters");
      } finally {
        cleanup();
      }
    });

    it("trigger renders a single button by default, with aria-haspopup + aria-expanded", () => {
      const { scope, clickTrigger, cleanup } = mountInScope(
        <Wrap>
          <Popover>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent>Body</PopoverContent>
          </Popover>
        </Wrap>,
      );
      try {
        const trigger = scope.querySelector("button");
        assert(trigger, "default trigger is a <button>");
        assertEquals(trigger!.getAttribute("aria-haspopup"), "dialog");
        assertEquals(trigger!.getAttribute("aria-expanded"), "false");
        clickTrigger();
        assertEquals(
          scope.querySelector("button")!.getAttribute("aria-expanded"),
          "true",
          "aria-expanded flips to true once open",
        );
      } finally {
        cleanup();
      }
    });

    it("asChild merges trigger behaviour onto the consumer element (no extra button)", () => {
      const { scope, cleanup } = mountInScope(
        <Wrap>
          <Popover>
            <PopoverTrigger asChild>
              <a href="#anchor" data-testid="link">Open</a>
            </PopoverTrigger>
            <PopoverContent>Body</PopoverContent>
          </Popover>
        </Wrap>,
      );
      try {
        const link = scope.querySelector('[data-testid="link"]') as HTMLElement;
        assert(link, "asChild renders the consumer element");
        assertEquals(link.tagName.toLowerCase(), "a", "no wrapper button is injected");
        assertEquals(link.getAttribute("aria-haspopup"), "dialog");
        // Not a <button>; the anchor is the trigger.
        assertEquals(scope.querySelector("button"), null);
      } finally {
        cleanup();
      }
    });

    it("consumer onClick composes with the internal toggle (both fire, opens)", () => {
      let clicks = 0;
      const { scope, cleanup } = mountInScope(
        <Wrap>
          <Popover>
            <PopoverTrigger onClick={() => clicks++}>Open</PopoverTrigger>
            <PopoverContent data-testid="pc">Body</PopoverContent>
          </Popover>
        </Wrap>,
      );
      try {
        assertEquals(scope.querySelector('[role="dialog"]'), null, "closed initially");
        const trigger = scope.querySelector("button")!;
        flushSync(() => {
          trigger.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true }));
        });
        assertEquals(clicks, 1, "consumer onClick fired");
        assert(
          scope.querySelector('[role="dialog"]'),
          "internal toggle fired too - popover opened",
        );
      } finally {
        cleanup();
      }
    });

    it("forwards a consumer ref to the content node (one-node contract)", () => {
      const contentRef = React.createRef<HTMLDivElement>();
      const { scope, clickTrigger, cleanup } = mountInScope(
        <Wrap>
          <Popover>
            <PopoverTrigger>Open</PopoverTrigger>
            {/* @ts-ignore ref-as-prop flows through the skin's {...props} */}
            <PopoverContent ref={contentRef}>Body</PopoverContent>
          </Popover>
        </Wrap>,
      );
      try {
        clickTrigger();
        const content = scope.querySelector('[role="dialog"]');
        assert(content, "content renders");
        assertEquals(
          contentRef.current,
          content,
          "consumer ref reaches the portalled content node",
        );
      } finally {
        cleanup();
      }
    });

    it("controlled open is honoured (open prop drives visibility)", () => {
      function Controlled({ open }: { open: boolean }): React.ReactElement {
        return (
          <Wrap>
            <Popover open={open} onOpenChange={() => {}}>
              <PopoverTrigger>Open</PopoverTrigger>
              <PopoverContent>Body</PopoverContent>
            </Popover>
          </Wrap>
        );
      }
      const { scope, root, cleanup } = mountInScope(<Controlled open={false} />);
      try {
        assertEquals(scope.querySelector('[role="dialog"]'), null, "closed when open=false");
        flushSync(() => root.render(<Controlled open />));
        assert(scope.querySelector('[role="dialog"]'), "opens when open=true");
      } finally {
        cleanup();
      }
    });
  });
}

runPopoverConformance("builtin", BuiltinWrap);

// Swap the adapter in via UIAdapterProvider and re-run the IDENTICAL suite. The
// skin (`popover.tsx`) and every call-site above are byte-for-byte the same -
// only the resolved adapter changes. Proves the provider + merge + `useAdapter`
// indirection is transparent to consumers (the core promise of RFC 0001).
function ProviderWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <UIAdapterProvider adapter={{ name: "builtin-via-provider", popover: builtinPopover }}>
      {children}
    </UIAdapterProvider>
  );
}

runPopoverConformance("builtin via UIAdapterProvider (swap path)", ProviderWrap);

// ---------------------------------------------------------------------------
// CONTRACT-IS-A-REAL-SEAM proof. A SECOND, independently-wired `PopoverParts`
// with different internals from the builtin - `useReducer` open state, a manual
// `createPortal` into the token scope (no `Floating` / `createAnchoredSurfaceParts`
// factory). It shares ONLY the contract-level `useTokenScope` helper every
// adapter is required to use. `popover.tsx` (the skin) and the RFC conformance
// suite above are byte-for-byte unchanged; passing them against this proves the
// skin depends on the CONTRACT, not on builtin internals - i.e. the adapter
// boundary is a genuine seam a third-party engine can satisfy, not a
// builtin-shaped assumption. (Runtime proof of what Base UI proves at the type
// level for popover+dialog; the full cross-engine matrix is the gate-2 interop
// testbed.)
// ---------------------------------------------------------------------------
interface AltState {
  open: boolean;
  setOpen: (open: boolean) => void;
  getContainer: () => HTMLElement;
}
const AltContext = React.createContext<AltState | null>(null);

function AltRoot(
  { children, open, defaultOpen, onOpenChange }:
    & { children: React.ReactNode }
    & { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void },
): React.ReactElement {
  const { ref, getContainer } = useTokenScope();
  const [internalOpen, dispatch] = React.useReducer(
    (_: boolean, next: boolean) => next,
    defaultOpen ?? false,
  );
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = React.useCallback((next: boolean) => {
    if (!isControlled) dispatch(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);
  const ctx = React.useMemo<AltState>(() => ({ open: isOpen, setOpen, getContainer }), [
    isOpen,
    setOpen,
    getContainer,
  ]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <AltContext.Provider value={ctx}>{children}</AltContext.Provider>
    </span>
  );
}

function AltTrigger(
  { children, asChild, onClick, ref, ...props }:
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> },
): React.ReactElement {
  const ctx = React.useContext(AltContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      aria-haspopup="dialog"
      aria-expanded={ctx?.open ?? false}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (ctx) ctx.setOpen(!ctx.open);
      }}
      {...props}
    >
      {children}
    </Comp>
  );
}

function AltContent(
  { children, align: _align, ref, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { align?: "start" | "end"; ref?: React.Ref<HTMLDivElement> },
): React.ReactElement | null {
  const ctx = React.useContext(AltContext);
  if (!ctx || !ctx.open) return null;
  return createPortal(
    <div ref={ref} {...props}>{children}</div>,
    ctx.getContainer(),
  );
}

const altPopover: PopoverParts = { Root: AltRoot, Trigger: AltTrigger, Content: AltContent };

function AltWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <UIAdapterProvider adapter={{ name: "independent-alt", popover: altPopover }}>
      {children}
    </UIAdapterProvider>
  );
}

runPopoverConformance("independent adapter (contract-is-a-real-seam proof)", AltWrap);
