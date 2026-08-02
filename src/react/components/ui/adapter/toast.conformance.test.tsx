/**
 * Toast adapter conformance + seam proof.
 *
 * Pins the imperative contract every `toast` adapter must honour through the
 * `toast.tsx` skin: `useToast().toast(options)` enqueues a rendered toast,
 * `dismiss(id)` removes it, an `action` button runs its handler then dismisses,
 * and `toast.custom((id) => node)` renders an arbitrary node. `runToastConformance`
 * runs the identical suite against the builtin AND a second, INDEPENDENTLY-written
 * `ToastParts` implementation: proving the skin depends on the CONTRACT, not on
 * builtin internals (the runtime analogue of the popover/combobox seam proofs).
 *
 * @module react/components/ui/adapter/toast.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ToastProvider, ToastViewport, useToast } from "../toast.tsx";
import { UIAdapterProvider } from "./context.tsx";
import type { ToastFn, ToastOptions } from "../toast-parts.tsx";
import type { ToastParts, ToastState } from "./contract.ts";

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
    getComputedStyle: window.getComputedStyle.bind(window),
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("timed out waiting for toast");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function runToastConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
): void {
  let api: ToastState | null = null;
  function Probe(): null {
    api = useToast();
    return null;
  }

  function mount(providerProps: { maxToasts?: number } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: "https://example.com/",
    });
    const restore = installDomGlobals(dom);
    const root = createRoot(document.getElementById("root")!);
    flushSync(() =>
      root.render(
        <Wrap>
          <ToastProvider {...providerProps}>
            <Probe />
          </ToastProvider>
        </Wrap>,
      )
    );
    return {
      dom,
      text: () => document.body.textContent ?? "",
      cleanup: () => {
        root.unmount();
        restore();
        api = null;
      },
    };
  }

  describe(`Toast adapter conformance: ${label}`, () => {
    it("toast(options) enqueues a rendered toast; dismiss(id) removes it", async () => {
      const h = mount();
      try {
        let id = "";
        flushSync(() => id = api!.toast({ title: "Saved", duration: Infinity }));
        await waitFor(() => h.text().includes("Saved"));
        flushSync(() => api!.dismiss(id));
        await waitFor(() => !h.text().includes("Saved"));
      } finally {
        h.cleanup();
      }
    });

    it("an action button runs its handler then dismisses", async () => {
      const h = mount();
      try {
        let ran = false;
        flushSync(() =>
          api!.toast({
            title: "Deleted",
            duration: Infinity,
            action: { label: "Undo", onClick: () => ran = true },
          })
        );
        await waitFor(() => h.text().includes("Undo"));
        const btn = [...document.body.querySelectorAll("button")].find((b) =>
          b.textContent === "Undo"
        )!;
        flushSync(() => btn.dispatchEvent(new h.dom.window.MouseEvent("click", { bubbles: true })));
        assert(ran, "action onClick fired");
        await waitFor(() => !h.text().includes("Undo"));
      } finally {
        h.cleanup();
      }
    });

    it("toast.custom renders an arbitrary node", async () => {
      const h = mount();
      try {
        flushSync(() => api!.toast.custom((id) => <span>custom {id}</span>));
        await waitFor(() => h.text().includes("custom "));
        assert(h.text().includes("custom "), "custom node rendered");
      } finally {
        h.cleanup();
      }
    });

    it("bounds the queue and evicts the oldest toast first", async () => {
      const h = mount({ maxToasts: 2 });
      try {
        flushSync(() => {
          api!.toast({ title: "First", duration: Infinity });
          api!.toast({ title: "Second", duration: Infinity });
          api!.toast({ title: "Third", duration: Infinity });
        });
        await waitFor(() => h.text().includes("Third"));
        assert(!h.text().includes("First"), "oldest toast was evicted");
        assert(h.text().includes("Second") && h.text().includes("Third"), "newest toasts remain");
      } finally {
        h.cleanup();
      }
    });
  });
}

// Builtin: no provider needed (it is the default adapter).
function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
runToastConformance("builtin", BuiltinWrap);

describe("Builtin Toast viewport and timer lifecycle", () => {
  it("renders no portal during SSR and removes the portal viewport on cleanup", async () => {
    const html = renderToString(
      <ToastProvider>
        <span>app</span>
      </ToastProvider>,
    );
    assert(!html.includes('aria-label="Notifications"'), "SSR renders no portal viewport");
    assert(html.includes("data-vf-toast-portal-host"), "SSR reserves the stable owned host");

    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(dom);
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <ToastProvider>
            <span>app</span>
          </ToastProvider>,
        )
      );
      await waitFor(() =>
        document.body.querySelectorAll('[aria-label="Notifications"]').length === 1
      );
      flushSync(() => root.unmount());
      assert(
        document.body.querySelectorAll('[aria-label="Notifications"]').length === 0,
        "portal viewport is removed on unmount",
      );
    } finally {
      restore();
    }
  });

  it("keeps the portal in the provider document and nearest UI scope", async () => {
    const shellDom = new JSDOM('<!doctype html><html><body><div id="shell"></div></body></html>');
    const foreignDom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(shellDom);
    const foreignDocument = foreignDom.window.document;
    const root = createRoot(foreignDocument.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <section data-vf-ui="scoped">
            <ToastProvider>
              <span>app</span>
            </ToastProvider>
          </section>,
        )
      );
      await waitFor(() =>
        foreignDocument.querySelectorAll('[aria-label="Notifications"]').length === 1
      );
      const viewport = foreignDocument.querySelector<HTMLElement>(
        '[aria-label="Notifications"]',
      )!;
      assert(viewport.ownerDocument === foreignDocument, "portal stays in the React root document");
      assert(viewport.closest('[data-vf-ui="scoped"]'), "portal inherits the nearest UI scope");
      assert(
        !document.querySelector('[aria-label="Notifications"]'),
        "shell document is untouched",
      );
    } finally {
      flushSync(() => root.unmount());
      restore();
      foreignDom.window.close();
    }
  });

  it("requires explicit manual ownership and never renders an automatic duplicate", async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(dom);
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <ToastProvider viewport="manual">
            <ToastViewport data-manual />
          </ToastProvider>,
        )
      );
      assert(document.querySelectorAll('[aria-label="Notifications"]').length === 1, "one owner");
      assert(document.querySelector("[data-manual]"), "manual viewport is realized");
      flushSync(() => root.unmount());
    } finally {
      restore();
    }

    assertThrows(
      () =>
        renderToString(
          <ToastProvider viewport="inline">
            <ToastViewport />
          </ToastProvider>,
        ),
      Error,
      'viewport="manual"',
    );
  });

  it("pauses auto-dismiss while hovered and while the document is hidden", async () => {
    let api: ToastState | null = null;
    function Probe(): null {
      api = useToast();
      return null;
    }
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(dom);
    const root = createRoot(document.getElementById("root")!);
    let visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    try {
      flushSync(() =>
        root.render(
          <ToastProvider viewport="inline">
            <Probe />
          </ToastProvider>,
        )
      );
      flushSync(() => api!.toast({ title: "Paused", duration: 60 }));
      const toast = document.querySelector<HTMLElement>('[role="status"]')!;
      flushSync(() =>
        toast.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }))
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert(document.body.textContent?.includes("Paused"), "hover pauses timer");
      visibility = "hidden";
      document.dispatchEvent(new dom.window.Event("visibilitychange"));
      flushSync(() =>
        toast.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true }))
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert(document.body.textContent?.includes("Paused"), "hidden document keeps timer paused");
      visibility = "visible";
      document.dispatchEvent(new dom.window.Event("visibilitychange"));
      await waitFor(() => !document.body.textContent?.includes("Paused"));
    } finally {
      root.unmount();
      restore();
    }
  });

  it("pauses auto-dismiss while focus remains inside the toast", async () => {
    let api: ToastState | null = null;
    function Probe(): null {
      api = useToast();
      return null;
    }
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(dom);
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <ToastProvider viewport="inline">
            <Probe />
          </ToastProvider>,
        )
      );
      flushSync(() =>
        api!.toast({
          title: "Focused",
          duration: 60,
          action: { label: "Action", onClick: () => undefined },
        })
      );
      const action = [...document.querySelectorAll("button")].find((button) =>
        button.textContent === "Action"
      )!;
      action.focus();
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert(document.body.textContent?.includes("Focused"), "focus pauses timer");
      action.blur();
      await waitFor(() => !document.body.textContent?.includes("Focused"));
    } finally {
      root.unmount();
      restore();
    }
  });

  it("keeps hover and focus pause reasons independent for structured and custom toasts", async () => {
    let api: ToastState | null = null;
    function Probe(): null {
      api = useToast();
      return null;
    }
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(dom);
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <ToastProvider viewport="inline" duration={60}>
            <Probe />
          </ToastProvider>,
        )
      );

      flushSync(() =>
        api!.toast({
          title: "Structured overlap",
          action: { label: "Structured action", onClick: () => undefined },
        })
      );
      let item = [...document.querySelectorAll<HTMLLIElement>("li")].find((node) =>
        node.textContent?.includes("Structured overlap")
      )!;
      const structuredAction = [...item.querySelectorAll("button")].find((button) =>
        button.textContent === "Structured action"
      )!;
      flushSync(() =>
        item.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }))
      );
      structuredAction.focus();
      flushSync(() => item.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert(document.body.contains(item), "focus keeps structured toast paused after mouseout");
      structuredAction.blur();
      await waitFor(() => !document.body.contains(item));

      flushSync(() => api!.toast.custom(() => <button type="button">Custom action</button>));
      item = [...document.querySelectorAll<HTMLLIElement>("li")].find((node) =>
        node.textContent?.includes("Custom action")
      )!;
      const customAction = item.querySelector("button")!;
      flushSync(() =>
        item.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }))
      );
      customAction.focus();
      customAction.blur();
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert(document.body.contains(item), "hover keeps custom toast paused after blur");
      flushSync(() => item.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })));
      await waitFor(() => !document.body.contains(item));
    } finally {
      root.unmount();
      restore();
    }
  });

  it("rejects delays above the host timer range and unrealistic queue capacities", () => {
    assertThrows(
      () =>
        renderToString(
          <ToastProvider duration={2_147_483_648}>
            <span />
          </ToastProvider>,
        ),
      RangeError,
      "2147483647",
    );
    assertThrows(
      () =>
        renderToString(
          <ToastProvider maxToasts={51}>
            <span />
          </ToastProvider>,
        ),
      RangeError,
      "between 1 and 50",
    );
  });
});

// ---------------------------------------------------------------------------
// Independent 2nd ToastParts: a byte-for-byte-different queue (useReducer,
// a bare <ul>, no Toast surface / no auto-dismiss timer) satisfying the same
// contract. The skin + suite above are unchanged; passing them here proves the
// `toast` adapter boundary is a real seam a third engine (Sonner) can fill.
// ---------------------------------------------------------------------------
interface AltRecord {
  id: string;
  options?: ToastOptions;
  render?: (id: string) => React.ReactNode;
}
const AltContext = React.createContext<
  (ToastState & { toasts: AltRecord[] }) | null
>(null);

function AltProvider(
  { children, maxToasts = 100 }: {
    children: React.ReactNode;
    duration?: number;
    maxToasts?: number;
  },
): React.ReactElement {
  const [toasts, dispatch] = React.useReducer(
    (list: AltRecord[], action: { type: "add"; rec: AltRecord } | { type: "remove"; id: string }) =>
      action.type === "add"
        ? [...list, action.rec].slice(-maxToasts)
        : list.filter((t) => t.id !== action.id),
    [],
  );
  const idRef = React.useRef(0);
  const dismiss = React.useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const toast = React.useMemo<ToastFn>(() => {
    const add = (rec: Omit<AltRecord, "id">) => {
      const id = `alt-${idRef.current++}`;
      dispatch({ type: "add", rec: { ...rec, id } });
      return id;
    };
    const fn = ((options: ToastOptions) => add({ options })) as ToastFn;
    fn.custom = (render: (id: string) => React.ReactNode) => add({ render });
    return fn;
  }, []);
  const value = React.useMemo(() => ({ toast, dismiss, toasts }), [toast, dismiss, toasts]);
  return (
    <AltContext.Provider value={value}>
      {children}
      <ul aria-label="alt-toasts">
        {toasts.map((t) => (
          <li key={t.id}>
            {t.render ? t.render(t.id) : (
              <>
                <span>{t.options?.title}</span>
                {t.options?.action
                  ? (
                    <button
                      type="button"
                      onClick={() => {
                        t.options!.action!.onClick();
                        dismiss(t.id);
                      }}
                    >
                      {t.options.action.label}
                    </button>
                  )
                  : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </AltContext.Provider>
  );
}

function useAltToast(): ToastState {
  const ctx = React.useContext(AltContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return { toast: ctx.toast, dismiss: ctx.dismiss };
}

const altToast: ToastParts = { Provider: AltProvider, useToast: useAltToast };

function AltWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <UIAdapterProvider adapter={{ name: "independent-alt", toast: altToast }}>
      {children}
    </UIAdapterProvider>
  );
}
runToastConformance("independent adapter (contract-is-a-real-seam proof)", AltWrap);
