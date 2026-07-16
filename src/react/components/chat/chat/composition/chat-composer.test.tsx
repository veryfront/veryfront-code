import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ChatInput } from "./chat-composer.tsx";

function installDomGlobals(dom: JSDOM): () => void {
  const window = dom.window;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    self: globalThis.self,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    KeyboardEvent: globalThis.KeyboardEvent,
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
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
  });

  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

describe("react/components/chat/chat/composition/chat-composer", () => {
  it("labels the multiline message input for assistive technology", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ChatInput
            input=""
            onChange={() => {}}
            placeholder="Ask Veryfront"
          />,
        );
      });

      const textarea = document.querySelector("textarea");
      assert(textarea, "Expected multiline composer input to render");
      assertEquals(textarea.getAttribute("aria-label"), "Ask Veryfront");
      root.unmount();
    } finally {
      restore();
    }
  });

  it("opens upload and select document actions from the attachment button", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let selectCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ChatInput
            input=""
            onChange={() => {}}
            onAttach={() => {}}
            onSelectAttachment={() => {
              selectCalls += 1;
            }}
          />,
        );
      });

      const attachButton = document.querySelector(
        'button[aria-label="Add document"]',
      );
      assert(attachButton, "Expected attachment button to exist");

      flushSync(() => {
        attachButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const uploadAction = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Attach files to chat",
      );
      const selectAction = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Select document",
      );
      const menu = document.querySelector('[role="menu"]');
      assert(uploadAction, "Expected upload action to render");
      assert(selectAction, "Expected select action to render");
      // The menu is now the portalled DropdownMenu primitive (escapes the
      // composer overflow) — it renders under <body>, not inline.
      assert(menu, "Expected attachment menu to render");
      assertEquals(menu.parentElement, document.body);

      flushSync(() => {
        selectAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      assertEquals(selectCalls, 1);
      root.unmount();
    } finally {
      restore();
    }
  });

  it("submits multiline input on Enter and keeps Shift+Enter for newlines", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let submitCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ChatInput
            input="Review Article 30"
            onChange={() => {}}
            onSubmit={() => {
              submitCalls += 1;
            }}
          />,
        );
      });

      const textarea = document.querySelector("textarea");
      assert(textarea, "Expected multiline composer input to render");
      const reactPropsKey = Object.keys(textarea).find((key) => key.startsWith("__reactProps$"));
      assert(reactPropsKey, "Expected React props to be attached");
      const reactProps = (textarea as unknown as Record<string, unknown>)[
        reactPropsKey
      ] as {
        onKeyDown?: (
          event: {
            key: string;
            shiftKey?: boolean;
            preventDefault: () => void;
          },
        ) => void;
      };
      assert(reactProps.onKeyDown, "Expected input keydown handler to exist");
      let preventDefaultCalls = 0;

      reactProps.onKeyDown({
        key: "Enter",
        shiftKey: true,
        preventDefault: () => {
          preventDefaultCalls += 1;
        },
      });
      assertEquals(submitCalls, 0);
      assertEquals(preventDefaultCalls, 0);

      reactProps.onKeyDown({
        key: "Enter",
        preventDefault: () => {
          preventDefaultCalls += 1;
        },
      });

      assertEquals(submitCalls, 1);
      assertEquals(preventDefaultCalls, 1);
      root.unmount();
    } finally {
      restore();
    }
  });

  it("enables send for a resolved attachment without text", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let submitCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ChatInput
            input=""
            onChange={() => {}}
            onSubmit={() => {
              submitCalls += 1;
            }}
            attachments={[{
              id: "file-1",
              name: "brief.pdf",
              state: "uploaded",
              type: "application/pdf",
              url: "https://example.com/brief.pdf",
            }]}
          />,
        );
      });

      const submitButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Send"]',
      );
      assert(submitButton, "Expected submit button to render for attachment-only input");
      assertEquals(submitButton.disabled, false, "resolved attachments should be submittable");

      flushSync(() => {
        submitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      assertEquals(submitCalls, 1, "attachment-only send should submit");
      root.unmount();
    } finally {
      restore();
    }
  });

  it("composer owns submit: folds resolved attachments, clears, and guards uploads", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    // deno-lint-ignore no-explicit-any
    const sent: any[] = [];
    let cleared = 0;
    let inputSetTo: string | null = null;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);

      const render = (state: "uploaded" | "uploading") =>
        flushSync(() => {
          root.render(
            <ChatInput.Root
              input="Ship it"
              onChange={() => {}}
              sendMessage={(m) => sent.push(m)}
              setInput={(v) => (inputSetTo = v)}
              onClearAttachments={() => (cleared += 1)}
              attachments={[{
                id: "file-1",
                name: "brief.pdf",
                state,
                type: "application/pdf",
                ...(state === "uploaded" ? { url: "https://example.com/brief.pdf" } : {}),
              }]}
            >
              <ChatInput.Field />
              <ChatInput.Send />
            </ChatInput.Root>,
          );
        });

      // A still-uploading attachment must block send entirely.
      render("uploading");
      const pendingBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      assert(pendingBtn, "send renders");
      flushSync(() => pendingBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      assertEquals(sent.length, 0, "must not send while an upload is in flight");

      // Once resolved, one click sends { text, files } and clears.
      render("uploaded");
      const readyBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      assert(readyBtn, "send renders");
      flushSync(() => readyBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      assertEquals(sent.length, 1, "resolved send fires once");
      assertEquals(sent[0].text, "Ship it");
      assertEquals(sent[0].files?.[0]?.url, "https://example.com/brief.pdf");
      assertEquals(inputSetTo, "", "clears the input after send");
      assertEquals(cleared, 1, "clears attachments after send");

      root.unmount();
    } finally {
      restore();
    }
  });

  it("uses the copied Studio prompt shell and non-scaling primary submit button", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ChatInput
            input="Hej"
            onChange={() => {}}
            onSubmit={() => {}}
          />,
        );
      });

      const composer = document.querySelector("form > div");
      // The submit control is now the shared `Button` primitive (icon-primary),
      // labelled "Send" — no more bespoke `data-submit-button` element.
      const submitButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Send"]',
      );
      assert(composer, "Expected composer shell to render");
      assert(submitButton, "Expected submit button to render");

      assert(
        (composer as HTMLElement).className.includes(
          "rounded-[var(--radius-lg)]",
        ),
      );
      assert(
        (composer as HTMLElement).className.includes("bg-[var(--secondary)]"),
      );
      assertEquals(
        (composer as HTMLElement).className.includes("focus-within:border"),
        false,
      );
      // Studio's submit button does not scale on press.
      assertEquals(submitButton.className.includes("active:scale"), false);
      root.unmount();
    } finally {
      restore();
    }
  });

  it("Send accepts a per-leaf `icon` override", () => {
    const html = renderToString(
      <ChatInput.Root input="hi" onChange={() => {}} onSubmit={() => {}}>
        <ChatInput.Send icon={<svg data-testid="custom-send" />} />
      </ChatInput.Root>,
    );
    assert(html.includes("custom-send"), "Expected the custom send icon to render");
  });

  describe("ChatInput.Submit", () => {
    it("renders the send control (with its icon) while idle", () => {
      const html = renderToString(
        <ChatInput.Root input="hi" onChange={() => {}} onSubmit={() => {}}>
          <ChatInput.Submit icon={<svg data-testid="mail-icon" />} />
        </ChatInput.Root>,
      );
      assert(html.includes('aria-label="Send"'), "idle submit is the Send control");
      assert(html.includes("mail-icon"), "idle submit uses the `icon` override");
      assert(!html.includes('aria-label="Stop"'), "idle submit is not the Stop control");
    });

    it("renders the stop control while streaming, ignoring the send icon", () => {
      const html = renderToString(
        <ChatInput.Root
          input="hi"
          onChange={() => {}}
          onSubmit={() => {}}
          isLoading
          stop={() => {}}
        >
          <ChatInput.Submit icon={<svg data-testid="mail-icon" />} />
        </ChatInput.Root>,
      );
      assert(html.includes('aria-label="Stop"'), "streaming submit is the Stop control");
      assert(!html.includes("mail-icon"), "the send icon must not leak onto Stop");
    });
  });

  describe("ChatInput.Toolbar", () => {
    it("is a function component", () => {
      assertEquals(typeof ChatInput.Toolbar, "function");
    });

    it("renders its children and merges the className as a layout slot", () => {
      const html = renderToString(
        <ChatInput.Toolbar className="vf-tb">
          <button type="button">x</button>
        </ChatInput.Toolbar>,
      );
      assert(html.includes("vf-tb"), "Expected the toolbar className to render");
      assert(html.includes(">x</button>"), "Expected the child to render");
      assert(html.includes('role="toolbar"'), "Expected the toolbar role to render");
    });
  });

  describe("ChatInput.Export", () => {
    it("renders by presence when the supplied conversation is non-empty", () => {
      const html = renderToString(
        <ChatInput.Root input="" onChange={() => {}}>
          <ChatInput.Toolbar>
            <ChatInput.Export
              messages={[{
                id: "message-1",
                role: "user",
                parts: [{ type: "text", text: "Hello" }],
              }]}
            />
          </ChatInput.Toolbar>
        </ChatInput.Root>,
      );
      assert(
        html.includes('aria-label="Export conversation"'),
        "Expected the composed export action to render",
      );
    });

    it("renders nothing for an empty conversation", () => {
      const html = renderToString(<ChatInput.Export messages={[]} />);
      assertEquals(html, "");
    });
  });
});
