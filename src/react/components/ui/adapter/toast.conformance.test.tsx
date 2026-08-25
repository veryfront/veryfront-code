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
import { createPortal, flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ToastProvider, ToastViewport, useToast } from "../toast.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { ToastClose, type ToastFn, type ToastOptions } from "../toast-parts.tsx";
import type { ToastParts, ToastProviderProps, ToastState, ToastViewportProps } from "./contract.ts";

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

  function mount(providerProps: Omit<ToastProviderProps, "children"> = {}) {
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
            {providerProps.viewport === "manual"
              ? <ToastViewport data-conformance-manual="" />
              : null}
          </ToastProvider>
        </Wrap>,
      )
    );
    return {
      dom,
      text: () => document.body.textContent ?? "",
      cleanup: async () => {
        try {
          await unmountReactRoot(root);
        } finally {
          restore();
          api = null;
        }
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
        await h.cleanup();
      }
    });

    it("retains valid falsy title and description nodes", async () => {
      const h = mount();
      try {
        flushSync(() => api!.toast({ title: 0, description: "", duration: Infinity }));
        await waitFor(() => document.querySelectorAll("ol > li").length === 1);
        const item = document.querySelector<HTMLElement>("ol > li")!;
        assert(item.textContent?.includes("0") === true, "renders a numeric zero title");
        assert(item.querySelector("p"), "retains an empty-string description node");
      } finally {
        await h.cleanup();
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
        await h.cleanup();
      }
    });

    it("toast.custom renders an arbitrary node", async () => {
      const h = mount();
      try {
        flushSync(() => api!.toast.custom((id) => <span>custom {id}</span>));
        await waitFor(() => h.text().includes("custom "));
        assert(h.text().includes("custom "), "custom node rendered");
      } finally {
        await h.cleanup();
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
        await h.cleanup();
      }
    });

    it("honours provider duration and per-toast duration overrides", async () => {
      const h = mount({ duration: 30, viewport: "inline" });
      try {
        flushSync(() => api!.toast({ title: "Default duration" }));
        await waitFor(() => h.text().includes("Default duration"));
        await waitFor(() => !h.text().includes("Default duration"));

        flushSync(() => api!.toast({ title: "Undefined duration", duration: undefined }));
        await waitFor(() => h.text().includes("Undefined duration"));
        await waitFor(() => !h.text().includes("Undefined duration"));

        let persistentId = "";
        flushSync(() =>
          persistentId = api!.toast({ title: "Persistent override", duration: Infinity })
        );
        await waitFor(() => h.text().includes("Persistent override"));
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert(h.text().includes("Persistent override"), "per-toast duration overrides provider");
        flushSync(() => api!.dismiss(persistentId));
      } finally {
        await h.cleanup();
      }
    });

    it("routes a manual viewport through the active adapter", async () => {
      const h = mount({ viewport: "manual" });
      try {
        flushSync(() => api!.toast({ title: "Manual owner", duration: Infinity }));
        await waitFor(() => h.text().includes("Manual owner"));
        assert(
          document.querySelector("[data-conformance-manual]"),
          "active adapter realizes the manual viewport",
        );
      } finally {
        await h.cleanup();
      }
    });

    it("shares public provider and per-call validation across adapters", async () => {
      assertThrows(
        () =>
          renderToString(
            <Wrap>
              <ToastProvider maxToasts={51}>
                <span />
              </ToastProvider>
            </Wrap>,
          ),
        RangeError,
        "between 1 and 50",
      );
      const h = mount();
      try {
        assertThrows(
          () => api!.toast({ title: "Invalid", duration: 2_147_483_648 }),
          RangeError,
          "2147483647",
        );
      } finally {
        await h.cleanup();
      }
    });
  });
}

// Builtin: no provider needed (it is the default adapter).
function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
runToastConformance("builtin", BuiltinWrap);

describe("Toast presentational parts", () => {
  it("uses the default close label without overwriting a caller label", () => {
    const defaultDom = new JSDOM(renderToString(<ToastClose />));
    const localizedDom = new JSDOM(
      renderToString(<ToastClose aria-label="Benachrichtigung schliessen" />),
    );
    try {
      assert(
        defaultDom.window.document.querySelector("button")?.getAttribute("aria-label") ===
          "Dismiss notification",
        "supplies the default close label",
      );
      assert(
        localizedDom.window.document.querySelector("button")?.getAttribute("aria-label") ===
          "Benachrichtigung schliessen",
        "preserves the caller-provided close label",
      );
    } finally {
      defaultDom.window.close();
      localizedDom.window.close();
    }
  });
});

