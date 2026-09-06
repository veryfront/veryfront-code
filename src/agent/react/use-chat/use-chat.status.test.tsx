import "#veryfront/schemas/_test-setup.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  decodeConversationRecord,
  encodeConversationRecord,
} from "#veryfront/react/components/chat/chat/persistence/conversation-codec.ts";
import { useChat } from "./use-chat.ts";
import type { UseChatError, UseChatResult } from "./types.ts";

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
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

function sseResponse(): Response {
  const encoder = new TextEncoder();
  // Deliver each SSE event in its own task so React commits a render between
  // the streamed token and the run finishing — otherwise the whole turn
  // collapses into a single batched commit and `streaming` is never observed.
  const events = [
    'event: TextMessageStart\ndata: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}\n\n',
    'event: TextMessageContent\ndata: {"messageId":"msg-1","contentId":"text:0","delta":"Hi"}\n\n',
    'event: TextMessageEnd\ndata: {"messageId":"msg-1","contentId":"text:0"}\n\n',
    'event: RunFinished\ndata: {"threadId":"t-1","runId":"r-1"}\n\n',
  ];
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= events.length) {
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3));
      controller.enqueue(encoder.encode(events[i++]));
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function errorSseResponse(code: string, message: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: RunError\ndata: ${JSON.stringify({ code, message })}\n\n`,
          ),
        );
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function persistMessages(messages: UseChatResult["messages"]): UseChatResult["messages"] {
  const encoded = encodeConversationRecord({
    id: "persisted-chat",
    title: "Persisted chat",
    messages,
    createdAt: 1,
    updatedAt: 2,
  });
  return decodeConversationRecord(encoded.serialized).value.messages;
}

describe("react/agent/useChat status lifecycle", () => {
  it("transitions submitted -> streaming -> ready and publishes the streaming id", async () => {
    const restoreDom = installDom();
    // A small network gap lets the `submitted` render commit before the stream
    // opens — mirroring a real request rather than an instantaneous one.
    installMockFetch(() => new Promise((resolve) => setTimeout(() => resolve(sseResponse()), 5)));
    const statuses: UseChatResult["status"][] = [];
    const loadingFlags: boolean[] = [];
    const streamingIds: (string | null)[] = [];
    let latest: UseChatResult | null = null;

    function Capture(): null {
      const chat = useChat({ api: "/api/ag-ui" });
      latest = chat;
      statuses.push(chat.status);
      loadingFlags.push(chat.isLoading);
      streamingIds.push(chat.streamingMessageId);
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      assertEquals(latest!.status, "ready", "starts idle");
      assertEquals(latest!.isLoading, false);

      await latest!.sendMessage({ text: "Hello" });
      await settle();

      const deduped = statuses.filter((status, index) => status !== statuses[index - 1]);
      assertEquals(
        deduped,
        ["ready", "submitted", "streaming", "ready"],
        "status must advance ready -> submitted -> streaming -> ready in order",
      );
      assertEquals(
        streamingIds[statuses.indexOf("submitted")],
        null,
        "streamingMessageId must stay null until the stream opens",
      );
      assertEquals(
        statuses.filter((status, index) => status === "ready" && loadingFlags[index]),
        [],
        "the turn must never report ready while the request is still in flight",
      );
      assert(
        streamingIds.includes("msg-1"),
        "streamingMessageId should surface the live assistant id",
      );
      assertEquals(latest!.status, "ready", "settles to ready");
      assertEquals(latest!.streamingMessageId, null, "clears the streaming id when idle");
      assertEquals(latest!.isLoading, false, "isLoading alias tracks the terminal state");
      assertEquals(latest!.error, null);
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreMockFetch();
      restoreDom();
    }
  });

  it("moves to error when the request fails", async () => {
    const restoreDom = installDom();
    installMockFetch(() => Promise.resolve(new Response('{"error":"boom"}', { status: 500 })));
    let latest: UseChatResult | null = null;
    function Capture(): null {
      latest = useChat({ api: "/api/ag-ui" });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await latest!.sendMessage({ text: "Hello" });
      await settle();

      assertEquals(latest!.status, "error", "failed turn reports error status");
      assertEquals(latest!.streamingMessageId, null);
      assertEquals(latest!.isLoading, false);
      assertEquals(
        latest!.error?.message,
        "boom",
        "surfaces the server-supplied failure reason instead of a generic status message",
      );
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreMockFetch();
      restoreDom();
    }
  });

  it("surfaces actionable AG-UI error codes in state and onError", async () => {
    for (const code of ["INSUFFICIENT_CREDITS", "RATE_LIMITED"]) {
      const restoreDom = installDom();
      installMockFetch(() => Promise.resolve(errorSseResponse(code, `${code} message`)));
      let latest: UseChatResult | null = null;
      let callbackError: UseChatError | undefined;

      const Capture = (): null => {
        latest = useChat({
          api: "/api/ag-ui",
          onError: (error) => {
            callbackError = error;
          },
        });
        return null;
      };

      const root = createRoot(document.getElementById("root")!);
      try {
        flushSync(() => root.render(<Capture />));
        await latest!.sendMessage({ text: "Hello" });
        await settle();

        assertEquals(latest!.status, "error");
        assertEquals(
          latest!.error?.code,
          code,
          "hook state must retain the terminal provider error code",
        );
        assertEquals(
          callbackError?.code,
          code,
          "onError must receive the terminal provider error code",
        );
        assertEquals(callbackError, latest!.error, "state and callback must expose the same error");
      } finally {
        flushSync(() => root.unmount());
        await settle();
        restoreMockFetch();
        restoreDom();
      }
    }
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    const restoreDom = installDom();
    installMockFetch(() =>
      Promise.resolve(new Response("<html>gateway timeout</html>", { status: 500 }))
    );
    let latest: UseChatResult | null = null;
    function Capture(): null {
      latest = useChat({ api: "/api/ag-ui" });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await latest!.sendMessage({ text: "Hello" });
      await settle();

      assertEquals(
        latest!.status,
        "error",
        "non-JSON failures still report error status",
      );
      assertEquals(
        latest!.error?.message,
        "API error: 500",
        "non-JSON error bodies fall back to the status-code message",
      );
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreMockFetch();
      restoreDom();
    }
  });

  it("keeps a default-model assistant response persistable", async () => {
    const restoreDom = installDom();
    installMockFetch(() => Promise.resolve(sseResponse()));
    let latest: UseChatResult | null = null;

    function Capture(): null {
      latest = useChat({ api: "/api/ag-ui" });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await latest!.sendMessage({ text: "Hello" });
      await settle();

      const persisted = persistMessages(latest!.messages);
      const assistant = persisted.find((message) => message.role === "assistant");
      assert(assistant, "the streamed assistant response should be retained");
      assertEquals(Object.hasOwn(assistant.metadata ?? {}, "model"), false);
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreMockFetch();
      restoreDom();
    }
  });

  it("uses a per-message model override for the request and response metadata", async () => {
    const restoreDom = installDom();
    let requestBody: { model?: string } | undefined;
    installMockFetch((_input, init) => {
      requestBody = JSON.parse(String((init as { body?: unknown } | undefined)?.body));
      return Promise.resolve(sseResponse());
    });
    let latest: UseChatResult | null = null;

    function Capture(): null {
      latest = useChat({ api: "/api/ag-ui", model: "session-model" });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await latest!.sendMessage({ text: "Hello", model: "flat-model" });
      await settle();

      assertEquals(requestBody?.model, "flat-model");
      const assistant = latest!.messages.find((message) => message.role === "assistant");
      assert(assistant, "the streamed assistant response should be retained");
      assertEquals(assistant.metadata?.model, "flat-model");
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreMockFetch();
      restoreDom();
    }
  });

  it("keeps a successful client tool output persistable", async () => {
    const restoreDom = installDom();
    let latest: UseChatResult | null = null;

    function Capture(): null {
      latest = useChat({
        initialMessages: [{
          id: "assistant-tool",
          role: "assistant",
          parts: [{
            type: "tool-search",
            toolCallId: "call-1",
            toolName: "search",
            state: "input-available",
            input: { query: "Veryfront" },
          }],
        }],
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      flushSync(() =>
        latest!.addToolOutput({
          tool: "search",
          toolCallId: "call-1",
          output: { matches: 1 },
        })
      );

      const persisted = persistMessages(latest!.messages);
      const part = persisted[0]?.parts[0];
      assert(
        part && "toolCallId" in part && "state" in part,
        "the tool call should be retained",
      );
      assertEquals(part.state, "output-available");
      assertEquals(part.output, { matches: 1 });
      assertEquals(Object.hasOwn(part, "errorText"), false);
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("routes client tool output to the matching dynamic tool part only", async () => {
    const restoreDom = installDom();
    let latest: UseChatResult | null = null;

    function Capture(): null {
      latest = useChat({
        initialMessages: [{
          id: "assistant-tool",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "call-2",
              toolName: "mcp__docs__search",
              state: "input-available",
              input: {},
            },
            {
              type: "tool-search",
              toolCallId: "call-1",
              toolName: "search",
              state: "input-available",
              input: { query: "Veryfront" },
            },
          ],
        }],
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      flushSync(() =>
        latest!.addToolOutput({
          tool: "mcp__docs__search",
          toolCallId: "call-2",
          output: { matches: 1 },
        })
      );

      const parts = latest!.messages[0]?.parts ?? [];
      const dynamicPart = parts[0] as { state?: string; output?: unknown };
      const searchPart = parts[1] as { state?: string };
      assertEquals(
        dynamicPart.state,
        "output-available",
        "a dynamic-tool part receives its client output",
      );
      assertEquals(
        dynamicPart.output,
        { matches: 1 },
        "the dynamic-tool part carries the client output payload",
      );
      assertEquals(
        searchPart.state,
        "input-available",
        "a non-matching toolCallId is left untouched",
      );
      assertEquals(
        Object.hasOwn(searchPart, "output"),
        false,
        "concurrent tool calls do not overwrite each other's results",
      );
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });

  it("keeps a failed client tool output persistable", async () => {
    const restoreDom = installDom();
    let latest: UseChatResult | null = null;

    function Capture(): null {
      latest = useChat({
        initialMessages: [{
          id: "assistant-tool",
          role: "assistant",
          parts: [{
            type: "tool-search",
            toolCallId: "call-1",
            toolName: "search",
            state: "input-available",
            input: { query: "Veryfront" },
          }],
        }],
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      flushSync(() =>
        latest!.addToolOutput({
          tool: "search",
          toolCallId: "call-1",
          errorText: "Search unavailable",
        })
      );

      const persisted = persistMessages(latest!.messages);
      const part = persisted[0]?.parts[0];
      assert(
        part && "toolCallId" in part && "state" in part,
        "the tool call should be retained",
      );
      assertEquals(part.state, "output-error");
      assertEquals(part.errorText, "Search unavailable");
      assertEquals(Object.hasOwn(part, "output"), false);
    } finally {
      flushSync(() => root.unmount());
      await settle();
      restoreDom();
    }
  });
});
