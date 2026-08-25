import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MessageActionBar } from "./message-actions.tsx";

function installDom(): { restore: () => void; window: JSDOM["window"] } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "Event",
    "MouseEvent",
  ] as const;
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = (globalThis as Record<string, unknown>)[key];
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

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for message action state");
    }
    await settle();
  }
}

describe("MessageActionBar", () => {
  it("renders every available default action", () => {
    const html = renderToString(
      <MessageActionBar
        content="Answer"
        onRegenerate={() => {}}
        onEdit={() => {}}
      />,
    );

    assertStringIncludes(html, "Copy to clipboard");
    assertStringIncludes(html, "Regenerate response");
    assertStringIncludes(html, "Edit message");
  });

  it("composes per-action icons and classes", () => {
    const html = renderToString(
      <MessageActionBar
        content="Answer"
        onRegenerate={() => {}}
        onEdit={() => {}}
      >
        <MessageActionBar.Edit
          icon={<span data-testid="custom-edit">edit</span>}
          className="vf-edit"
        />
        <MessageActionBar.Copy
          icon={<span data-testid="custom-copy">copy</span>}
          className="vf-copy"
        />
        <MessageActionBar.Regenerate
          icon={<span data-testid="custom-regenerate">retry</span>}
          className="vf-regenerate"
        />
      </MessageActionBar>,
    );

    assertStringIncludes(html, "custom-edit");
    assertStringIncludes(html, "vf-edit");
    assertStringIncludes(html, "custom-copy");
    assertStringIncludes(html, "vf-copy");
    assertStringIncludes(html, "custom-regenerate");
    assertStringIncludes(html, "vf-regenerate");
  });

  it("renders the composed copied-state leaf after copying", async () => {
    const dom = installDom();
    let root: Root | undefined;
    const writes: string[] = [];
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: (value: string) => Promise.resolve(writes.push(value)) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => true,
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <MessageActionBar content="Answer">
            <MessageActionBar.Copy icon={<span data-testid="custom-copy">copy</span>} />
            <MessageActionBar.Copied
              icon={<span data-testid="custom-copied">copied</span>}
              className="vf-copied"
            />
          </MessageActionBar>,
        );
      });

      const copy = rootElement.querySelector<HTMLButtonElement>(
        '[aria-label="Copy to clipboard"]',
      );
      assert(copy, "copy action renders");
      flushSync(() => copy.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
      await waitFor(() => rootElement.querySelector('[data-testid="custom-copied"]') !== null);

      assertEquals(writes, ["Answer"]);
      assert(rootElement.querySelector('[data-testid="custom-copied"]'));
      assertStringIncludes(rootElement.innerHTML, "vf-copied");

      flushSync(() => {
        createdRoot.render(
          <MessageActionBar content="Updated answer">
            <MessageActionBar.Copy icon={<span data-testid="custom-copy">copy</span>} />
            <MessageActionBar.Copied icon={<span data-testid="custom-copied">copied</span>} />
          </MessageActionBar>,
        );
      });
      assert(rootElement.querySelector('[data-testid="custom-copy"]'));
      assert(!rootElement.querySelector('[data-testid="custom-copied"]'));
    } finally {
      if (root) await unmountReactRoot(root);
      dom.restore();
    }
  });

  it("keeps the copy action available when every clipboard mechanism fails", async () => {
    const dom = installDom();
    let root: Root | undefined;
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <MessageActionBar content="Answer">
            <MessageActionBar.Copy icon={<span data-testid="custom-copy">copy</span>} />
            <MessageActionBar.Copied icon={<span data-testid="custom-copied">copied</span>} />
          </MessageActionBar>,
        );
      });

      const copy = rootElement.querySelector<HTMLButtonElement>(
        '[aria-label="Copy to clipboard"]',
      );
      assert(copy, "copy action renders");
      copy.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await waitFor(() => copy.getAttribute("aria-label") === "Unable to copy. Try again");

      assert(rootElement.querySelector('[data-testid="custom-copy"]'));
      assert(!rootElement.querySelector('[data-testid="custom-copied"]'));
      assertEquals(copy.getAttribute("aria-label"), "Unable to copy. Try again");
      assertEquals(
        rootElement.querySelector('[role="status"]')?.textContent,
        "Unable to copy to clipboard",
      );
      assertEquals(document.querySelectorAll("textarea").length, 0);
    } finally {
      if (root) await unmountReactRoot(root);
      dom.restore();
    }
  });

  it("lets an onCopy wrapper intercept the click and skip the built-in copy", async () => {
    const dom = installDom();
    let root: Root | undefined;
    const writes: string[] = [];
    let intercepted = 0;
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: (value: string) => Promise.resolve(writes.push(value)) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => true,
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <MessageActionBar
            content="Answer"
            onCopy={(_event, _next) => {
              intercepted += 1;
            }}
          />,
        );
      });

      const copy = rootElement.querySelector<HTMLButtonElement>(
        '[aria-label="Copy to clipboard"]',
      );
      assert(copy, "copy action renders");
      flushSync(() => copy.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
      await settle();

      assertEquals(intercepted, 1, "onCopy wrapper receives the click");
      assertEquals(writes, [], "built-in copy is skipped when next() is not called");
    } finally {
      if (root) await unmountReactRoot(root);
      dom.restore();
    }
  });

  it("passes the message content to onEdit when Edit is clicked", async () => {
    const dom = installDom();
    let root: Root | undefined;
    const edited: string[] = [];

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <MessageActionBar content="Answer" onEdit={(content) => edited.push(content)} />,
        );
      });

      const edit = rootElement.querySelector<HTMLButtonElement>('[aria-label="Edit message"]');
      assert(edit, "edit action renders");
      flushSync(() => edit.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));

      assertEquals(edited, ["Answer"], "Edit passes the message content to onEdit");
    } finally {
      if (root) await unmountReactRoot(root);
      dom.restore();
    }
  });

  it("exposes every compound action", () => {
    for (const part of ["Root", "Copy", "Copied", "Regenerate", "Edit"]) {
      assertEquals(
        typeof (MessageActionBar as unknown as Record<string, unknown>)[part],
        "function",
      );
    }
  });
});
