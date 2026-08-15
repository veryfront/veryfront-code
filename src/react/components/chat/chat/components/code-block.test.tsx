import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { RichCodeBlock } from "./code-block.tsx";

function installDom(): { restore: () => void; window: JSDOM["window"] } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const window = dom.window;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    self: globalThis.self,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    Event: globalThis.Event,
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
    Event: window.Event,
    MouseEvent: window.MouseEvent,
  });

  return {
    window,
    restore: () => {
      Object.assign(globalThis, previous);
      dom.window.close();
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

/**
 * Poll for a state transition instead of assuming `settle()` covered it.
 *
 * A copy result travels through a promise chain and then a React commit, and a
 * single macrotask does not always cover both under load.
 */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for code block state");
    }
    await settle();
  }
}

describe("RichCodeBlock — inline mode", () => {
  it("renders an inline <code> element with no language label or copy button", () => {
    const html = renderToString(<RichCodeBlock code="const x = 1;" inline />);
    assertStringIncludes(html, "<code");
    assertStringIncludes(html, "const x = 1;");
    assert(!html.includes("Copy"), "inline code should not render the copy control");
  });

  it("restyles: className merges onto the inline <code> element", () => {
    const html = renderToString(<RichCodeBlock code="1" inline className="vf-inline" />);
    assertStringIncludes(html, "vf-inline");
  });
});

describe("RichCodeBlock — block mode", () => {
  it("renders the language label and code body when a language is given", () => {
    const html = renderToString(<RichCodeBlock code="const x = 1;" language="ts" />);
    assertStringIncludes(html, "ts");
    assertStringIncludes(html, "const x = 1;");
    assertStringIncludes(html, "language-ts");
  });

  it('falls back to the "text" language label when none is given', () => {
    const html = renderToString(<RichCodeBlock code="plain" />);
    assertStringIncludes(html, ">text<");
  });

  it("renders the un-copied Copy control by default (no clipboard interaction at SSR time)", () => {
    const html = renderToString(<RichCodeBlock code="const x = 1;" language="ts" />);
    assertStringIncludes(html, "Copy");
    assert(!html.includes(">Copied<"), "should not start in the copied state");
  });

  it("restyles: className merges onto the block wrapper", () => {
    const html = renderToString(
      <RichCodeBlock code="const x = 1;" language="ts" className="vf-custom-block" />,
    );
    assertStringIncludes(html, "vf-custom-block");
  });

  it("reports failed copies without leaking the fallback textarea", async () => {
    const dom = installDom();
    let root: Root | undefined;
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    let fallbackCalls = 0;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        fallbackCalls += 1;
        return false;
      },
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const mountedRoot = createRoot(rootElement);
      root = mountedRoot;
      flushSync(() => mountedRoot.render(<RichCodeBlock code="not copied" />));

      const button = rootElement.querySelector("button");
      assert(button, "copy control renders");
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await waitFor(() => button.textContent?.trim() === "Copy failed");

      assertEquals(fallbackCalls, 1);
      assertEquals(button.textContent?.trim(), "Copy failed");
      assertEquals(button.getAttribute("aria-label"), "Copy failed");
      assertEquals(
        rootElement.querySelector('[role="status"]')?.textContent,
        "Unable to copy code",
      );
      assertEquals(document.querySelectorAll("textarea").length, 0);
    } finally {
      await unmountReactRoot(root);
      dom.restore();
    }
  });

  it("does not show stale success after the displayed code changes", async () => {
    const dom = installDom();
    let root: Root | undefined;
    const pending: Array<() => void> = [];
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            pending.push(resolve);
          }),
      },
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const mountedRoot = createRoot(rootElement);
      root = mountedRoot;
      flushSync(() => mountedRoot.render(<RichCodeBlock code="old code" />));

      const firstButton = rootElement.querySelector("button");
      assert(firstButton, "first copy control renders");
      firstButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

      flushSync(() => mountedRoot.render(<RichCodeBlock code="new code" />));
      const secondButton = rootElement.querySelector("button");
      assert(secondButton, "updated copy control renders");
      secondButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      assertEquals(pending.length, 2);

      pending[1]?.();
      await waitFor(() => secondButton.textContent?.trim() === "Copied");

      pending[0]?.();
      await settle();
      assertEquals(secondButton.textContent?.trim(), "Copied");
      assertStringIncludes(rootElement.textContent ?? "", "new code");
      assert(!(rootElement.textContent ?? "").includes("old code"));
    } finally {
      await unmountReactRoot(root);
      dom.restore();
    }
  });
});
