import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AppShell } from "./app-shell.tsx";

function installDom(dom: JSDOM): () => void {
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
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    localStorage: window.localStorage,
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
});
