import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
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
  for (let index = 0; index < 2; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync(() => {});
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
    const writes: string[] = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
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
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
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
      await settle();

      assertEquals(writes, ["Answer"]);
      assert(rootElement.querySelector('[data-testid="custom-copied"]'));
      assertStringIncludes(rootElement.innerHTML, "vf-copied");

      flushSync(() => root.unmount());
    } finally {
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
