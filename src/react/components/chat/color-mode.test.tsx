import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ColorModeProvider, useColorMode } from "./color-mode.tsx";

function installDomGlobals(dom: JSDOM): () => void {
  const window = dom.window;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    localStorage: globalThis.localStorage,
    matchMedia: globalThis.matchMedia,
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
    localStorage: window.localStorage,
    matchMedia: () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
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
      throw new Error("Timed out waiting for color mode update");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function ToggleFixture(): React.ReactElement {
  const { resolvedMode, toggleMode } = useColorMode();

  return (
    <button type="button" data-mode={resolvedMode} onClick={toggleMode}>
      toggle
    </button>
  );
}

describe("react/components/chat/color-mode", () => {
  it("updates the html color-scheme inline style when toggling color mode", async () => {
    const dom = new JSDOM(
      '<!doctype html><html style="color-scheme: dark;"><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    const storageKey = `vf-color-mode-test-${crypto.randomUUID()}`;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ColorModeProvider defaultMode="dark" storageKey={storageKey}>
            <ToggleFixture />
          </ColorModeProvider>,
        );
      });

      await waitFor(() => document.documentElement.classList.contains("dark"));
      assertEquals(document.documentElement.style.colorScheme, "dark");

      const button = document.querySelector("button");
      assert(button, "Expected toggle button to exist");
      flushSync(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      await waitFor(() => document.documentElement.classList.contains("light"));
      assertEquals(document.documentElement.style.colorScheme, "light");

      root.unmount();
    } finally {
      restore();
    }
  });
});
