/**
 * Dialog adapter conformance + characterization. Pins the pre-adapter behaviour
 * of `dialog.tsx` now that its mechanics resolve through `useAdapter()`
 * (defaulting to `builtinDialog`): trigger opens an `aria-modal` panel, overlay
 * classes merge, `DialogClose` / `DialogCancel` dismiss, `asChild` merges the
 * trigger. Also re-run through `UIAdapterProvider` with an INDEPENDENT engine
 * (one that stamps `data-alt-dialog` on the panel) to prove the swap path is
 * really honoured rather than silently falling back to the builtin.
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { Dialog, DialogCancel, DialogClose, DialogContent, DialogTrigger } from "../dialog.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { builtinDialog } from "./builtin/dialog.tsx";

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

function mount(element: React.ReactElement): {
  scope: HTMLElement;
  root: Root;
  win: typeof globalThis & Window;
  click: (el: Element) => void;
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
  // Drain mount-time passive effects (e.g. modal-surface's `portalReady`
  // two-pass) so a `defaultOpen` panel is portalled before assertions run.
  flushSync(() => {});
  const win = dom.window as unknown as typeof globalThis & Window;
  return {
    scope,
    root,
    win,
    click: (el: Element) =>
      flushSync(() => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }))),
    cleanup: () => {
      root.unmount();
      restore();
    },
  };
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

function runDialogConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
  expectAltEngine = false,
): void {
  describe(`Dialog adapter conformance - ${label}`, () => {
    afterEach(async () => {
      // jsdom defers selection updates after focus. Drain that timer before
      // Deno's leak sanitizer closes the surrounding conformance group.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    it("trigger opens an aria-modal dialog panel with merged classes", () => {
      const { scope, click, cleanup } = mount(
        <Wrap>
          <Dialog>
            <DialogTrigger>Open</DialogTrigger>
            <DialogContent className="vf-test-panel">Body</DialogContent>
          </Dialog>
        </Wrap>,
      );
      try {
        assertEquals(scope.querySelector('[role="dialog"]'), null, "closed initially");
        click(scope.querySelector("button")!);
        const panel = scope.querySelector('[role="dialog"]') as HTMLElement;
        assert(panel, "trigger opens the dialog");
        assertEquals(panel.getAttribute("aria-modal"), "true");
        assert(panel.className.includes("vf-test-panel"), "consumer class merged");
        assert(
          panel.className.includes("rounded-xl"),
          "default panel classes preserved",
        );
        assert(
          panel.className.includes("w-[calc(100%_-_3rem)]"),
          "viewport width uses Tailwind's escaped calc spacing",
        );
      } finally {
        cleanup();
      }
    });

    it("keeps a default-open dialog without a trigger inside the token scope", async () => {
      const { scope, cleanup } = mount(
        <Wrap>
          <Dialog defaultOpen>
            <DialogContent>Body</DialogContent>
          </Dialog>
        </Wrap>,
      );
      try {
        await waitFor(
          () => scope.querySelector('[role="dialog"]') !== null,
          "default-open dialog did not render without a trigger",
        );
        const panel = scope.querySelector('[role="dialog"]');
        assert(panel, "default-open dialog renders without a trigger");
        assertEquals(
          panel!.closest("[data-vf-ui],[data-vf-chat]"),
          scope,
          "no-trigger dialog portal stays inside the token scope",
        );
      } finally {
        cleanup();
      }
    });

    // Open via a trigger click (not `defaultOpen`): the click both anchors the
    // panel's portal in the token scope and drains the modal-surface passive
    // effects, so the panel is present before we assert the dismiss paths.
    it("DialogClose dismisses the dialog", () => {
      const { scope, click, cleanup } = mount(
        <Wrap>
          <Dialog>
            <DialogTrigger>Open</DialogTrigger>
            <DialogContent>
              <DialogClose>Close</DialogClose>
            </DialogContent>
          </Dialog>
        </Wrap>,
      );
      try {
        click(scope.querySelector("button")!);
        const panel = scope.querySelector('[role="dialog"]');
        assert(panel, "trigger opened the dialog");
        click(panel!.querySelector("button")!);
        assertEquals(scope.querySelector('[role="dialog"]'), null, "Close dismissed it");
      } finally {
        cleanup();
      }
    });

    it("DialogCancel reads modal state via the adapter and dismisses", () => {
      const { scope, click, cleanup } = mount(
        <Wrap>
          <Dialog>
            <DialogTrigger>Open</DialogTrigger>
            <DialogContent>
              <DialogCancel>Cancel</DialogCancel>
            </DialogContent>
          </Dialog>
        </Wrap>,
      );
      try {
        click(scope.querySelector("button")!);
        const panel = scope.querySelector('[role="dialog"]');
        assert(panel, "trigger opened the dialog");
        click(panel!.querySelector("button")!);
        assertEquals(scope.querySelector('[role="dialog"]'), null, "Cancel dismissed it");
      } finally {
        cleanup();
      }
    });

    it("DialogCancel respects a consumer-cancelled click", () => {
      const { scope, click, cleanup } = mount(
        <Wrap>
          <Dialog>
            <DialogTrigger>Open</DialogTrigger>
            <DialogContent>
              <DialogCancel onClick={(event) => event.preventDefault()}>
                Keep open
              </DialogCancel>
            </DialogContent>
          </Dialog>
        </Wrap>,
      );
      try {
        click(scope.querySelector("button")!);
        const panel = scope.querySelector('[role="dialog"]');
        assert(panel, "trigger opened the dialog");
        click(panel!.querySelector("button")!);
        assert(scope.querySelector('[role="dialog"]'), "preventDefault keeps the dialog open");
      } finally {
        cleanup();
      }
    });

    it("forwards consumer refs to trigger and close nodes", () => {
      const triggerRef = React.createRef<HTMLButtonElement>();
      const closeRef = React.createRef<HTMLButtonElement>();
      const { scope, click, cleanup } = mount(
        <Wrap>
          <Dialog>
            <DialogTrigger ref={triggerRef}>Open</DialogTrigger>
            <DialogContent>
              <DialogClose ref={closeRef}>Close</DialogClose>
            </DialogContent>
          </Dialog>
        </Wrap>,
      );
      try {
        const trigger = scope.querySelector("button");
        assert(trigger, "trigger renders");
        assertEquals(triggerRef.current, trigger, "trigger ref reaches the button node");
        click(trigger);
        const close = scope.querySelector('[role="dialog"] button');
        assert(close, "close renders while open");
        assertEquals(closeRef.current, close, "close ref reaches the button node");
      } finally {
        cleanup();
      }
    });

    it("forwards a consumer ref to the panel node (one-node contract)", () => {
      const panelRef = React.createRef<HTMLDivElement>();
      const { scope, click, cleanup } = mount(
        <Wrap>
          <Dialog>
            <DialogTrigger>Open</DialogTrigger>
            <DialogContent ref={panelRef}>Body</DialogContent>
          </Dialog>
        </Wrap>,
      );
      try {
        click(scope.querySelector("button")!);
        const panel = scope.querySelector('[role="dialog"]');
        assert(panel, "panel renders");
        assertEquals(panelRef.current, panel, "consumer ref reaches the panel node");
      } finally {
        cleanup();
      }
    });

    it("asChild merges the trigger onto a consumer element (no wrapper button)", () => {
      const { scope, click, cleanup } = mount(
        <Wrap>
          <Dialog>
            <DialogTrigger asChild>
              <a href="#x" data-testid="link">Open</a>
            </DialogTrigger>
            <DialogContent>Body</DialogContent>
          </Dialog>
        </Wrap>,
      );
      try {
        const link = scope.querySelector('[data-testid="link"]') as HTMLElement;
        assertEquals(link.tagName.toLowerCase(), "a");
        assertEquals(scope.querySelector("button"), null, "no wrapper button injected");
        click(link);
        assert(scope.querySelector('[role="dialog"]'), "asChild trigger opens the dialog");
      } finally {
        cleanup();
      }
    });

    if (expectAltEngine) {
      it("renders the engine supplied by UIAdapterProvider, not the builtin", () => {
        const { scope, click, cleanup } = mount(
          <Wrap>
            <Dialog>
              <DialogTrigger>Open</DialogTrigger>
              <DialogContent>Body</DialogContent>
            </Dialog>
          </Wrap>,
        );
        try {
          click(scope.querySelector("button")!);
          assert(
            scope.querySelector('[role="dialog"][data-alt-dialog]'),
            "dialog.tsx renders the engine supplied by UIAdapterProvider, not the builtin",
          );
        } finally {
          cleanup();
        }
      });
    }
  });
}

function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
/**
 * A marker engine that delegates to the builtin one but stamps `data-alt-dialog`
 * on the panel. Passing the builtin straight back through the provider would
 * make the second run byte-identical to the first and could not detect
 * `dialog.tsx` ignoring the adapter.
 */
const altDialog: typeof builtinDialog = {
  ...builtinDialog,
  Content: (props: React.ComponentProps<typeof builtinDialog.Content>) => (
    <builtinDialog.Content data-alt-dialog="" {...props} />
  ),
};

function ProviderWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <UIAdapterProvider adapter={{ name: "independent-alt", dialog: altDialog }}>
      {children}
    </UIAdapterProvider>
  );
}

runDialogConformance("builtin", BuiltinWrap);
runDialogConformance("independent alt engine via UIAdapterProvider", ProviderWrap, true);
