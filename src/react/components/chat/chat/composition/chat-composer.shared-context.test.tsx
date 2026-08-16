/**
 * One shared chat context (issue veryfront-issue-inbox#69): `ChatInput.Root`
 * (via `useComposerValue`) falls back to the surrounding `ChatContext` when its
 * explicit props are omitted, so `<Chat.Root chat={useChat()}>` wires the
 * composer without re-threading the session. Explicit props always win, and a
 * standalone `ChatInput.Root` (own props, no `Chat.Root`) is unchanged.
 */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { FormEvent } from "react";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { UseChatResult } from "#veryfront/agent/react";
import { Chat } from "../chat-preset.tsx";
import { ChatInput } from "./chat-composer.tsx";
import { useChatContext } from "../contexts/chat-context.tsx";
import type { ChatContextValue } from "../contexts/chat-context.tsx";

function makeChat(overrides: Partial<UseChatResult> = {}): UseChatResult {
  return {
    messages: [],
    input: "",
    isLoading: false,
    status: "ready",
    streamingMessageId: null,
    error: null,
    model: undefined,
    activeModel: undefined,
    inferenceMode: "cloud",
    setInput: () => {},
    setModel: () => {},
    sendMessage: () => Promise.resolve(),
    editMessage: () => Promise.resolve(),
    getBranches: () => ({ current: 0, total: 1 }),
    switchBranch: () => {},
    reload: () => Promise.resolve(),
    stop: () => {},
    setMessages: () => {},
    addToolOutput: () => {},
    handleInputChange: () => {},
    handleSubmit: () => Promise.resolve(),
    ...overrides,
  };
}

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

