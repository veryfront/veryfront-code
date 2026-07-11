import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import type { ChatMessage } from "#veryfront/agent/react";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ConversationsContextProvider } from "../contexts/conversations-context.tsx";
import type { UseConversationsResult } from "./use-conversations.ts";
import { useConversationChat, type UseConversationChatResult } from "./use-conversation-chat.ts";
import type { Conversation } from "../persistence/conversation-store.ts";

function installDom(): () => void {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://example.com/" },
  );
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
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
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

function userMessage(id: string, text: string): ChatMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  } as ChatMessage;
}

function conversation(id: string, messages: ChatMessage[]): Conversation {
  return {
    id,
    title: id,
    messages,
    createdAt: 1,
    updatedAt: 1,
  };
}

function contextValue(
  active: Conversation,
  save: (conversation: Conversation) => void,
): UseConversationsResult {
  const noop = () => {};
  return {
    conversations: [],
    active,
    activeId: active.id,
    isLoading: false,
    select: noop,
    create: () => active,
    rename: noop,
    remove: noop,
    update: noop,
    save,
    bind: noop,
  };
}

describe("react/components/chat/hooks/useConversationChat", () => {
  it("replaces message state before persisting a newly active conversation", async () => {
    const restoreDom = installDom();
    const first = conversation("first", [userMessage("first-message", "First thread")]);
    const second = conversation("second", [userMessage("second-message", "Second thread")]);
    const saved: Conversation[] = [];
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const render = (active: Conversation) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider
            value={contextValue(active, (value) => saved.push(value))}
          >
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };

    try {
      render(first);
      await settle();
      assertEquals(latest!.chat.messages, first.messages);

      render(second);
      await settle();
      assertEquals(latest!.chat.messages, second.messages);
      assertEquals(saved, [], "switching conversations must not persist stale messages");

      const reply = userMessage("second-reply", "Second reply");
      flushSync(() => latest!.chat.setMessages([...latest!.chat.messages, reply]));
      await settle();

      assertEquals(saved.length, 1);
      assertEquals(saved[0]?.id, "second");
      assertEquals(saved[0]?.messages, [...second.messages, reply]);
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("ignores a queued stream update from the conversation being closed", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    globalThis.fetch = () => Promise.resolve(new Response(stream));

    const first = conversation("first", [userMessage("first-message", "First thread")]);
    const second = conversation("second", [userMessage("second-message", "Second thread")]);
    const saved: Conversation[] = [];
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const render = (active: Conversation) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider
            value={contextValue(active, (value) => saved.push(value))}
          >
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };

    try {
      render(first);
      await settle();

      let oldRequest: Promise<void> | undefined;
      flushSync(() => {
        oldRequest = latest!.chat.sendMessage({ text: "Old request" });
      });
      await settle();
      saved.length = 0;

      // Queue a chunk while the old reader is waiting, then switch in the same
      // turn. The reader continuation runs after the switch invalidates it.
      streamController!.enqueue(encoder.encode([
        "event: TextMessageStart",
        'data: {"messageId":"old-assistant","contentId":"text:0","role":"assistant"}',
        "",
        "event: TextMessageContent",
        'data: {"messageId":"old-assistant","contentId":"text:0","delta":"Late reply"}',
        "",
        "",
      ].join("\n")));
      render(second);
      await settle();

      streamController!.close();
      await oldRequest;
      await settle();

      assertEquals(latest!.chat.messages, second.messages);
      assertEquals(saved, [], "a late old-session chunk must not be saved into the new thread");

      const reply = userMessage("second-reply", "Second reply");
      flushSync(() => latest!.chat.setMessages([...latest!.chat.messages, reply]));
      await settle();
      assertEquals(saved.at(-1)?.id, "second");
      assertEquals(saved.at(-1)?.messages, [...second.messages, reply]);
    } finally {
      globalThis.fetch = originalFetch;
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });
});
