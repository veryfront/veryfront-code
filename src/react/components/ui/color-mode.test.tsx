import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ColorModeProvider, ColorModeScript, useColorMode } from "./color-mode.tsx";

function createMutableMatchMedia(initialMatches: boolean): {
  matchMedia: typeof globalThis.matchMedia;
  setMatches(matches: boolean): void;
} {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
    addListener(listener: () => void) {
      listeners.add(listener);
    },
    removeListener(listener: () => void) {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;

  return {
    matchMedia: (() => media) as typeof globalThis.matchMedia,
    setMatches(next) {
      matches = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function installDomGlobals(
  dom: JSDOM,
  matchMedia: typeof globalThis.matchMedia,
): () => void {
  const window = dom.window;
  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    matchMedia,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of Object.keys(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  assert(globalThis.localStorage === window.localStorage);

  return () => {
    for (const [key, descriptor] of previous) {
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

function readSingleInlineScript(markup: string): string {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`);
  try {
    const scripts = dom.window.document.querySelectorAll("script");
    assertEquals(scripts.length, 1, "Expected exactly one inline script");
    const script = scripts.item(0);
    assertEquals(script.hasAttribute("src"), false, "Expected an inline script");
    return script.textContent ?? "";
  } finally {
    dom.window.close();
  }
}

describe("react/components/ui/color-mode", () => {
  it("escapes storage keys before embedding them in the inline color-mode script", () => {
    const storageKey = `vf";</script><script>alert(1)</script>//`;
    const markup = renderToString(
      <ColorModeScript defaultMode="dark" storageKey={storageKey} />,
    );
    const script = readSingleInlineScript(markup);

    assertEquals(script.includes(`</script><script>alert(1)</script>`), false);
    assertStringIncludes(script, `\\u003c/script\\u003e`);
    assertStringIncludes(script, `localStorage.getItem("vf\\";\\u003c/script`);
    assertStringIncludes(script, `m!=="light"&&m!=="dark"&&m!=="system"`);

    const themeAttributeScript = readSingleInlineScript(
      renderToString(<ColorModeScript defaultMode="dark" attribute="data-theme" />),
    );
    assertStringIncludes(
      themeAttributeScript,
      'd.setAttribute("data-theme",r)',
      "the pre-hydration script honours the data-theme variant",
    );
    assertEquals(
      themeAttributeScript.includes("classList"),
      false,
      "the data-theme variant never touches the class list",
    );
  });

  it("updates the html color-scheme inline style when toggling color mode", async () => {
    const dom = new JSDOM(
      '<!doctype html><html style="color-scheme: dark;"><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const media = createMutableMatchMedia(true);
    const restore = installDomGlobals(dom, media.matchMedia);
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
      assertEquals(
        localStorage.getItem(storageKey),
        "light",
        "toggling persists the explicit mode for the next load",
      );

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("applies the data-theme attribute variant instead of the class list", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const media = createMutableMatchMedia(false);
    const restore = installDomGlobals(dom, media.matchMedia);
    const storageKey = `vf-color-mode-attribute-${crypto.randomUUID()}`;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ColorModeProvider defaultMode="dark" attribute="data-theme" storageKey={storageKey}>
            <ToggleFixture />
          </ColorModeProvider>,
        );
      });

      await waitFor(() => document.documentElement.getAttribute("data-theme") === "dark");
      assert(
        !document.documentElement.classList.contains("dark"),
        "the data-theme variant does not also toggle classes",
      );
      assertEquals(document.documentElement.style.colorScheme, "dark");

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("updates system mode when the operating-system preference changes", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const media = createMutableMatchMedia(false);
    const restore = installDomGlobals(dom, media.matchMedia);
    const storageKey = `vf-color-mode-system-${crypto.randomUUID()}`;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ColorModeProvider defaultMode="system" storageKey={storageKey}>
            <ToggleFixture />
          </ColorModeProvider>,
        );
      });

      await waitFor(() => document.documentElement.classList.contains("light"));
      assertEquals(document.querySelector("button")?.getAttribute("data-mode"), "light");

      flushSync(() => media.setMatches(true));
      await waitFor(() => document.documentElement.classList.contains("dark"));
      assertEquals(document.querySelector("button")?.getAttribute("data-mode"), "dark");
      assertEquals(document.documentElement.style.colorScheme, "dark");

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("falls back to the default mode for an invalid persisted value", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const media = createMutableMatchMedia(true);
    const storageKey = `vf-color-mode-invalid-${crypto.randomUUID()}`;
    dom.window.localStorage.setItem(storageKey, "sepia");
    const restore = installDomGlobals(dom, media.matchMedia);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ColorModeProvider defaultMode="system" storageKey={storageKey}>
            <ToggleFixture />
          </ColorModeProvider>,
        );
      });

      await waitFor(() => document.querySelector("button")?.getAttribute("data-mode") === "dark");
      // The rendered mode and the colorScheme the provider writes to the root
      // element land in separate commits, so wait for the second one too.
      await waitFor(() => document.documentElement.style.colorScheme === "dark");

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("hydrates the server mode before reconciling persisted state", async () => {
    const storageKey = `vf-color-mode-hydration-${crypto.randomUUID()}`;
    const serverMarkup = renderToString(
      <ColorModeProvider defaultMode="system" storageKey={storageKey}>
        <ToggleFixture />
      </ColorModeProvider>,
    );
    assertStringIncludes(serverMarkup, 'data-mode="light"');

    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">${serverMarkup}</div></body></html>`,
      { url: "https://example.com/" },
    );
    dom.window.localStorage.setItem(storageKey, "dark");
    const media = createMutableMatchMedia(false);
    const restore = installDomGlobals(dom, media.matchMedia);
    const recoverableErrors: unknown[] = [];

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const root = hydrateRoot(
        rootElement,
        <ColorModeProvider defaultMode="system" storageKey={storageKey}>
          <ToggleFixture />
        </ColorModeProvider>,
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      );

      await waitFor(() => document.querySelector("button")?.getAttribute("data-mode") === "dark");
      assertEquals(recoverableErrors, []);

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });
});
