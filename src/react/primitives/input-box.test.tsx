import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type * as React from "react";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleInputBoxKeyDown, InputBox, SubmitButton } from "./input-box.tsx";

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
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
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

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for input primitive update");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createDom(): JSDOM {
  return new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://example.com/" },
  );
}

function createEnterEvent(
  options: { isComposing?: boolean } = {},
): React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement> {
  const event = {
    defaultPrevented: false,
    key: "Enter",
    keyCode: 0,
    nativeEvent: { isComposing: options.isComposing ?? false },
    preventDefault() {
      event.defaultPrevented = true;
    },
    shiftKey: false,
  };
  return event as unknown as React.KeyboardEvent<
    HTMLInputElement | HTMLTextAreaElement
  >;
}

describe("InputBox", () => {
  it("merges a callback ref while retaining the internal auto-resize ref", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const refValues: Array<HTMLInputElement | HTMLTextAreaElement | null> = [];
    let refCleanupCalls = 0;
    let root: ReturnType<typeof createRoot> | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      root = createRoot(rootElement);

      flushSync(() => {
        root?.render(
          <InputBox
            ref={(node) => {
              refValues.push(node);
              if (node instanceof HTMLTextAreaElement) {
                Object.defineProperty(node, "scrollHeight", {
                  configurable: true,
                  value: 120,
                });
                return () => {
                  refCleanupCalls += 1;
                };
              }
            }}
            value="hello"
            onChange={() => {}}
            multiline
          />,
        );
      });

      const textarea = document.querySelector("textarea");
      assert(textarea);
      await waitFor(() => textarea.style.height === "120px");
      assert(refValues.includes(textarea));

      if (root) await unmountReactRoot(root);
      root = undefined;
      assertEquals(refCleanupCalls, 1);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("chains the caller key handler but does not submit during IME composition", () => {
    let keyCalls = 0;
    let submitCalls = 0;

    const onKeyDown = () => {
      keyCalls += 1;
    };
    const onSubmit = () => {
      submitCalls += 1;
    };
    const composingEnter = createEnterEvent({ isComposing: true });
    handleInputBoxKeyDown(composingEnter, onKeyDown, onSubmit);
    assertEquals(keyCalls, 1);
    assertEquals(submitCalls, 0);
    assertEquals(composingEnter.defaultPrevented, false);

    const enter = createEnterEvent();
    handleInputBoxKeyDown(enter, onKeyDown, onSubmit);
    assertEquals(keyCalls, 2);
    assertEquals(submitCalls, 1);
    assertEquals(enter.defaultPrevented, true);
  });

  it("allows a caller key handler to deliberately cancel submission", () => {
    let keyCalls = 0;
    let submitCalls = 0;

    const enter = createEnterEvent();
    handleInputBoxKeyDown(
      enter,
      (event) => {
        keyCalls += 1;
        event.preventDefault();
      },
      () => {
        submitCalls += 1;
      },
    );
    assertEquals(keyCalls, 1);
    assertEquals(submitCalls, 0);
    assertEquals(enter.defaultPrevented, true);
  });
});

describe("SubmitButton", () => {
  it("chains stop callbacks while protecting button type and stop availability", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    let root: ReturnType<typeof createRoot> | undefined;
    let clickCalls = 0;
    let stopCalls = 0;
    let submitCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      root = createRoot(rootElement);
      flushSync(() => {
        root?.render(
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitCalls += 1;
            }}
          >
            <SubmitButton
              isLoading
              disabled
              type="submit"
              aria-label="Cancel generation"
              onClick={() => {
                clickCalls += 1;
              }}
              onStop={() => {
                stopCalls += 1;
              }}
            />
          </form>,
        );
      });

      const button = document.querySelector("button");
      assert(button);
      assertEquals(button.type, "button");
      assertEquals(button.disabled, false);
      assertEquals(button.getAttribute("aria-label"), "Cancel generation");
      assertEquals(button.dataset.state, "stop");

      flushSync(() =>
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      );
      assertEquals(clickCalls, 1);
      assertEquals(stopCalls, 1);
      assertEquals(submitCalls, 0);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("chains voice callbacks without allowing a submit type override", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    let root: ReturnType<typeof createRoot> | undefined;
    let clickCalls = 0;
    let voiceCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      root = createRoot(rootElement);
      flushSync(() => {
        root?.render(
          <SubmitButton
            type="submit"
            onClick={() => {
              clickCalls += 1;
            }}
            onVoice={() => {
              voiceCalls += 1;
            }}
          />,
        );
      });

      const button = document.querySelector("button");
      assert(button);
      assertEquals(button.type, "button");
      assertEquals(button.dataset.state, "voice");
      flushSync(() =>
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      );
      assertEquals(clickCalls, 1);
      assertEquals(voiceCalls, 1);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("allows the caller click handler to cancel a stop action deliberately", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    let root: ReturnType<typeof createRoot> | undefined;
    let clickCalls = 0;
    let stopCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      root = createRoot(rootElement);
      flushSync(() => {
        root?.render(
          <SubmitButton
            isLoading
            onClick={(event) => {
              clickCalls += 1;
              event.preventDefault();
            }}
            onStop={() => {
              stopCalls += 1;
            }}
          />,
        );
      });

      const button = document.querySelector("button");
      assert(button);
      flushSync(() =>
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      );
      assertEquals(clickCalls, 1);
      assertEquals(stopCalls, 0);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("keeps a disabled submit state inert", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    let root: ReturnType<typeof createRoot> | undefined;
    let clickCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      root = createRoot(rootElement);
      flushSync(() => {
        root?.render(
          <SubmitButton
            disabled
            onClick={() => {
              clickCalls += 1;
            }}
          />,
        );
      });

      const button = document.querySelector("button");
      assert(button);
      assertEquals(button.type, "submit");
      assertEquals(button.disabled, true);
      assertEquals(button.dataset.state, "submit");
      flushSync(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      assertEquals(clickCalls, 0);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });
});
