import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ComponentDomOptions, installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { AppShell } from "./app-shell.tsx";

function shellDomOptions(options: { mobile?: boolean } = {}): ComponentDomOptions {
  return {
    matchMedia: { matches: options.mobile ?? false },
    windowGlobals: ["self", "localStorage", "KeyboardEvent"],
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
    const restore = installComponentDom(dom, shellDomOptions());
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      root = hydrateRoot(rootElement, <Shell />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });

      await waitFor(() => document.querySelector("[data-sidebar='left']") === null);
      assertEquals(recoverableErrors, []);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("keeps document scrolling locked until every shell overlay releases ownership", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root-a"></div><div id="root-b"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, shellDomOptions({ mobile: true }));
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

      await unmountReactRoot(rootA);
      rootA = undefined;
      assertEquals(document.querySelectorAll('[role="dialog"]').length, 1);
      assertEquals(
        document.body.style.overflow,
        "hidden",
        "the remaining overlay still owns the document lock",
      );

      await unmountReactRoot(rootB);
      rootB = undefined;
      assertEquals(
        document.body.style.overflow,
        "scroll",
        "the final release restores the exact pre-lock value",
      );
    } finally {
      if (rootA) await unmountReactRoot(rootA);
      if (rootB) await unmountReactRoot(rootB);
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
    const restore = installComponentDom(dom, shellDomOptions());
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
      await unmountReactRoot(root);
      restore();
    }
  });

  it("keeps generated structure authoritative while preserving safe caller styles", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, shellDomOptions({ mobile: true }));
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
      await unmountReactRoot(root);
      restore();
    }
  });

  it("persists uncontrolled desktop visibility under the storage key", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, shellDomOptions());
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => {
        root.render(
          <AppShell storageKey="persist-shell" keyboardShortcut={false}>
            <AppShell.Trigger data-trigger="left" />
            <AppShell.Sidebar data-sidebar="left">navigation</AppShell.Sidebar>
          </AppShell>,
        );
      });
      await waitFor(() => document.querySelector('[data-sidebar="left"]') !== null);
      const trigger = document.querySelector<HTMLButtonElement>('[data-trigger="left"]');
      assert(trigger);

      flushSync(() => trigger.click());
      assertEquals(
        dom.window.localStorage.getItem("persist-shell-left"),
        "false",
        "toggling the sidebar persists the new visibility",
      );

      flushSync(() => trigger.click());
      assertEquals(
        dom.window.localStorage.getItem("persist-shell-left"),
        "true",
        "toggling back persists the restored visibility",
      );
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("controlled sides report through onOpenChange without self-updating", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, shellDomOptions());
    const root = createRoot(document.getElementById("root")!);
    const calls: Array<[string, boolean]> = [];

    function Controlled({ left }: { left: boolean }): React.ReactElement {
      return (
        <AppShell
          storageKey="controlled-shell"
          open={{ left }}
          onOpenChange={(side, next) => calls.push([side, next])}
        >
          <AppShell.Sidebar data-sidebar="left">navigation</AppShell.Sidebar>
        </AppShell>
      );
    }

    try {
      flushSync(() => root.render(<Controlled left />));
      await waitFor(() => document.querySelector('[data-sidebar="left"]') !== null);

      flushSync(() =>
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            metaKey: true,
            key: "b",
          }),
        )
      );

      assertEquals(calls, [["left", false]], "a controlled side reports the requested state");
      assert(
        document.querySelector('[data-sidebar="left"]'),
        "a controlled side must not close itself",
      );
      assertEquals(
        dom.window.localStorage.getItem("controlled-shell-left"),
        null,
        "a controlled side does not write the parent's state to storage",
      );

      flushSync(() => root.render(<Controlled left={false} />));
      assertEquals(
        document.querySelector('[data-sidebar="left"]'),
        null,
        "the parent-owned open prop drives visibility",
      );
    } finally {
      await unmountReactRoot(root);
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
