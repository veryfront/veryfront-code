/**
 * ChatActions — render-or-compose contract.
 *
 * `ChatActions` is a self-contained `+` menu whose surface (`Content` / `Item`)
 * portals through `Floating` (`createPortal` + `document`), which is unavailable
 * under `renderToString`. So SSR renders only the always-present trigger button;
 * the portalled rows are exercised for wiring + className merge but their DOM
 * lands in the (absent) portal, so we assert on what SSR can see (the trigger)
 * and prove the sub-parts + hook contract structurally.
 */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  createElement,
  forwardRef,
  type ReactElement,
  useState,
} from "react";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { type ComponentDomOptions, installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { ChatActions, useChatActions } from "./chat-actions.tsx";

const DOM_OPTIONS: ComponentDomOptions = {
  windowGlobals: ["self", "HTMLButtonElement", "KeyboardEvent"],
};

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function unmount(root: Root): Promise<void> {
  flushSync(() => root.unmount());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function keydown(
  window: JSDOM["window"],
  target: EventTarget,
  key: string,
): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  target.dispatchEvent(event);
  return event;
}

describe("ChatActions — render-or-compose", () => {
  it("preset (no children) renders the default `+` trigger button", () => {
    const html = renderToString(
      <ChatActions
        onAttachFiles={() => {}}
        actions={[{ label: "Add from URL", onSelect: () => {} }]}
      />,
    );
    // Default trigger button is present with its aria-label.
    assertStringIncludes(html, "Add attachments and settings");
  });

  it("preset renders the attach row and data-driven actions and wires their handlers", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);
    let attachCalls = 0;
    let addUrlCalls = 0;

    try {
      flushSync(() =>
        root.render(
          <div data-vf-chat="">
            <ChatActions
              defaultOpen
              onAttachFiles={() => attachCalls += 1}
              actions={[{ label: "Add from URL", onSelect: () => addUrlCalls += 1 }]}
            />
          </div>,
        )
      );
      await waitFor(
        () => document.querySelectorAll('[role="menu"]').length === 1,
        "actions menu did not portal",
      );
      const labels = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .map((el) => el.textContent);
      assertEquals(
        labels.slice(0, 2),
        ["Attach Files or Photos", "Add from URL"],
        "preset renders attach row before data-driven actions",
      );

      const select = (label: string) => {
        const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find((el) => el.textContent === label);
        assert(item, `menu item ${label} is missing`);
        flushSync(() => {
          item.dispatchEvent(
            new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
          );
          item.click();
        });
      };
      select("Attach Files or Photos");
      assertEquals(attachCalls, 1, "attach row invokes onAttachFiles");
      await waitFor(
        () => document.querySelectorAll('[role="menu"]').length === 0,
        "selecting a row did not close the menu",
      );
      flushSync(() => {
        document.querySelector<HTMLElement>('[aria-label="Add attachments and settings"]')!
          .click();
      });
      await waitFor(
        () => document.querySelectorAll('[role="menu"]').length === 1,
        "actions menu did not reopen",
      );
      select("Add from URL");
      assertEquals(addUrlCalls, 1, "action row invokes its onSelect");
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("recompose: a custom Trigger renders in place of the default", () => {
    const html = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger className="vf-custom-trigger">
          <button type="button" className="consumer-trigger">custom-trigger</button>
        </ChatActions.Trigger>
        <ChatActions.Content>
          <ChatActions.Item onSelect={() => {}}>Row</ChatActions.Item>
        </ChatActions.Content>
      </ChatActions.Root>,
    );
    // The composed trigger renders; the default `+` button does not.
    assertStringIncludes(html, "custom-trigger");
    assertStringIncludes(html, "vf-custom-trigger");
    assertStringIncludes(html, "consumer-trigger");
    assert(
      !html.includes("Add attachments and settings"),
      "custom Trigger must replace the default `+` button",
    );
  });

  it("defaults only native button triggers and leaves opaque semantics to the child", () => {
    const OpaqueAnchor = forwardRef<
      HTMLAnchorElement,
      AnchorHTMLAttributes<HTMLAnchorElement>
    >((props, ref) => <a {...props} ref={ref} />);
    const OpaqueButton = forwardRef<
      HTMLButtonElement,
      ButtonHTMLAttributes<HTMLButtonElement>
    >((props, ref) => <button {...props} ref={ref} />);

    const intrinsicButton = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger>
          {createElement("button", null, "intrinsic")}
        </ChatActions.Trigger>
        <ChatActions.Content />
      </ChatActions.Root>,
    );
    const opaqueButton = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger>
          <OpaqueButton>opaque</OpaqueButton>
        </ChatActions.Trigger>
        <ChatActions.Content />
      </ChatActions.Root>,
    );
    const ownedOpaqueButton = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger>
          <OpaqueButton type="button">owned opaque</OpaqueButton>
        </ChatActions.Trigger>
        <ChatActions.Content />
      </ChatActions.Root>,
    );
    const anchor = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger>
          <a href="#actions">anchor</a>
        </ChatActions.Trigger>
        <ChatActions.Content />
      </ChatActions.Root>,
    );
    const opaqueAnchor = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger>
          <OpaqueAnchor href="#actions">opaque anchor</OpaqueAnchor>
        </ChatActions.Trigger>
        <ChatActions.Content />
      </ChatActions.Root>,
    );

    assertStringIncludes(intrinsicButton, 'type="button"');
    assert(!/<button\b[^>]*\btype=/.test(opaqueButton));
    assertStringIncludes(ownedOpaqueButton, 'type="button"');
    assert(!/<a\b[^>]*\btype=/.test(anchor), "anchor triggers must not receive button type");
    assert(
      !/<a\b[^>]*\btype=/.test(opaqueAnchor),
      "opaque anchor triggers must not receive button type",
    );
  });

  it("keeps a custom button trigger from submitting its containing form", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const root = createRoot(document.getElementById("root")!);
    let submissions = 0;

    try {
      flushSync(() => {
        root.render(
          <form onSubmit={() => submissions += 1}>
            <ChatActions.Root>
              <ChatActions.Trigger>
                {createElement("button", null, "Open actions")}
              </ChatActions.Trigger>
              <ChatActions.Content />
            </ChatActions.Root>
          </form>,
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>("button");
      assert(trigger);
      trigger.click();

      assertEquals(trigger.type, "button");
      assertEquals(submissions, 0);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("Trigger className merges onto the default `+` button", () => {
    const html = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger className="vf-trigger-x" />
        <ChatActions.Content />
      </ChatActions.Root>,
    );
    // `shrink-0` (default) and the merged class both survive.
    assertStringIncludes(html, "vf-trigger-x");
    assertStringIncludes(html, "shrink-0");
  });

  it("exposes every documented sub-part off the compound namespace", () => {
    for (const part of ["Root", "Trigger", "Content", "Item", "Preset"]) {
      assert(
        typeof (ChatActions as unknown as Record<string, unknown>)[part] ===
          "function",
        `ChatActions.${part} is missing`,
      );
    }
  });

  it("useChatActions throws outside a ChatActions provider", () => {
    function Orphan() {
      useChatActions();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "useChatActions must throw outside a ChatActions");
  });

  it("keeps settings open while toggling and owns submenu keyboard navigation", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://example.com/" },
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);

    function StatefulActions(): ReactElement {
      const [autoSubmit, setAutoSubmit] = useState(false);
      const [autoFixErrors, setAutoFixErrors] = useState(false);
      return (
        <div data-vf-chat="">
          <ChatActions
            defaultOpen
            settings={{
              autoSubmit,
              autoFixErrors,
              onAutoSubmitChange: setAutoSubmit,
              onAutoFixErrorsChange: setAutoFixErrors,
            }}
          />
        </div>
      );
    }

    try {
      flushSync(() => root.render(<StatefulActions />));
      await waitFor(
        () => document.querySelectorAll('[role="menu"]').length === 1,
        "top-level actions menu did not portal",
      );
      const trigger = document.querySelector<HTMLElement>(
        '[role="menuitem"][aria-haspopup="menu"]',
      );
      assert(trigger);

      const openEvent = keydown(dom.window, trigger, "ArrowRight");
      assertEquals(openEvent.defaultPrevented, true);
      await waitFor(
        () => document.querySelectorAll('[role="menu"]').length === 2,
        "settings submenu did not open",
      );
      const items = [...document.querySelectorAll<HTMLElement>(
        '[role="menuitemcheckbox"]',
      )];
      assertEquals(items.length, 2);
      await waitFor(
        () => document.activeElement === items[0],
        "settings submenu did not focus its first item",
      );

      flushSync(() => {
        items[0]!.dispatchEvent(
          new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        items[0]!.click();
      });
      assertEquals(items[0]!.getAttribute("aria-checked"), "true");
      assertEquals(document.querySelectorAll('[role="menu"]').length, 2);

      keydown(dom.window, items[0]!, "ArrowDown");
      assertEquals(document.activeElement, items[1]);
      const closeEvent = keydown(dom.window, items[1]!, "Escape");
      assertEquals(closeEvent.defaultPrevented, true);
      await waitFor(
        () => document.querySelectorAll('[role="menu"]').length === 1,
        "Escape did not close only the settings submenu",
      );
      assertEquals(document.activeElement, trigger);
      assertEquals(
        document.querySelector('[aria-label="Add attachments and settings"]')
          ?.getAttribute("aria-expanded"),
        "true",
      );
    } finally {
      await unmount(root);
      restore();
    }
  });
});