describe("react/components/chat/chat/composition/chat-composer shared context", () => {
  it("a propless ChatInput.Root reads the session input from the enclosing Chat.Root", () => {
    const html = renderToString(
      <Chat.Root chat={makeChat({ input: "draft from session" })}>
        <ChatInput.Root>
          <ChatInput.Field />
          <ChatInput.Submit />
        </ChatInput.Root>
      </Chat.Root>,
    );

    assertStringIncludes(
      html,
      "draft from session",
      "the field must show the shared session input without explicit props",
    );
  });

  it("a propless ChatInput.Submit dispatches through the shared session", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let sessionSubmits = 0;
    const chat = makeChat({
      input: "ready",
      handleSubmit: (_e?: FormEvent) => {
        sessionSubmits += 1;
        return Promise.resolve();
      },
    });
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <Chat.Root chat={chat}>
            <ChatInput.Root>
              <ChatInput.Field />
              <ChatInput.Submit />
            </ChatInput.Root>
          </Chat.Root>,
        );
      });

      const sendButton = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      assert(sendButton, "Expected the send control to render from shared context");
      flushSync(() => sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      assertEquals(sessionSubmits, 1, "submit must dispatch through the shared session");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("submits context attachments through the shared session", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let submitted: Parameters<UseChatResult["sendMessage"]>[0] | undefined;
    let textOnlySubmits = 0;
    const chat = makeChat({
      sendMessage: (message) => {
        submitted = message;
        return Promise.resolve();
      },
      handleSubmit: () => {
        textOnlySubmits += 1;
        return Promise.resolve();
      },
    });
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <Chat.Root
            chat={chat}
            attachments={[{
              id: "att-1",
              name: "notes.pdf",
              state: "uploaded",
              type: "application/pdf",
              url: "https://example.com/notes.pdf",
            }]}
          >
            <ChatInput.Root>
              <ChatInput.Field />
              <ChatInput.Submit />
            </ChatInput.Root>
          </Chat.Root>,
        );
      });

      const sendButton = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      assert(sendButton, "Expected an attachment-only send control to render");
      flushSync(() => sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      assertEquals(textOnlySubmits, 0, "attachment submission must bypass text-only handleSubmit");
      assertEquals(submitted, {
        text: "",
        files: [{
          type: "file",
          mediaType: "application/pdf",
          url: "https://example.com/notes.pdf",
          filename: "notes.pdf",
        }],
      });
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("submits the resolved flat input instead of the session draft", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let submitted: Parameters<UseChatResult["sendMessage"]>[0] | undefined;
    let textOnlySubmits = 0;
    let clearedInput: string | undefined;
    const chat = makeChat({
      input: "session draft",
      sendMessage: (message) => {
        submitted = message;
        return Promise.resolve();
      },
      handleSubmit: () => {
        textOnlySubmits += 1;
        return Promise.resolve();
      },
    });
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <Chat.Root
            chat={chat}
            input="flat draft"
            setInput={(value) => clearedInput = value}
          >
            <ChatInput.Root>
              <ChatInput.Field />
              <ChatInput.Submit />
            </ChatInput.Root>
          </Chat.Root>,
        );
      });

      const sendButton = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      assert(sendButton, "Expected the send control to render for the flat draft");
      flushSync(() => sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      assertEquals(textOnlySubmits, 0, "flat input submission must not use the session draft");
      assertEquals(submitted, { text: "flat draft" });
      assertEquals(clearedInput, "");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("explicit ChatInput.Root props win over the surrounding context values", async () => {
    const html = renderToString(
      <Chat.Root chat={makeChat({ input: "context value" })}>
        <ChatInput.Root input="explicit value" onChange={() => {}}>
          <ChatInput.Field />
        </ChatInput.Root>
      </Chat.Root>,
    );
    assertStringIncludes(html, "explicit value", "the explicit input prop wins");
    assert(
      !html.includes("context value"),
      "the context input must not leak past an explicit prop",
    );

    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let sessionSubmits = 0;
    let explicitSubmits = 0;
    const chat = makeChat({
      input: "ready",
      handleSubmit: () => {
        sessionSubmits += 1;
        return Promise.resolve();
      },
    });
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <Chat.Root chat={chat}>
            <ChatInput.Root onSubmit={() => explicitSubmits += 1}>
              <ChatInput.Field />
              <ChatInput.Submit />
            </ChatInput.Root>
          </Chat.Root>,
        );
      });

      const sendButton = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      assert(sendButton, "Expected the send control to render");
      flushSync(() => sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      assertEquals(explicitSubmits, 1, "the explicit onSubmit prop wins");
      assertEquals(sessionSubmits, 0, "the session submit must not fire past an explicit prop");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("a standalone ChatInput.Root with full explicit props behaves exactly as before", async () => {
    const html = renderToString(
      <ChatInput.Root
        input="standalone draft"
        onChange={() => {}}
        onSubmit={() => {}}
        models={[{ value: "model-1", label: "Model One" }]}
        model="model-1"
        onModelChange={() => {}}
        attachments={[]}
        onRemoveAttachment={() => {}}
        stop={() => {}}
        onAttach={() => {}}
      >
        <ChatInput.Field />
        <ChatInput.Submit />
      </ChatInput.Root>,
    );
    assertStringIncludes(html, "standalone draft", "standalone composer keeps its explicit input");

    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let submits = 0;
    let root: Root | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(
          <ChatInput.Root
            input="standalone draft"
            onChange={() => {}}
            onSubmit={() => submits += 1}
            models={[{ value: "model-1", label: "Model One" }]}
            model="model-1"
            onModelChange={() => {}}
            attachments={[]}
            onRemoveAttachment={() => {}}
            stop={() => {}}
            onAttach={() => {}}
          >
            <ChatInput.Field />
            <ChatInput.Submit />
          </ChatInput.Root>,
        );
      });

      const sendButton = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      assert(sendButton, "Expected the standalone send control to render");
      flushSync(() => sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      assertEquals(submits, 1, "standalone submit stays caller-owned");
    } finally {
      if (root) await unmountReactRoot(root);
      restore();
    }
  });

  it("the batteries ChatInput inherits the session loading state when isLoading is omitted", () => {
    const html = renderToString(
      <Chat.Root chat={makeChat({ input: "streaming turn", isLoading: true, status: "streaming" })}>
        <ChatInput />
      </Chat.Root>,
    );

    assertStringIncludes(
      html,
      'aria-label="Stop"',
      "an omitted isLoading must inherit the streaming session, showing Stop",
    );
    assert(
      !html.includes('aria-label="Send"'),
      "Send must stay hidden while the shared session is streaming",
    );
  });

  it("an explicit isLoading prop still wins over the streaming session", () => {
    const html = renderToString(
      <Chat.Root chat={makeChat({ input: "streaming turn", isLoading: true, status: "streaming" })}>
        <ChatInput isLoading={false} />
      </Chat.Root>,
    );

    assertStringIncludes(html, 'aria-label="Send"', "the explicit isLoading={false} prop wins");
    assert(
      !html.includes('aria-label="Stop"'),
      "the session loading state must not leak past an explicit isLoading prop",
    );
  });

  it("the batteries ChatInput renders attachments resolved from the shared context", () => {
    const html = renderToString(
      <Chat.Root
        chat={makeChat()}
        attachments={[{
          id: "att-1",
          name: "notes.pdf",
          state: "uploaded",
          url: "https://example.com/notes.pdf",
        }]}
        onRemoveAttachment={() => {}}
      >
        <ChatInput />
      </Chat.Root>,
    );

    assertStringIncludes(
      html,
      "notes.pdf",
      "a context-resolved attachment must render its pill in the composer body",
    );
    assertStringIncludes(
      html,
      'aria-label="Remove notes.pdf"',
      "the context-resolved onRemoveAttachment must surface the removal control",
    );
  });

  it("an explicit null flat prop overrides the session value instead of inheriting it", () => {
    let observed: ChatContextValue | undefined;
    function ContextProbe(): null {
      observed = useChatContext();
      return null;
    }

    renderToString(
      <Chat.Root
        chat={makeChat({ error: new Error("stale failure"), streamingMessageId: "msg-1" })}
        error={null}
        streamingMessageId={null}
      >
        <ContextProbe />
      </Chat.Root>,
    );

    assert(observed, "Expected the probe to observe the chat context");
    assertEquals(observed.error, null, "an explicit error={null} must clear the session error");
    assertEquals(
      observed.streamingMessageId,
      null,
      "an explicit streamingMessageId={null} must clear the session streaming id",
    );
  });

  it("an omitted flat prop still inherits the session error and streaming id", () => {
    let observed: ChatContextValue | undefined;
    function ContextProbe(): null {
      observed = useChatContext();
      return null;
    }

    const sessionError = new Error("session failure");
    renderToString(
      <Chat.Root chat={makeChat({ error: sessionError, streamingMessageId: "msg-1" })}>
        <ContextProbe />
      </Chat.Root>,
    );

    assert(observed, "Expected the probe to observe the chat context");
    assertEquals(observed.error, sessionError, "an omitted error prop inherits the session error");
    assertEquals(
      observed.streamingMessageId,
      "msg-1",
      "an omitted streamingMessageId prop inherits the session streaming id",
    );
  });
});
