import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ListItem } from "./list.tsx";

function installDom(dom: JSDOM): () => void {
  const window = dom.window;
  const replacements: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const key of Object.keys(replacements)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

function createDom(): JSDOM {
  return new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://example.com/" },
  );
}

function keyboardEvent(
  type: "keydown" | "keyup",
  key: string,
  options: KeyboardEventInit = {},
): KeyboardEvent {
  return new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  });
}

describe("ListItem", () => {
  it("gives clickable rows an accessible button contract during SSR", () => {
    const markup = renderToString(
      <ListItem title="Conversation" active onClick={() => {}} />,
    );
    const dom = new JSDOM(markup);

    try {
      const item = dom.window.document.querySelector<HTMLElement>("[data-active]");
      assert(item);
      assertEquals(item.getAttribute("role"), "button");
      assertEquals(item.tabIndex, 0);
      assertEquals(item.getAttribute("data-active"), "true");
      assert(item.className.includes("focus-visible:ring-2"));
    } finally {
      dom.window.close();
    }
  });

  it("preserves explicit role and tab-index semantics", () => {
    const markup = renderToString(
      <ListItem
        title="Documentation"
        role="link"
        tabIndex={-1}
        onClick={() => {}}
      />,
    );
    const dom = new JSDOM(markup);

    try {
      const item = dom.window.document.querySelector<HTMLElement>('[role="link"]');
      assert(item);
      assertEquals(item.tabIndex, -1);
      assert(item.className.includes("cursor-pointer"));
    } finally {
      dom.window.close();
    }
  });

  it("activates on Enter and Space with native-button timing", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    let activations = 0;
    let keyDownCalls = 0;
    let keyUpCalls = 0;

    try {
      flushSync(() => {
        root.render(
          <ListItem
            title="Conversation"
            onClick={() => {
              activations += 1;
            }}
            onKeyDown={() => {
              keyDownCalls += 1;
            }}
            onKeyUp={() => {
              keyUpCalls += 1;
            }}
          />,
        );
      });
      const item = document.querySelector<HTMLElement>('[role="button"]');
      assert(item);

      const enter = keyboardEvent("keydown", "Enter");
      flushSync(() => item.dispatchEvent(enter));
      assertEquals(enter.defaultPrevented, true);
      assertEquals(activations, 1);

      const spaceDown = keyboardEvent("keydown", " ");
      flushSync(() => item.dispatchEvent(spaceDown));
      assertEquals(spaceDown.defaultPrevented, true);
      assertEquals(activations, 1);

      const spaceUp = keyboardEvent("keyup", " ");
      flushSync(() => item.dispatchEvent(spaceUp));
      assertEquals(spaceUp.defaultPrevented, true);
      assertEquals(activations, 2);
      assertEquals(keyDownCalls, 2);
      assertEquals(keyUpCalls, 1);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("lets caller handlers cancel synthesized activation", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    let activations = 0;

    try {
      flushSync(() => {
        root.render(
          <ListItem
            title="Conversation"
            onClick={() => {
              activations += 1;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onKeyUp={(event) => {
              if (event.key === " ") event.preventDefault();
            }}
          />,
        );
      });
      const item = document.querySelector<HTMLElement>('[role="button"]');
      assert(item);

      flushSync(() => item.dispatchEvent(keyboardEvent("keydown", "Enter")));
      flushSync(() => item.dispatchEvent(keyboardEvent("keydown", " ")));
      flushSync(() => item.dispatchEvent(keyboardEvent("keyup", " ")));
      assertEquals(activations, 0);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("renders primary and trailing actions as independently accessible controls", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const rootRef = React.createRef<HTMLDivElement>();
    const primaryActionRef = React.createRef<HTMLButtonElement>();
    let primaryActivations = 0;
    let actionActivations = 0;
    let legacyRowClicks = 0;
    let activationCurrentTarget: EventTarget | null = null;

    try {
      flushSync(() => {
        root.render(
          <ListItem
            ref={rootRef}
            primaryActionRef={primaryActionRef}
            title="Conversation"
            onClick={() => {
              legacyRowClicks += 1;
            }}
            onActivate={(event) => {
              activationCurrentTarget = event.currentTarget;
              primaryActivations += 1;
            }}
            primaryActionProps={{
              "aria-controls": "conversation",
              "aria-describedby": "conversation-description",
              "aria-expanded": true,
              "aria-label": "Open conversation",
            }}
            action={
              <button
                type="button"
                onClick={() => {
                  actionActivations += 1;
                }}
              >
                More
              </button>
            }
          />,
        );
      });
      const row = document.querySelector<HTMLElement>('[role="group"]');
      assert(row);
      assertEquals(rootRef.current, row);
      const [primaryAction, action] = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ];
      assert(primaryAction);
      assert(action);
      assertEquals(primaryActionRef.current, primaryAction);
      assertEquals(primaryAction.type, "button");
      assertEquals(primaryAction.getAttribute("aria-label"), "Open conversation");
      assertEquals(primaryAction.getAttribute("aria-describedby"), "conversation-description");
      assertEquals(primaryAction.getAttribute("aria-controls"), "conversation");
      assertEquals(primaryAction.getAttribute("aria-expanded"), "true");
      assert(!primaryAction.contains(action));

      flushSync(() => {
        primaryAction.focus();
        primaryAction.click();
        action.click();
      });
      assertEquals(document.activeElement, primaryAction);
      assertEquals(primaryActivations, 1);
      assertEquals(actionActivations, 1);
      assertEquals(legacyRowClicks, 0);
      assertEquals(activationCurrentTarget, primaryAction);
    } finally {
      await unmountReactRoot(root);
      assertEquals(primaryActionRef.current, null);
      restore();
    }
  });

  it("delegates the non-action row surface to its native primary action", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    let primaryActivations = 0;
    let actionActivations = 0;

    try {
      flushSync(() => {
        root.render(
          <ListItem
            title="Conversation"
            onActivate={() => {
              primaryActivations += 1;
            }}
            action={
              <button
                type="button"
                onClick={() => {
                  actionActivations += 1;
                }}
              >
                More
              </button>
            }
          />,
        );
      });
      const row = document.querySelector<HTMLElement>('[role="group"]');
      const action = document.querySelectorAll<HTMLButtonElement>("button")[1];
      assert(row);
      assert(action);

      flushSync(() => {
        row.click();
        action.click();
      });
      assertEquals(primaryActivations, 1);
      assertEquals(actionActivations, 1);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("does not fall through to legacy onClick after synchronous primary removal", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    let primaryActivations = 0;
    let legacyRowClicks = 0;

    function Harness(): React.ReactElement {
      const [visible, setVisible] = React.useState(true);
      if (!visible) return <div data-replacement="">Replacement</div>;
      return (
        <ListItem
          title="Conversation"
          onActivate={() => {
            primaryActivations += 1;
            flushSync(() => setVisible(false));
          }}
          onClick={() => {
            legacyRowClicks += 1;
          }}
        />
      );
    }

    try {
      flushSync(() => root.render(<Harness />));
      const primaryAction = document.querySelector<HTMLButtonElement>("button");
      assert(primaryAction);

      flushSync(() => primaryAction.click());
      assert(document.querySelector("[data-replacement]"));
      assertEquals(primaryActivations, 1);
      assertEquals(legacyRowClicks, 0);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("retains primary-action provenance without Event.composedPath", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const composedPathDescriptor = Object.getOwnPropertyDescriptor(
      dom.window.Event.prototype,
      "composedPath",
    );
    Object.defineProperty(dom.window.Event.prototype, "composedPath", {
      configurable: true,
      value: undefined,
    });
    const root = createRoot(document.getElementById("root")!);
    let primaryActivations = 0;
    let legacyRowClicks = 0;

    try {
      flushSync(() => {
        root.render(
          <ListItem
            title="Conversation"
            onActivate={() => {
              primaryActivations += 1;
            }}
            onClick={() => {
              legacyRowClicks += 1;
            }}
          />,
        );
      });
      const primaryLabel = document.querySelector<HTMLSpanElement>("button span");
      assert(primaryLabel);

      flushSync(() => primaryLabel.click());
      assertEquals(primaryActivations, 1);
      assertEquals(legacyRowClicks, 0);
    } finally {
      await unmountReactRoot(root);
      if (composedPathDescriptor) {
        Object.defineProperty(
          dom.window.Event.prototype,
          "composedPath",
          composedPathDescriptor,
        );
      } else {
        delete (dom.window.Event.prototype as unknown as Record<string, unknown>)
          .composedPath;
      }
      restore();
    }
  });

  it("preserves React 19 callback-ref cleanup for the primary action", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    let root: ReturnType<typeof createRoot> | undefined;
    let primaryAction: HTMLButtonElement | null = null;
    let cleanupCalls = 0;
    let nullCalls = 0;

    try {
      root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root?.render(
          <ListItem
            title="Conversation"
            onActivate={() => {}}
            primaryActionRef={(node) => {
              if (node) {
                primaryAction = node;
                return () => {
                  primaryAction = null;
                  cleanupCalls += 1;
                };
              }
              nullCalls += 1;
            }}
          />,
        );
      });
      const renderedPrimaryAction = document.querySelector("button");
      assert(renderedPrimaryAction);
      assertEquals(primaryAction, renderedPrimaryAction);

      await unmountReactRoot(root);
      root = undefined;
      assertEquals(primaryAction, null);
      assertEquals(cleanupCalls, 1);
      assertEquals(nullCalls, 0);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("does not invent invalid button semantics for the legacy onClick-plus-action API", () => {
    const markup = renderToString(
      <ListItem
        data-row="legacy"
        title="Conversation"
        onClick={() => {}}
        action={<button type="button">More</button>}
      />,
    );
    const dom = new JSDOM(markup);

    try {
      const row = dom.window.document.querySelector<HTMLElement>("[data-row='legacy']");
      const action = dom.window.document.querySelector("button");
      assert(row);
      assert(action);
      assertEquals(row.getAttribute("role"), null);
      assertEquals(row.getAttribute("tabindex"), null);
      assertEquals(action.closest('[role="button"]'), null);
    } finally {
      dom.window.close();
    }
  });

  it("cancels a pending Space activation when focus leaves the row", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    let activations = 0;

    try {
      flushSync(() => {
        root.render(
          <ListItem
            title="Conversation"
            onClick={() => {
              activations += 1;
            }}
          />,
        );
      });
      const item = document.querySelector<HTMLElement>('[role="button"]');
      assert(item);

      item.focus();
      flushSync(() => item.dispatchEvent(keyboardEvent("keydown", " ")));
      item.blur();
      flushSync(() => item.dispatchEvent(keyboardEvent("keyup", " ")));
      assertEquals(activations, 0);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("does not re-arm Space when the caller moves focus during keydown", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    let activations = 0;

    try {
      flushSync(() => {
        root.render(
          <ListItem
            title="Conversation"
            onClick={() => {
              activations += 1;
            }}
            onKeyDown={(event) => {
              if (event.key === " ") event.currentTarget.blur();
            }}
          />,
        );
      });
      const item = document.querySelector<HTMLElement>('[role="button"]');
      assert(item);

      item.focus();
      flushSync(() => item.dispatchEvent(keyboardEvent("keydown", " ")));
      flushSync(() => item.dispatchEvent(keyboardEvent("keyup", " ")));
      assertEquals(activations, 0);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("does not synthesize activation while an IME composition is active", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    let activations = 0;

    try {
      flushSync(() => {
        root.render(
          <ListItem
            title="Conversation"
            onClick={() => {
              activations += 1;
            }}
          />,
        );
      });
      const item = document.querySelector<HTMLElement>('[role="button"]');
      assert(item);

      const composingEnter = keyboardEvent("keydown", "Enter", {
        isComposing: true,
      });
      flushSync(() => item.dispatchEvent(composingEnter));
      assertEquals(composingEnter.defaultPrevented, false);
      assertEquals(activations, 0);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("forwards refs without replacing structural active state", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    const itemRef = React.createRef<HTMLDivElement>();

    try {
      flushSync(() => {
        root.render(
          <ListItem
            ref={itemRef}
            title="Conversation"
            active
            data-active="caller"
          />,
        );
      });
      assert(itemRef.current);
      assertEquals(itemRef.current.getAttribute("data-active"), "true");

      flushSync(() => {
        root.render(
          <ListItem
            ref={itemRef}
            title="Conversation"
            data-active="caller"
          />,
        );
      });
      assertEquals(itemRef.current.getAttribute("data-active"), null);
    } finally {
      await unmountReactRoot(root);
      assertEquals(itemRef.current, null);
      restore();
    }
  });
});
