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
});
