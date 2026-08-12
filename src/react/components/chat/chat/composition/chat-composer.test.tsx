import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  createElement,
  createRef,
  type FormEvent,
  forwardRef,
  type ReactElement,
} from "react";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ChatInput } from "./chat-composer.tsx";
import { useChatInputContext } from "../contexts/composer-context.tsx";
import { useChatInput } from "../hooks/use-chat-input.ts";

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
  it("threads setInput through the default composer and fails fast when omitted", () => {
    let contextSetInput: ((value: string) => void) | undefined;
    let inputSetTo: string | undefined;
    function Capture(): null {
      contextSetInput = useChatInputContext().setInput;
      return null;
    }

    renderToString(
      <ChatInput input="" onChange={() => {}} setInput={(value) => inputSetTo = value}>
        <Capture />
      </ChatInput>,
    );
    contextSetInput?.("next");
    assertEquals(inputSetTo, "next", "default composer exposes the real controlled setter");

    renderToString(
      <ChatInput input="" onChange={() => {}}>
        <Capture />
      </ChatInput>,
    );
    let error: unknown;
    try {
      contextSetInput?.("missing");
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error);
    assert(error.message.includes("setInput was not provided"));
  });

  it("preserves composer-owned sends when the legacy setter is omitted", () => {
    let submit: ((e?: FormEvent) => void) | undefined;
    let sends = 0;
    function Capture(): null {
      submit = useChatInputContext().onSubmit;
      return null;
    }

    const legacyOwnedSubmit = {
      input: "ready",
      onChange: () => {},
      sendMessage: () => sends += 1,
    };
    renderToString(
      <ChatInput.Root {...legacyOwnedSubmit}>
        <Capture />
      </ChatInput.Root>,
    );

    submit?.();

    assertEquals(sends, 1, "the additive API must not break a legacy owned submit");
  });

  it("leaves legacy controlled submit policy with the caller", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let submits = 0;
    let defaultPrevented: boolean | undefined;
    let root: Root | undefined;
    function Capture(): ReactElement {
      const submit = useChatInputContext().onSubmit;
      return <form onSubmit={(event) => submit(event)} data-submit-probe />;
    }

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <ChatInput.Root
            input=""
            onChange={() => {}}
            onSubmit={(event) => {
              submits += 1;
              defaultPrevented = event?.defaultPrevented;
            }}
            isLoading
          >
            <Capture />
          </ChatInput.Root>,
        );
      });
      const form = document.querySelector<HTMLFormElement>("[data-submit-probe]");
      assert(form, "Expected submit probe to render");
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

      assertEquals(submits, 1, "controlled submit remains caller-owned");
      assertEquals(defaultPrevented, false, "controlled submit receives the event unchanged");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("prevents native submission from the default controlled composer form", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let submits = 0;
    let observedDefaultPrevented: boolean | undefined;
    let root: ReturnType<typeof createRoot> | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <ChatInput
            input="ready"
            onChange={() => {}}
            onSubmit={(event) => {
              submits += 1;
              observedDefaultPrevented = event?.defaultPrevented;
            }}
          />,
        );
      });

      const form = document.querySelector<HTMLFormElement>("form");
      assert(form, "Expected the default ChatInput form to render");
      const submitEvent = new dom.window.Event("submit", {
        bubbles: true,
        cancelable: true,
      });
      const dispatchResult = form.dispatchEvent(submitEvent);

      assertEquals(submits, 1);
      assertEquals(observedDefaultPrevented, true);
      assertEquals(submitEvent.defaultPrevented, true);
      assertEquals(dispatchResult, false, "cancelled native submission must report false");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("preserves legacy mixed submit props and gives sendMessage precedence", () => {
    let submit: ((e?: FormEvent) => void) | undefined;
    let explicitSubmits = 0;
    let sends = 0;
    let inputSetTo: string | undefined;
    function Capture(): null {
      submit = useChatInputContext().onSubmit;
      return null;
    }

    renderToString(
      <ChatInput.Root
        input="ready"
        onChange={() => {}}
        onSubmit={() => explicitSubmits += 1}
        sendMessage={() => sends += 1}
        setInput={(value) => inputSetTo = value}
      >
        <Capture />
      </ChatInput.Root>,
    );
    submit?.();

    assertEquals(sends, 1, "legacy mixed mode keeps composer-owned submission");
    assertEquals(explicitSubmits, 0, "sendMessage retains precedence over onSubmit");
    assertEquals(inputSetTo, "", "composer-owned submission still clears input");
  });

  it("disables submit while loading or while any attachment is pending", () => {
    const loading = renderToString(
      <ChatInput.Root input="ready" onChange={() => {}} onSubmit={() => {}} isLoading>
        <ChatInput.Send />
      </ChatInput.Root>,
    );
    assert(!loading.includes('aria-label="Send"'), "streaming hides the send control");

    const pending = renderToString(
      <ChatInput.Root
        input="ready"
        onChange={() => {}}
        onSubmit={() => {}}
        attachments={[
          { id: "done", name: "done.txt", state: "uploaded", url: "/done.txt" },
          { id: "pending", name: "pending.txt", state: "uploading" },
        ]}
      >
        <ChatInput.Send />
      </ChatInput.Root>,
    );
    assert(pending.includes("disabled"), "a pending upload disables the send control");
  });

  it("renders an accessible textarea with its native attributes and ref", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const textareaRef = createRef<HTMLTextAreaElement>();
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ChatInput.Root input="" onChange={() => {}}>
            <ChatInput.Field
              ref={textareaRef}
              placeholder="Ask Veryfront"
              rows={4}
              cols={40}
              wrap="soft"
            />
          </ChatInput.Root>,
        );
      });

      const textarea = document.querySelector("textarea");
      assert(textarea, "Expected multiline composer input to render");
      assertEquals(textareaRef.current, textarea);
      assertEquals(textarea.getAttribute("aria-label"), "Ask Veryfront");
      assertEquals(textarea.rows, 4);
      assertEquals(textarea.cols, 40);
      assertEquals(textarea.wrap, "soft");
      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("opens upload and select document actions from the attachment button", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let selectCalls = 0;
    function HeadlessAttach() {
      return <button data-headless-attach="" {...useChatInput().getAttachProps()}>Upload</button>;
    }

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
          >
            <HeadlessAttach />
          </ChatInput>,
        );
      });

      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
      const headlessAttach = document.querySelector<HTMLButtonElement>("[data-headless-attach]");
      assert(fileInput, "Expected the provider-owned file input to render");
      assert(headlessAttach, "Expected the headless attachment control to render");
      let filePickerCalls = 0;
      fileInput.click = () => filePickerCalls += 1;
      flushSync(() => headlessAttach.click());
      assertEquals(filePickerCalls, 1, "the headless getter opens the upload picker");

      const attachButton = document.querySelector(
        'button[aria-label="Add document"]',
      );
      assert(attachButton, "Expected attachment button to exist");

      flushSync(() => {
        attachButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const uploadAction = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Add photos & files",
      );
      const menu = document.querySelector('[role="menu"]');
      assert(uploadAction, "Expected upload action to render");
      // The menu is now the portalled DropdownMenu primitive (escapes the
      // composer overflow) — it renders under <body>, not inline.
      assert(menu, "Expected attachment menu to render");
      assertEquals(menu.parentElement, document.body);

      flushSync(() => uploadAction.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      assertEquals(filePickerCalls, 2, "the built-in upload action shares the picker");

      flushSync(() => attachButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      const selectAction = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Select document",
      );
      assert(selectAction, "Expected select action to render");
      flushSync(() => {
        selectAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      assertEquals(selectCalls, 1);
      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("submits multiline input on Enter and keeps Shift+Enter for newlines", async () => {
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
      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("enables send for a resolved attachment without text", async () => {
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
      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("composer owns submit: folds resolved attachments, clears, and guards uploads", async () => {
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

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("uses the copied Studio prompt shell and non-scaling primary submit button", async () => {
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
      await unmountReactRoot(root);
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

  it("action leaves forward native button attributes without weakening guards", () => {
    const send = renderToString(
      <ChatInput.Root input="" onChange={() => {}} onSubmit={() => {}}>
        <ChatInput.Send
          id="send-action"
          title="Send message"
          data-action="send"
          aria-describedby="send-help"
          tabIndex={-1}
          disabled={false}
        />
      </ChatInput.Root>,
    );
    assert(send.includes('id="send-action"'));
    assert(send.includes('title="Send message"'));
    assert(send.includes('data-action="send"'));
    assert(send.includes('aria-describedby="send-help"'));
    assert(send.includes('tabindex="-1"'));
    assert(send.includes("disabled"), "consumer props cannot enable an unavailable send");

    const stop = renderToString(
      <ChatInput.Root input="" onChange={() => {}} isLoading stop={() => {}}>
        <ChatInput.Stop data-action="stop" title="Stop response" />
      </ChatInput.Root>,
    );
    assert(stop.includes('data-action="stop"'));
    assert(stop.includes('title="Stop response"'));

    const voice = renderToString(
      <ChatInput.Root input="" onChange={() => {}} onVoice={() => {}}>
        <ChatInput.Voice data-action="voice" aria-describedby="voice-help" />
      </ChatInput.Root>,
    );
    assert(voice.includes('data-action="voice"'));
    assert(voice.includes('aria-describedby="voice-help"'));
  });

  it("omits an unavailable Stop action while preserving an explicit custom action", async () => {
    const unavailable = renderToString(
      <ChatInput.Root input="" onChange={() => {}} isLoading>
        <ChatInput.Stop data-action="stop" />
      </ChatInput.Root>,
    );
    assert(!unavailable.includes('data-action="stop"'), "an unavailable Stop action is omitted");

    const explicit = renderToString(
      <ChatInput.Root input="" onChange={() => {}} isLoading>
        <ChatInput.Stop data-action="custom-stop" onClick={() => {}} />
      </ChatInput.Root>,
    );
    assert(
      explicit.includes('data-action="custom-stop"'),
      "an explicit custom Stop action remains available",
    );

    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let customStops = 0;
    let root: Root | undefined;
    try {
      const createdRoot = createRoot(document.getElementById("root")!);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <ChatInput.Root input="" onChange={() => {}} isLoading>
            <ChatInput.Stop onClick={() => customStops += 1} />
          </ChatInput.Root>,
        );
      });
      flushSync(() =>
        document.querySelector<HTMLButtonElement>('button[aria-label="Stop"]')?.click()
      );
      assertEquals(customStops, 1, "the explicit custom Stop action remains functional");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("asChild action leaves preserve Button styling, refs, and event composition", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    const actionRef = createRef<HTMLAnchorElement>();
    const childRef = createRef<HTMLAnchorElement>();
    const order: string[] = [];
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <ChatInput.Root
            input="ready"
            onChange={() => {}}
            onSubmit={() => order.push("submit")}
          >
            <ChatInput.Send
              asChild
              ref={actionRef}
              className="action-class"
              onClick={(_event, next) => {
                order.push("wrapper");
                next();
              }}
            >
              <a
                ref={childRef}
                href="/send"
                className="child-class"
                onClick={() => order.push("child")}
              >
                Send
              </a>
            </ChatInput.Send>
          </ChatInput.Root>,
        );
      });

      const link = document.querySelector<HTMLAnchorElement>('a[aria-label="Send"]');
      assert(link, "Expected the custom send link to render");
      assertEquals(actionRef.current, link);
      assertEquals(childRef.current, link);
      assert(link.className.includes("bg-[var(--primary)]"), "Button variant classes survive");
      assert(link.className.includes("size-9"), "Button size classes survive");
      assert(link.className.includes("action-class"), "leaf className survives");
      assert(link.className.includes("child-class"), "child className survives");
      for (const leakedAttribute of ["variant", "on", "size", "type", "disabled"]) {
        assertEquals(
          link.hasAttribute(leakedAttribute),
          false,
          `${leakedAttribute} must not leak to an asChild link`,
        );
      }

      flushSync(() => {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      assertEquals(order, ["child", "wrapper", "submit"]);
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("routes every asChild action leaf through the styled Button contract", () => {
    const cases = [
      [
        "Send",
        renderToString(
          <ChatInput.Root input="ready" onChange={() => {}} onSubmit={() => {}}>
            <ChatInput.Send asChild>
              <a href="/send">Send</a>
            </ChatInput.Send>
          </ChatInput.Root>,
        ),
      ],
      [
        "Stop",
        renderToString(
          <ChatInput.Root input="" onChange={() => {}} isLoading stop={() => {}}>
            <ChatInput.Stop asChild>
              <a href="/stop">Stop</a>
            </ChatInput.Stop>
          </ChatInput.Root>,
        ),
      ],
      [
        "Submit (idle)",
        renderToString(
          <ChatInput.Root input="ready" onChange={() => {}} onSubmit={() => {}}>
            <ChatInput.Submit asChild>
              <a href="/submit">Submit</a>
            </ChatInput.Submit>
          </ChatInput.Root>,
        ),
      ],
      [
        "Submit (streaming)",
        renderToString(
          <ChatInput.Root input="" onChange={() => {}} isLoading stop={() => {}}>
            <ChatInput.Submit asChild>
              <a href="/stop">Stop</a>
            </ChatInput.Submit>
          </ChatInput.Root>,
        ),
      ],
      [
        "Voice",
        renderToString(
          <ChatInput.Root input="" onChange={() => {}} onVoice={() => {}}>
            <ChatInput.Voice asChild>
              <a href="/voice">Voice</a>
            </ChatInput.Voice>
          </ChatInput.Root>,
        ),
      ],
    ] as const;

    for (const [name, html] of cases) {
      assert(html.includes("relative inline-flex"), `${name} keeps base Button classes`);
      assert(html.includes("size-9"), `${name} keeps the icon-lg Button size`);
      for (const leakedAttribute of ["variant=", " on=", " size=", " type="]) {
        assert(
          !html.includes(leakedAttribute),
          `${name} must not render ${leakedAttribute.trim()}`,
        );
      }
    }

    const nativeButton = renderToString(
      <ChatInput.Root input="ready" onChange={() => {}} onSubmit={() => {}}>
        <ChatInput.Send asChild>
          {createElement("button", null, "Send")}
        </ChatInput.Send>
      </ChatInput.Root>,
    );
    assert(
      nativeButton.includes('type="button"'),
      "a native asChild button keeps the non-submitting Button default",
    );

    const ForwardedAnchor = forwardRef<
      HTMLAnchorElement,
      AnchorHTMLAttributes<HTMLAnchorElement>
    >((props, ref) => <a ref={ref} {...props} />);
    const opaqueAnchor = renderToString(
      <ChatInput.Root input="ready" onChange={() => {}} onSubmit={() => {}}>
        <ChatInput.Send asChild>
          <ForwardedAnchor href="/send">Send</ForwardedAnchor>
        </ChatInput.Send>
      </ChatInput.Root>,
    );
    assert(
      !/<a\b[^>]*\btype=/.test(opaqueAnchor),
      "an opaque asChild anchor must not receive button type",
    );
  });

  it("lets an opaque forwardRef button own its native form semantics", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    const ForwardedButton = forwardRef<
      HTMLButtonElement,
      ButtonHTMLAttributes<HTMLButtonElement>
    >((props, ref) => <button ref={ref} {...props} />);
    let actionSubmits = 0;
    let nativeSubmits = 0;
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <ChatInput.Root
            input="ready"
            onChange={() => {}}
            onSubmit={() => actionSubmits += 1}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                nativeSubmits += 1;
              }}
            >
              <ChatInput.Send asChild>
                <ForwardedButton type="button">Send</ForwardedButton>
              </ChatInput.Send>
            </form>
          </ChatInput.Root>,
        );
      });

      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      assert(button, "Expected the forwarded custom button to render");
      assertEquals(button.type, "button", "the opaque child keeps its explicit button type");
      flushSync(() => button.click());
      assertEquals(actionSubmits, 1);
      assertEquals(nativeSubmits, 0, "the enclosing form must not submit a second time");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("asChild respects child cancellation before invoking the action wrapper", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let wrapperCalls = 0;
    let submitCalls = 0;
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <ChatInput.Root
            input="ready"
            onChange={() => {}}
            onSubmit={() => submitCalls += 1}
          >
            <ChatInput.Send
              asChild
              onClick={(_event, next) => {
                wrapperCalls += 1;
                next();
              }}
            >
              <a href="/send" onClick={(event) => event.preventDefault()}>Send</a>
            </ChatInput.Send>
          </ChatInput.Root>,
        );
      });

      const link = document.querySelector<HTMLAnchorElement>('a[aria-label="Send"]');
      assert(link, "Expected the custom send link to render");
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      flushSync(() => link.dispatchEvent(event));
      assert(event.defaultPrevented, "child cancellation is preserved");
      assertEquals(wrapperCalls, 0, "cancelled child event skips the action wrapper");
      assertEquals(submitCalls, 0, "cancelled child event skips submit");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("disabled asChild actions block link, auxiliary, and keyboard activation", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let childActivations = 0;
    let wrapperActivations = 0;
    let submitCalls = 0;
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <ChatInput.Root
            input="ready"
            onChange={() => {}}
            onSubmit={() => submitCalls += 1}
          >
            <ChatInput.Send
              asChild
              disabled
              onAuxClick={() => wrapperActivations += 1}
              onKeyDown={() => wrapperActivations += 1}
              onClick={(_event, next) => {
                wrapperActivations += 1;
                next();
              }}
            >
              <a
                href="/send"
                onAuxClick={() => childActivations += 1}
                onKeyDown={() => childActivations += 1}
                onClick={() => childActivations += 1}
              >
                Send
              </a>
            </ChatInput.Send>
          </ChatInput.Root>,
        );
      });

      const link = document.querySelector<HTMLAnchorElement>('a[aria-label="Send"]');
      assert(link, "Expected the disabled custom send link to render");
      assertEquals(link.getAttribute("href"), null, "disabled link navigation is removed");
      assertEquals(link.getAttribute("aria-disabled"), "true");
      assertEquals(link.tabIndex, -1);
      assertEquals(link.hasAttribute("disabled"), false, "invalid anchor attribute is omitted");

      const activations = [
        new MouseEvent("click", { bubbles: true, cancelable: true }),
        new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
        new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: " " }),
      ];
      for (const event of activations) {
        flushSync(() => link.dispatchEvent(event));
        assert(event.defaultPrevented, `${event.type} activation must be prevented`);
      }
      assertEquals(childActivations, 0, "disabled state skips child handlers");
      assertEquals(wrapperActivations, 0, "disabled state skips action handlers");
      assertEquals(submitCalls, 0, "disabled state skips submit");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
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

    it("keeps idle children out of the streaming stop control", () => {
      const html = renderToString(
        <ChatInput.Root input="hi" onChange={() => {}} isLoading stop={() => {}}>
          <ChatInput.Submit stopIcon={<svg data-testid="stop-override" />}>
            <svg data-testid="send-child" />
          </ChatInput.Submit>
        </ChatInput.Root>,
      );
      assert(html.includes("stop-override"), "streaming uses the stop override");
      assert(!html.includes("send-child"), "idle content must not leak onto Stop");
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
