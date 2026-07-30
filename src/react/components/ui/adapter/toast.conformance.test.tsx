/**
 * Toast adapter conformance + seam proof.
 *
 * Pins the imperative contract every `toast` adapter must honour through the
 * `toast.tsx` skin: `useToast().toast(options)` enqueues a rendered toast,
 * `dismiss(id)` removes it, an `action` button runs its handler then dismisses,
 * and `toast.custom((id) => node)` renders an arbitrary node. `runToastConformance`
 * runs the identical suite against the builtin AND a second, INDEPENDENTLY-written
 * `ToastParts` implementation — proving the skin depends on the CONTRACT, not on
 * builtin internals (the runtime analogue of the popover/combobox seam proofs).
 *
 * @module react/components/ui/adapter/toast.conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ToastProvider, useToast } from "../toast.tsx";
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

  function mount() {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: "https://example.com/",
    });
    const restore = installDomGlobals(dom);
    const root = createRoot(document.getElementById("root")!);
    flushSync(() =>
      root.render(
        <Wrap>
          <ToastProvider>
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

  describe(`Toast adapter conformance — ${label}`, () => {
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
  });
}

// Builtin: no provider needed (it is the default adapter).
function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
runToastConformance("builtin", BuiltinWrap);

// ---------------------------------------------------------------------------
// Independent 2nd ToastParts — a byte-for-byte-different queue (useReducer,
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

function AltProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toasts, dispatch] = React.useReducer(
    (list: AltRecord[], action: { type: "add"; rec: AltRecord } | { type: "remove"; id: string }) =>
      action.type === "add" ? [...list, action.rec] : list.filter((t) => t.id !== action.id),
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
