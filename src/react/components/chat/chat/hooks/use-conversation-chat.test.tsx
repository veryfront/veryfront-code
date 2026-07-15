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
    activeConversation: active,
    activeConversationId: active.id,
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
  it("keeps the session usable when a provider has no active conversation", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = () => {
      requestCount++;
      return Promise.resolve(new Response(null));
    };
    const saved: Conversation[] = [];
    const placeholder = conversation("placeholder", []);
    const unboundValue = {
      ...contextValue(placeholder, (conversation) => saved.push(conversation)),
      activeConversation: null,
      activeConversationId: null,
    };
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const renderValue = (value: UseConversationsResult) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider value={value}>
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };
    try {
      renderValue({ ...unboundValue, isLoading: true });
      await settle();

      flushSync(() => latest!.chat.setInput("Loading draft"));
      await latest!.chat.sendMessage({ text: "Loading message" });
      assertEquals(latest!.chat.input, "");
      assertEquals(requestCount, 0, "initial provider loading must fence chat actions");

      renderValue(unboundValue);
      await settle();
      flushSync(() => latest!.chat.setInput("Draft message"));
      assertEquals(latest!.chat.input, "Draft message");

      await latest!.chat.sendMessage({ text: "New conversation" });
      await settle();

      assertEquals(requestCount, 1, "an unbound provider session must still send");
      assertEquals(saved.at(-1)?.messages.at(0)?.parts, [
        { type: "text", text: "New conversation" },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("mints a new synthetic identity after leaving an unbound session", async () => {
    const restoreDom = installDom();
    const saved: Conversation[] = [];
    const placeholder = conversation("placeholder", []);
    const unboundValue = {
      ...contextValue(placeholder, (conversation) => saved.push(conversation)),
      activeConversation: null,
      activeConversationId: null,
    };
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const renderValue = (value: UseConversationsResult) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider value={value}>
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };
    try {
      renderValue(unboundValue);
      await settle();
      const firstMessage = userMessage("first-message", "First conversation");
      flushSync(() => latest!.chat.setMessages([firstMessage]));
      await settle();
      const firstSyntheticId = saved.at(-1)!.id;

      const bound = conversation("bound", [userMessage("bound-message", "Bound")]);
      renderValue(contextValue(bound, (conversation) => saved.push(conversation)));
      await settle();
      renderValue(unboundValue);
      await settle();

      const nextMessage = userMessage("next-message", "Next conversation");
      flushSync(() => latest!.chat.setMessages([nextMessage]));
      await settle();

      assertEquals(
        saved.at(-1)?.id === firstSyntheticId,
        false,
        "a new unbound session must mint a new conversation id",
      );
      assertEquals(saved.at(-1)?.messages, [nextMessage]);
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("persists agent changes within one unbound session", async () => {
    const restoreDom = installDom();
    const saved: Conversation[] = [];
    const placeholder = conversation("placeholder", []);
    const unboundValue = {
      ...contextValue(placeholder, (conversation) => saved.push(conversation)),
      activeConversation: null,
      activeConversationId: null,
    };
    let latest: UseConversationChatResult | null = null;

    function Capture({ agentId }: { agentId: string | undefined }): null {
      latest = useConversationChat({ agentId });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const renderAgent = (agentId: string | undefined) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider value={unboundValue}>
            <Capture agentId={agentId} />
          </ConversationsContextProvider>,
        );
      });
    };
    try {
      const firstMessage = userMessage("first-message", "First message");
      renderAgent("agent-a");
      await settle();
      flushSync(() => latest!.chat.setMessages([firstMessage]));
      await settle();

      const syntheticId = saved.at(-1)!.id;
      assertEquals(saved.at(-1)?.agentId, "agent-a");

      const secondMessage = userMessage("second-message", "Second message");
      renderAgent("agent-b");
      await settle();
      flushSync(() => latest!.chat.setMessages([firstMessage, secondMessage]));
      await settle();

      assertEquals(saved.at(-1)?.id, syntheticId);
      assertEquals(saved.at(-1)?.agentId, "agent-b");

      const thirdMessage = userMessage("third-message", "Third message");
      renderAgent("");
      await settle();
      flushSync(() => latest!.chat.setMessages([firstMessage, secondMessage, thirdMessage]));
      await settle();

      assertEquals(saved.at(-1)?.id, syntheticId);
      assertEquals("agentId" in saved.at(-1)!, false);
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("persists the fallback agent used by a bound conversation", async () => {
    const restoreDom = installDom();
    const bound = conversation("bound", [userMessage("first-message", "First message")]);
    const saved: Conversation[] = [];
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat({ agentId: "agent-b" });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider
            value={contextValue(bound, (conversation) => saved.push(conversation))}
          >
            <Capture />
          </ConversationsContextProvider>,
        );
      });
      await settle();

      const nextMessage = userMessage("next-message", "Next message");
      flushSync(() => latest!.chat.setMessages([...bound.messages, nextMessage]));
      await settle();

      assertEquals(saved.at(-1)?.id, bound.id);
      assertEquals(saved.at(-1)?.agentId, "agent-b");
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("replaces message state before persisting a newly active conversation", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = () => {
      requestCount++;
      return Promise.resolve(new Response(null));
    };
    const first = conversation("first", [userMessage("first-message", "First thread")]);
    const second = conversation("second", [userMessage("second-message", "Second thread")]);
    const saved: Conversation[] = [];
    const renderedMessageIds: string[][] = [];
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      renderedMessageIds.push(latest.chat.messages.map((message) => message.id));
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const renderValue = (value: UseConversationsResult) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider value={value}>
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };
    const save = (value: Conversation) => saved.push(value);
    const render = (active: Conversation) => renderValue(contextValue(active, save));

    try {
      render(first);
      await settle();
      assertEquals(latest!.chat.messages, first.messages);
      assertEquals("reset" in latest!.chat, false, "internal session controls must stay private");
      const staleSend = latest!.chat.sendMessage;
      const staleSubmit = latest!.chat.handleSubmit;

      const pendingRender = renderedMessageIds.length;
      renderValue({ ...contextValue(first, save), activeConversationId: second.id });
      assertEquals(
        renderedMessageIds[pendingRender],
        [],
        "a loading conversation must hide the previously active thread",
      );
      await settle();
      await latest!.chat.sendMessage({ text: "Pending action" });
      assertEquals(requestCount, 0, "a conversation must not send before it has loaded");

      const firstSwitchRender = renderedMessageIds.length;
      render(second);
      assertEquals(
        renderedMessageIds[firstSwitchRender],
        ["second-message"],
        "the first render for a conversation must not expose the previous thread",
      );
      await settle();
      assertEquals(latest!.chat.messages, second.messages);
      assertEquals(saved, [], "switching conversations must not persist stale messages");

      await staleSend({ text: "Stale action" });
      await settle();
      assertEquals(requestCount, 0, "an action retained from the old session must be ignored");
      assertEquals(latest!.chat.messages, second.messages);
      let prevented = false;
      await staleSubmit({
        preventDefault: () => {
          prevented = true;
        },
      } as React.FormEvent);
      assertEquals(prevented, true, "a fenced form submit must still prevent native navigation");

      const reply = userMessage("second-reply", "Second reply");
      flushSync(() => latest!.chat.setMessages([...latest!.chat.messages, reply]));
      await settle();

      assertEquals(saved.length, 1);
      assertEquals(saved[0]?.id, "second");
      assertEquals(saved[0]?.messages, [...second.messages, reply]);
    } finally {
      globalThis.fetch = originalFetch;
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("resets turn lifecycle state while the next conversation is loading", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response("failed", { status: 500 }));
    const first = conversation("first", [userMessage("first-message", "First thread")]);
    const second = conversation("second", [userMessage("second-message", "Second thread")]);
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const renderValue = (value: UseConversationsResult) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider value={value}>
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };

    try {
      renderValue(contextValue(first, () => {}));
      await settle();
      await latest!.chat.sendMessage({ text: "Fail this turn" });
      await settle();
      assertEquals(latest!.chat.status, "error");

      renderValue({ ...contextValue(first, () => {}), activeConversationId: second.id });
      assertEquals(latest!.chat.isLoading, false);
      assertEquals(latest!.chat.error, null);
      assertEquals(latest!.chat.status, "ready");
      assertEquals(latest!.chat.streamingMessageId, null);
    } finally {
      globalThis.fetch = originalFetch;
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("clears branch state when conversations reuse message ids", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 200 }));

    const first = conversation("first", [userMessage("shared-message", "First thread")]);
    const second = conversation("second", [userMessage("shared-message", "Second thread")]);
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const render = (active: Conversation) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider value={contextValue(active, () => {})}>
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };

    try {
      render(first);
      await settle();

      let edit: Promise<void> | undefined;
      flushSync(() => {
        edit = latest!.chat.editMessage("shared-message", "Edited first thread");
      });
      await edit;
      await settle();
      assertEquals(latest!.chat.getBranches("shared-message").total, 2);

      render(second);
      await settle();

      assertEquals(latest!.chat.messages, second.messages);
      assertEquals(
        latest!.chat.getBranches("shared-message"),
        { current: 1, total: 1 },
        "branch state from the previous conversation must not resolve by a reused message id",
      );
    } finally {
      globalThis.fetch = originalFetch;
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("keeps retained actions invalid after returning to the same conversation", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = () => {
      requestCount++;
      return Promise.resolve(new Response(null));
    };

    const first = conversation("first", [userMessage("first-message", "First thread")]);
    const second = conversation("second", [userMessage("second-message", "Second thread")]);
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const render = (active: Conversation) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider value={contextValue(active, () => {})}>
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };

    try {
      render(first);
      await settle();
      const staleSend = latest!.chat.sendMessage;

      render(second);
      await settle();
      render(first);
      await settle();

      await staleSend({ text: "Late first-session action" });
      await settle();
      assertEquals(requestCount, 0);
      assertEquals(latest!.chat.messages, first.messages);
    } finally {
      globalThis.fetch = originalFetch;
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("does not carry request state into a newly active conversation", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    const body = [
      "event: Custom",
      'data: {"name":"inference","value":{"inferenceMode":"server-local","model":"old-server-model"}}',
      "",
      "event: RunError",
      'data: {"message":"Old conversation failed"}',
      "",
      "",
    ].join("\n");
    globalThis.fetch = () => Promise.resolve(new Response(body));

    const first = conversation("first", [userMessage("first-message", "First thread")]);
    const second = conversation("second", [userMessage("second-message", "Second thread")]);
    const snapshots: Array<
      Pick<
        UseConversationChatResult["chat"],
        "input" | "error" | "model" | "activeModel" | "inferenceMode" | "data"
      >
    > = [];
    let latest: UseConversationChatResult | null = null;

    function Capture(): null {
      latest = useConversationChat();
      snapshots.push({
        input: latest.chat.input,
        error: latest.chat.error,
        model: latest.chat.model,
        activeModel: latest.chat.activeModel,
        inferenceMode: latest.chat.inferenceMode,
        data: latest.chat.data,
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    const render = (active: Conversation) => {
      flushSync(() => {
        root.render(
          <ConversationsContextProvider value={contextValue(active, () => {})}>
            <Capture />
          </ConversationsContextProvider>,
        );
      });
    };

    try {
      render(first);
      await settle();
      flushSync(() => {
        latest!.chat.setInput("old draft");
        latest!.chat.setModel("old-selected-model");
      });
      await settle();
      await latest!.chat.sendMessage({ text: "Fail" });
      await settle();

      assertEquals(latest!.chat.error?.message, "Old conversation failed");
      assertEquals(latest!.chat.inferenceMode, "server-local");
      assertEquals(latest!.chat.activeModel, "old-server-model");

      const firstSwitchRender = snapshots.length;
      render(second);
      assertEquals(snapshots[firstSwitchRender], {
        input: "",
        error: null,
        model: undefined,
        activeModel: undefined,
        inferenceMode: "cloud",
        data: null,
      });
      await settle();

      assertEquals(latest!.chat.input, "");
      assertEquals(latest!.chat.error, null);
      assertEquals(latest!.chat.model, undefined);
      assertEquals(latest!.chat.activeModel, undefined);
      assertEquals(latest!.chat.inferenceMode, "cloud");
      assertEquals(latest!.chat.data, null);
    } finally {
      globalThis.fetch = originalFetch;
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
