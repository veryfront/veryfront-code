import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Toast, ToastProvider, useToast } from "./toast.tsx";

function installDomGlobals(dom: JSDOM): () => void {
  const window = dom.window;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    self: globalThis.self,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    MouseEvent: globalThis.MouseEvent,
  };

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
  });

  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for toast update");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Capture-probe: grabs the `useToast` API so the test can enqueue outside render.
let toastApi: ReturnType<typeof useToast> | null = null;
function Probe(): null {
  toastApi = useToast();
  return null;
}

describe("react/components/ui/toast", () => {
  it("exports the Toast surface component (rendered by the viewport per queued toast)", () => {
    assert(typeof Toast === "function", "Toast visual component must be exported");
  });

  it("enqueues a toast that renders then auto-dismisses after its duration", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ToastProvider>
            <Probe />
          </ToastProvider>,
        );
      });

      assert(toastApi, "Expected useToast() to be captured by the probe");

      // Nothing enqueued yet.
      assertEquals(document.body.querySelectorAll('[role="status"]').length, 0);

      // Enqueue a short-lived toast.
      flushSync(() => {
        toastApi!.toast({ title: "Saved", description: "All good", duration: 80 });
      });

      // It renders immediately with its title.
      await waitFor(() => document.body.textContent?.includes("Saved") ?? false);
      assertEquals(document.body.querySelectorAll('[role="status"]').length, 1);

      // It auto-dismisses once the duration elapses.
      await waitFor(() => document.body.querySelectorAll('[role="status"]').length === 0);
      assertEquals(document.body.textContent?.includes("Saved"), false);

      root.unmount();
    } finally {
      toastApi = null;
      restore();
    }
  });

  it("dismiss() removes a persistent toast manually", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ToastProvider>
            <Probe />
          </ToastProvider>,
        );
      });

      assert(toastApi, "Expected useToast() to be captured by the probe");

      let id = "";
      flushSync(() => {
        id = toastApi!.toast({ title: "Persistent", duration: Infinity });
      });

      await waitFor(() => document.body.querySelectorAll('[role="status"]').length === 1);

      flushSync(() => {
        toastApi!.dismiss(id);
      });

      await waitFor(() => document.body.querySelectorAll('[role="status"]').length === 0);

      root.unmount();
    } finally {
      toastApi = null;
      restore();
    }
  });
});
