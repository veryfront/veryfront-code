/**
 * Tooltip adapter conformance + characterization. Pins the pre-adapter
 * behaviour of `tooltip.tsx` now that its mechanics resolve through
 * `useAdapter()` (defaulting to `builtinTooltip`): focus opens a `role="tooltip"`
 * bubble portalled into the token scope, blur hides it, `asChild` merges the
 * trigger. Re-run through `UIAdapterProvider`.
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { builtinTooltip } from "./builtin/tooltip.tsx";

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
    "FocusEvent",
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
    FocusEvent: window.FocusEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

function mount(element: React.ReactElement): {
  scope: HTMLElement;
  root: Root;
  focus: (el: HTMLElement) => void;
  blur: (el: HTMLElement) => void;
  cleanup: () => void;
} {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"></div></body></html>`,
    { url: "https://example.com/", pretendToBeVisual: true },
  );
  const restore = installDomGlobals(dom);
  const scope = document.createElement("div");
  scope.setAttribute("data-vf-ui", "");
  document.getElementById("root")!.appendChild(scope);
  const root = createRoot(scope);
  flushSync(() => root.render(element));
  return {
    scope,
    root,
    focus: (el: HTMLElement) => flushSync(() => el.focus()),
    blur: (el: HTMLElement) => flushSync(() => el.blur()),
    cleanup: () => {
      root.unmount();
      restore();
    },
  };
}

function runTooltipConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
): void {
  describe(`Tooltip adapter conformance — ${label}`, () => {
    it("focus opens a role=tooltip bubble inside the token scope; blur hides it", () => {
      const { scope, focus, blur, cleanup } = mount(
        <Wrap>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button">Hover</button>
            </TooltipTrigger>
            <TooltipContent className="vf-test-tip">Hi</TooltipContent>
          </Tooltip>
        </Wrap>,
      );
      try {
        assertEquals(scope.querySelector('[role="tooltip"]'), null, "closed initially");
        focus(scope.querySelector("button")!);
        const tip = scope.querySelector('[role="tooltip"]') as HTMLElement;
        assert(tip, "focus opens the tooltip");
        assertEquals(
          tip.closest("[data-vf-ui],[data-vf-chat]"),
          scope,
          "tooltip bubble stays within the token scope",
        );
        assert(tip.className.includes("vf-test-tip"), "consumer class merged");
        assert(tip.textContent?.includes("Hi"), "renders children");
        blur(scope.querySelector("button")!);
        assertEquals(scope.querySelector('[role="tooltip"]'), null, "blur hides it");
      } finally {
        cleanup();
      }
    });

    it("forwards a consumer ref to the bubble node (one-node contract)", () => {
      const tipRef = React.createRef<HTMLDivElement>();
      const { scope, focus, cleanup } = mount(
        <Wrap>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button">Hover</button>
            </TooltipTrigger>
            {/* @ts-ignore ref-as-prop flows through the skin's {...props} */}
            <TooltipContent ref={tipRef}>Hi</TooltipContent>
          </Tooltip>
        </Wrap>,
      );
      try {
        focus(scope.querySelector("button")!);
        const tip = scope.querySelector('[role="tooltip"]');
        assert(tip, "tooltip renders on focus");
        assertEquals(tipRef.current, tip, "consumer ref reaches the bubble node");
      } finally {
        cleanup();
      }
    });

    it("Provider is a passthrough that renders its children", () => {
      const { scope, cleanup } = mount(
        <Wrap>
          <TooltipProvider>
            <span data-testid="kid">child</span>
          </TooltipProvider>
        </Wrap>,
      );
      try {
        assert(scope.querySelector('[data-testid="kid"]'), "Provider renders children");
      } finally {
        cleanup();
      }
    });

    it("asChild merges the trigger onto the consumer element (no wrapper span)", () => {
      const { scope, cleanup } = mount(
        <Wrap>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" data-testid="btn">Hover</button>
            </TooltipTrigger>
            <TooltipContent>Hi</TooltipContent>
          </Tooltip>
        </Wrap>,
      );
      try {
        const btn = scope.querySelector('[data-testid="btn"]') as HTMLElement;
        assert(btn, "asChild renders the consumer element");
        assertEquals(btn.tagName.toLowerCase(), "button");
      } finally {
        cleanup();
      }
    });
  });
}

function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
function ProviderWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <UIAdapterProvider adapter={{ tooltip: builtinTooltip }}>{children}</UIAdapterProvider>
  );
}

runTooltipConformance("builtin", BuiltinWrap);
runTooltipConformance("builtin via UIAdapterProvider (swap path)", ProviderWrap);
