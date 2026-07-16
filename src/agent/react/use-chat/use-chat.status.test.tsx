import "#veryfront/schemas/_test-setup.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useChat } from "./use-chat.ts";
import type { UseChatResult } from "./types.ts";

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

describe("react/agent/useChat status lifecycle", () => {
  it("transitions submitted -> streaming -> ready and publishes the streaming id", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    // A small network gap lets the `submitted` render commit before the stream
    // opens — mirroring a real request rather than an instantaneous one.
    globalThis.fetch = () => new Promise((resolve) => setTimeout(() => resolve(sseResponse()), 5));

    const statuses: UseChatResult["status"][] = [];
    const streamingIds: (string | null)[] = [];
    let latest: UseChatResult | null = null;

    function Capture(): null {
      const chat = useChat({ api: "/api/ag-ui" });
      latest = chat;
      statuses.push(chat.status);
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

      assert(statuses.includes("submitted"), "should pass through submitted");
      assert(statuses.includes("streaming"), "should pass through streaming");
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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("moves to error when the request fails", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response('{"error":"boom"}', { status: 500 }));

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
      assert(latest!.error !== null, "error is populated");
    } finally {
      flushSync(() => root.unmount());
      await settle();
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });
});
