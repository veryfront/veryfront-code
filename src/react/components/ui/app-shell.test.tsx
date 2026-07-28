import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AppShell } from "./app-shell.tsx";

function installDom(dom: JSDOM, options: { mobile?: boolean } = {}): () => void {
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "localStorage",
    "KeyboardEvent",
    "MouseEvent",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "matchMedia",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

  const media = {
    matches: options.mobile ?? false,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as MediaQueryList;
  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    localStorage: window.localStorage,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: number) => window.clearTimeout(id),
    matchMedia: (() => media) as typeof globalThis.matchMedia,
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for AppShell hydration");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function Shell(): React.ReactElement {
  return (
    <AppShell storageKey="shell" keyboardShortcut={false}>
      <AppShell.Sidebar data-sidebar="left">navigation</AppShell.Sidebar>
      <AppShell.Main>content</AppShell.Main>
    </AppShell>
  );
}

function MobileShell({ name }: { name: string }): React.ReactElement {
  return (
    <AppShell keyboardShortcut={false}>
      <AppShell.Trigger data-trigger={name} />
      <AppShell.Sidebar data-sidebar={name}>
        <button type="button">inside {name}</button>
      </AppShell.Sidebar>
    </AppShell>
  );
}

describe("AppShell", () => {
  it("hydrates from the server default before reconciling persisted visibility", async () => {
    const serverMarkup = renderToString(<Shell />);
    assert(serverMarkup.includes('data-sidebar="left"'));

    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${serverMarkup}</div></body></html>`,
      { url: "https://example.com/" },
    );
    dom.window.localStorage.setItem("shell-left", "false");
    const restore = installDom(dom);
    const recoverableErrors: unknown[] = [];

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const root = hydrateRoot(rootElement, <Shell />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });

      await waitFor(() => document.querySelector("[data-sidebar='left']") === null);
      assertEquals(recoverableErrors, []);

      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      restore();
    }
  });

  it("keeps document scrolling locked until every shell overlay releases ownership", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root-a"></div><div id="root-b"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDom(dom, { mobile: true });
    let rootA: ReturnType<typeof createRoot> | undefined;
    let rootB: ReturnType<typeof createRoot> | undefined;

    try {
      document.body.style.overflow = "scroll";
      rootA = createRoot(document.getElementById("root-a")!);
      rootB = createRoot(document.getElementById("root-b")!);
      flushSync(() => {
        rootA?.render(<MobileShell name="a" />);
        rootB?.render(<MobileShell name="b" />);
      });

      await waitFor(() =>
        [...document.querySelectorAll<HTMLButtonElement>("[data-trigger]")].every(
          (trigger) => trigger.getAttribute("aria-expanded") === "false",
        )
      );
      const triggerA = document.querySelector<HTMLButtonElement>('[data-trigger="a"]');
      const triggerB = document.querySelector<HTMLButtonElement>('[data-trigger="b"]');
      assert(triggerA);
      assert(triggerB);
      flushSync(() => {
        triggerA.click();
        triggerB.click();
      });

      await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 2);
      assertEquals(document.body.style.overflow, "hidden");

      flushSync(() => rootA?.unmount());
      rootA = undefined;
      assertEquals(document.querySelectorAll('[role="dialog"]').length, 1);
      assertEquals(
        document.body.style.overflow,
        "hidden",
        "the remaining overlay still owns the document lock",
      );

      flushSync(() => rootB?.unmount());
      rootB = undefined;
      assertEquals(
        document.body.style.overflow,
        "scroll",
        "the final release restores the exact pre-lock value",
      );
    } finally {
      if (rootA) flushSync(() => rootA?.unmount());
      if (rootB) flushSync(() => rootB?.unmount());
      restore();
    }
  });

  it("leaves Ctrl/Cmd+B to editable targets but handles it elsewhere", async () => {
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <input data-editable="input">
        <div contenteditable data-editable="content">
          <span data-editable-child>editable child</span>
        </div>
        <div id="root"></div>
      </body></html>`,
      { url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <AppShell>
            <AppShell.Sidebar data-sidebar="left">navigation</AppShell.Sidebar>
          </AppShell>,
        );
      });

      const input = document.querySelector<HTMLInputElement>('[data-editable="input"]');
      const editableChild = document.querySelector<HTMLElement>("[data-editable-child]");
      assert(input);
      assert(editableChild);

      for (const target of [input, editableChild]) {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "b",
        });
        flushSync(() => target.dispatchEvent(event));
        assertEquals(event.defaultPrevented, false);
        assert(document.querySelector('[data-sidebar="left"]'));
      }

      const documentShortcut = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        key: "B",
      });
      flushSync(() => document.body.dispatchEvent(documentShortcut));
      assertEquals(documentShortcut.defaultPrevented, true);
      assertEquals(document.querySelector('[data-sidebar="left"]'), null);
    } finally {
      flushSync(() => root.unmount());
      restore();
    }
  });

  it("keeps generated structure authoritative while preserving safe caller styles", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDom(dom, { mobile: true });
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <AppShell
            keyboardShortcut={false}
            data-vf-appshell="caller"
            data-vf-ui="caller"
          >
            <AppShell.Trigger
              data-trigger="structural"
              aria-controls="caller-controls"
              aria-expanded={false}
            />
            <AppShell.Sidebar
              id="caller-sidebar"
              data-sidebar="structural"
              role="navigation"
              aria-modal="false"
              aria-label="Project navigation"
              tabIndex={5}
              style={{ color: "red", transform: "scale(2)", width: 999 }}
            >
              navigation
            </AppShell.Sidebar>
          </AppShell>,
        );
      });

      const trigger = document.querySelector<HTMLButtonElement>('[data-trigger="structural"]');
      assert(trigger);
      await waitFor(() => trigger.getAttribute("aria-expanded") === "false");
      flushSync(() => trigger.click());

      await waitFor(() => {
        const panel = document.querySelector<HTMLElement>('[data-sidebar="structural"]');
        return panel?.style.transform === "translateX(0)";
      });
      const panel = document.querySelector<HTMLElement>('[data-sidebar="structural"]');
      const shell = document.querySelector<HTMLElement>("[data-vf-appshell]");
      assert(panel);
      assert(shell);

      assert(panel.id !== "caller-sidebar");
      assertEquals(panel.id, trigger.getAttribute("aria-controls"));
      assertEquals(trigger.getAttribute("aria-expanded"), "true");
      assertEquals(panel.getAttribute("role"), "dialog");
      assertEquals(panel.getAttribute("aria-modal"), "true");
      assertEquals(panel.getAttribute("aria-label"), "Project navigation");
      assertEquals(panel.tabIndex, -1);
      assertEquals(panel.style.width, "240px");
      assertEquals(panel.style.transform, "translateX(0)");
      assertEquals(panel.style.color, "red");
      assertEquals(shell.getAttribute("data-vf-appshell"), "");
      assertEquals(shell.getAttribute("data-vf-ui"), "");
      assertEquals(shell.getAttribute("data-vf-chat"), "");
    } finally {
      flushSync(() => root.unmount());
      restore();
    }
  });

  it("keeps desktop sidebar identity and width authoritative", () => {
    const markup = renderToString(
      <AppShell keyboardShortcut={false}>
        <AppShell.Trigger
          data-trigger="desktop"
          aria-controls="caller-controls"
          aria-expanded={false}
        />
        <AppShell.Sidebar
          id="caller-sidebar"
          data-sidebar="desktop"
          role="navigation"
          aria-label="Desktop navigation"
          width={320}
          style={{ color: "red", width: 999 }}
        >
          navigation
        </AppShell.Sidebar>
      </AppShell>,
    );
    const dom = new JSDOM(markup);

    try {
      const trigger = dom.window.document.querySelector<HTMLButtonElement>(
        '[data-trigger="desktop"]',
      );
      const panel = dom.window.document.querySelector<HTMLElement>('[data-sidebar="desktop"]');
      assert(trigger);
      assert(panel);

      assert(panel.id !== "caller-sidebar");
      assertEquals(panel.id, trigger.getAttribute("aria-controls"));
      assertEquals(trigger.getAttribute("aria-expanded"), "true");
      assertEquals(panel.getAttribute("role"), "navigation");
      assertEquals(panel.getAttribute("aria-label"), "Desktop navigation");
      assertEquals(panel.style.width, "320px");
      assertEquals(panel.style.color, "red");
    } finally {
      dom.window.close();
    }
  });
});