describe("Builtin Toast viewport and timer lifecycle", () => {
  it("renders zero and empty-string structured content", async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(dom);
    const root = createRoot(document.getElementById("root")!);
    let api: ToastState | null = null;

    function Probe(): null {
      api = useToast();
      return null;
    }

    try {
      flushSync(() =>
        root.render(
          <ToastProvider viewport="inline">
            <Probe />
          </ToastProvider>,
        )
      );
      flushSync(() => api!.toast({ icon: 0, title: 0, description: "", duration: Infinity }));
      const surface = document.querySelector<HTMLElement>('li[role="status"]')!;
      const icon = surface.querySelector<HTMLElement>('[aria-hidden="true"]')!;
      const body = [...surface.children].find((element) => element.tagName === "DIV")!;
      assert(icon.textContent === "0", "renders a numeric zero icon");
      assert(body.children.length === 2, "renders both nullish-distinct content nodes");
      assert(body.children[0]!.textContent === "0", "renders a numeric zero title");
      assert(body.children[1]!.textContent === "", "renders an empty-string description");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("hydrates the stable portal host without errors and removes its viewport on cleanup", async () => {
    const tree = (
      <ToastProvider>
        <span>app</span>
      </ToastProvider>
    );
    const html = renderToString(
      tree,
    );
    assert(!html.includes('aria-label="Notifications"'), "SSR renders no portal viewport");
    assert(html.includes("data-vf-toast-portal-host"), "SSR reserves the stable owned host");

    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${html}</div></body></html>`,
    );
    const restore = installDomGlobals(dom);
    const recoverableErrors: unknown[] = [];
    const root = hydrateRoot(document.getElementById("root")!, tree, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
    let unmounted = false;
    try {
      await waitFor(() =>
        document.body.querySelectorAll('[aria-label="Notifications"]').length === 1
      );
      assert(recoverableErrors.length === 0, "hydration reports no recoverable errors");
      await unmountReactRoot(root);
      unmounted = true;
      assert(
        document.body.querySelectorAll('[aria-label="Notifications"]').length === 0,
        "portal viewport is removed on unmount",
      );
    } finally {
      if (!unmounted) await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
// a bare <ol>, and its own timer) satisfying the same
// contract. The skin + suite above are unchanged; passing them here proves the
// `toast` adapter boundary is a real seam a third engine (Sonner) can fill.
// ---------------------------------------------------------------------------
interface AltRecord {
  id: string;
  duration: number;
  options?: ToastOptions;
  render?: (id: string) => React.ReactNode;
}
const AltContext = React.createContext<
  (ToastState & { toasts: AltRecord[]; viewport: "portal" | "inline" | "manual" }) | null
>(null);

function AltProvider(
  { children, duration = 5000, maxToasts = 5, viewport = "portal" }: ToastProviderProps,
): React.ReactElement {
  const [toasts, dispatch] = React.useReducer(
    (
      list: AltRecord[],
      action:
        | { type: "add"; rec: AltRecord; maxToasts: number }
        | { type: "remove"; id: string }
        | { type: "trim"; maxToasts: number },
    ) =>
      action.type === "add"
        ? [...list, action.rec].slice(-action.maxToasts)
        : action.type === "remove"
        ? list.filter((t) => t.id !== action.id)
        : list.slice(-action.maxToasts),
    [],
  );
  const [portalHost, setPortalHost] = React.useState<HTMLDivElement | null>(null);
  const idRef = React.useRef(0);
  React.useLayoutEffect(() => dispatch({ type: "trim", maxToasts }), [maxToasts]);
  const dismiss = React.useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const toast = React.useMemo<ToastFn>(() => {
    const add = (rec: Omit<AltRecord, "id">) => {
      const id = `alt-${idRef.current++}`;
      dispatch({ type: "add", rec: { ...rec, id }, maxToasts });
      return id;
    };
    const fn = ((options: ToastOptions) =>
      add({ options, duration: options.duration ?? duration })) as ToastFn;
    fn.custom = (render: (id: string) => React.ReactNode) =>
      add({ render, duration });
    return fn;
  }, [duration, maxToasts]);
  const value = React.useMemo(
    () => ({ toast, dismiss, toasts, viewport }),
    [toast, dismiss, toasts, viewport],
  );
  return (
    <AltContext.Provider value={value}>
      {children}
      {viewport === "inline" ? <AltViewportContents /> : null}
      {viewport === "portal"
        ? (
          <>
            <div
              ref={setPortalHost}
              data-alt-toast-portal-host=""
              style={{ display: "contents" }}
            />
            {portalHost ? createPortal(<AltViewportContents />, portalHost) : null}
          </>
        )
        : null}
    </AltContext.Provider>
  );
}

function useAltContext(): NonNullable<React.ContextType<typeof AltContext>> {
  const ctx = React.useContext(AltContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}

function AltViewport(props: ToastViewportProps): React.ReactElement {
  const ctx = useAltContext();
  if (ctx.viewport !== "manual") {
    throw new Error('ToastViewport requires <ToastProvider viewport="manual">');
  }
  return <AltViewportContents {...props} />;
}

function AltViewportContents(props: ToastViewportProps = {}): React.ReactElement {
  const { toasts, dismiss } = useAltContext();
  return (
    <ol aria-label="alt-toasts" {...props}>
      {toasts.map((record) => (
        <AltToastItem
          key={record.id}
          record={record}
          dismiss={dismiss}
        />
      ))}
    </ol>
  );
}

function AltToastItem(
  { record, dismiss }: { record: AltRecord; dismiss: (id: string) => void },
): React.ReactElement {
  React.useEffect(() => {
    if (record.duration === 0 || record.duration === Infinity) return;
    const timer = setTimeout(() => dismiss(record.id), record.duration);
    return () => clearTimeout(timer);
  }, [dismiss, record.duration, record.id]);
  return (
    <li>
      {record.render ? record.render(record.id) : (
        <>
          <span>{record.options?.title}</span>
          {record.options?.description !== null && record.options?.description !== undefined
            ? <p>{record.options.description}</p>
            : null}
          {record.options?.action
            ? (
              <button
                type="button"
                onClick={() => {
                  try {
                    record.options!.action!.onClick();
                  } finally {
                    dismiss(record.id);
                  }
                }}
              >
                {record.options.action.label}
              </button>
            )
            : null}
        </>
      )}
    </li>
  );
}

function useAltToast(): ToastState {
  const ctx = useAltContext();
  return { toast: ctx.toast, dismiss: ctx.dismiss };
}

const altToast: ToastParts = {
  Provider: AltProvider,
  Viewport: AltViewport,
  useToast: useAltToast,
};

function useAltToastWithAdditionalState(): ToastState {
  React.useState<null>(null);
  return useAltToast();
}

const altToastWithAdditionalState: ToastParts = {
  Provider: AltProvider,
  Viewport: AltViewport,
  useToast: useAltToastWithAdditionalState,
};

describe("Toast adapter switching", () => {
  it("remounts the adapter hook bridge when hook implementations differ", async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const restore = installDomGlobals(dom);
    // React 19 reports render errors through the root callbacks rather than
    // rethrowing out of flushSync, so a hook-order violation is only visible
    // if the test collects them.
    const errors: unknown[] = [];
    const root = createRoot(document.getElementById("root")!, {
      onUncaughtError: (error: unknown) => errors.push(error),
      onCaughtError: (error: unknown) => errors.push(error),
    });
    let api: ToastState | null = null;

    function Probe(): null {
      api = useToast();
      return null;
    }

    function App(): React.ReactElement {
      const [additionalState, setAdditionalState] = React.useState(false);
      return (
        <UIAdapterProvider
          adapter={{
            name: "switching-alt",
            toast: additionalState ? altToastWithAdditionalState : altToast,
          }}
        >
          <ToastProvider viewport="inline">
            <Probe />
            <button type="button" onClick={() => setAdditionalState(true)}>Switch</button>
          </ToastProvider>
        </UIAdapterProvider>
      );
    }

    try {
      flushSync(() => root.render(<App />));
      assert(api, "initial adapter state is available");
      const button = document.querySelector("button");
      assert(button, "adapter switch is rendered");
      // Clear the captured state so the post-switch assertion cannot be
      // satisfied by the value the first render published.
      api = null;
      flushSync(() => button.click());
      assert(api, "the bridge re-renders and republishes the toast state after the adapter swap");
      flushSync(() => api!.toast({ title: "after", duration: Infinity }));
      assertStringIncludes(
        document.body.textContent ?? "",
        "after",
        "the post-swap toast API drives the live viewport",
      );
      assertEquals(errors, [], "the adapter swap must not raise a React hook-order error");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });
});

function AltWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <UIAdapterProvider adapter={{ name: "independent-alt", toast: altToast }}>
      {children}
    </UIAdapterProvider>
  );
}
runToastConformance("independent adapter (contract-is-a-real-seam proof)", AltWrap);
