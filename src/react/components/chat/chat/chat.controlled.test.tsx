/**
 * `<Chat chat={useChat()}>` — the consolidated controlled API (Step 3). Proves
 * the whole-session object drives the surface.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage, UseChatResult } from "#veryfront/agent/react";
import { Chat } from "./index.tsx";

function fakeSession(
  messages: ChatMessage[],
  overrides: Partial<UseChatResult> = {},
): UseChatResult {
  const noop = () => {};
  return {
    messages,
    input: "",
    isLoading: false,
    status: "ready",
    streamingMessageId: null,
    error: null,
    model: undefined,
    activeModel: undefined,
    inferenceMode: "cloud",
    setInput: noop,
    setModel: noop,
    sendMessage: () => Promise.resolve(),
    editMessage: () => Promise.resolve(),
    getBranches: () => ({ current: 1, total: 1 }),
    switchBranch: noop,
    reload: () => Promise.resolve(),
    stop: noop,
    setMessages: noop,
    addToolOutput: noop,
    handleInputChange: noop,
    handleSubmit: () => Promise.resolve(),
    ...overrides,
  };
}

function installDomGlobals(dom: JSDOM): () => void {
  const window = dom.window;
  const scrollTo = window.HTMLElement.prototype.scrollTo;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    self: globalThis.self,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
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
    MouseEvent: window.MouseEvent,
  });
  window.HTMLElement.prototype.scrollTo = () => {};
  return () => {
    window.HTMLElement.prototype.scrollTo = scrollTo;
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

function userMsg(text: string): ChatMessage {
  return { id: `m-${text}`, role: "user", parts: [{ type: "text", text }] } as ChatMessage;
}

function assistantMsg(id: string, text: string): ChatMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] } as ChatMessage;
}

describe("Chat — controlled via chat={useChat()}", () => {
  it("renders the session's messages (the object drives the surface)", () => {
    const html = renderToString(
      <Chat chat={fakeSession([userMsg("Hello from session")])} />,
    );
    assert(html.includes("Hello from session"), "message text renders from chat.messages");
  });

  it("treats chat={} as controlled — no agentId/app-mode fetch needed", () => {
    const html = renderToString(<Chat chat={fakeSession([])} />);
    assert(html.length > 0, "renders an empty controlled chat");
  });

  it("marks the exact assistant message identified by the streaming session", () => {
    const html = renderToString(
      <Chat
        chat={fakeSession([
          assistantMsg("streaming-message", "Streaming answer"),
          assistantMsg("later-message", "Later answer"),
        ], {
          isLoading: true,
          status: "streaming",
          streamingMessageId: "streaming-message",
        })}
      />,
    );

    const streamingAnswer = html.indexOf("Streaming answer");
    const continuing = html.indexOf("Continuing...");
    const laterAnswer = html.indexOf("Later answer");
    assert(
      streamingAnswer < continuing && continuing < laterAnswer,
      "the continuing marker must follow the streaming id instead of the last-message index",
    );
  });

  it("submits externally controlled attachments through the chat session", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let sent: Parameters<UseChatResult["sendMessage"]>[0] | undefined;
    const removed: string[] = [];

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);
      const chat = fakeSession([], {
        sendMessage: (message) => {
          sent = message;
          return Promise.resolve();
        },
      });

      flushSync(() => {
        root.render(
          <Chat
            chat={chat}
            attachments={[{
              id: "file-1",
              name: "brief.pdf",
              type: "application/pdf",
              state: "uploaded",
              url: "https://example.com/brief.pdf",
            }]}
            onRemoveAttachment={(id) => removed.push(id)}
          />,
        );
      });

      const send = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Send"]',
      );
      assert(send, "Expected attachment-only send button to render");
      flushSync(() => {
        send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      assertEquals(sent, {
        text: "",
        files: [{
          type: "file",
          mediaType: "application/pdf",
          url: "https://example.com/brief.pdf",
          filename: "brief.pdf",
        }],
      });
      assertEquals(removed, ["file-1"]);
      root.unmount();
    } finally {
      restore();
    }
  });
});
