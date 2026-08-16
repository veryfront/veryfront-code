/**
 * A production build defaults `security.csrf` to on, so the server rejects any
 * POST that arrives without the double-submit header. The chat transport is the
 * only thing the `ai-agent` template does, so a `useChat` request that omits
 * `x-csrf-token` makes every deployed chat answer `403` — while `veryfront dev`
 * (CSRF off) keeps working and hides the break.
 */
import "#veryfront/schemas/_test-setup.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useChat } from "./use-chat.ts";
import type { UseChatResult } from "./types.ts";

function installDom(): () => void {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://example.test/" },
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

function hasRequestHeaders(value: unknown): value is { headers?: HeadersInit } {
  return typeof value === "object" && value !== null && "headers" in value;
}

/** Drive one `sendMessage` turn and hand back the headers the transport sent. */
async function captureSendHeaders(
  options: Parameters<typeof useChat>[0],
): Promise<Headers> {
  const originalFetch = globalThis.fetch;
  let sent = new Headers();
  globalThis.fetch = (_input, init) => {
    sent = new Headers(hasRequestHeaders(init) ? init.headers : undefined);
    return Promise.resolve(
      new Response("event: RunFinished\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  };

  let latest: UseChatResult | null = null;
  function Capture(): null {
    latest = useChat(options);
    return null;
  }

  const root = createRoot(document.getElementById("root")!);
  try {
    flushSync(() => root.render(<Capture />));
    await latest!.sendMessage({ text: "hello" });
    await settle();
    return sent;
  } finally {
    flushSync(() => root.unmount());
    await settle();
    globalThis.fetch = originalFetch;
  }
}

describe("react/agent/useChat CSRF double-submit", () => {
  it("sends the __Host-vf_csrf cookie back as x-csrf-token", async () => {
    const restoreDom = installDom();
    try {
      document.cookie = "__Host-vf_csrf=production-token; Path=/; Secure";
      const headers = await captureSendHeaders({ api: "/api/ag-ui" });
      assertEquals(headers.get("x-csrf-token"), "production-token");
    } finally {
      restoreDom();
    }
  });

  it("leaves the header alone when the page has no CSRF cookie", async () => {
    const restoreDom = installDom();
    try {
      const headers = await captureSendHeaders({ api: "/api/ag-ui" });
      assertEquals(headers.get("x-csrf-token"), null);
    } finally {
      restoreDom();
    }
  });

  it("keeps a caller-supplied token instead of overwriting it", async () => {
    const restoreDom = installDom();
    try {
      document.cookie = "__Host-vf_csrf=cookie-token; Path=/; Secure";
      const headers = await captureSendHeaders({
        api: "/api/ag-ui",
        headers: { "x-csrf-token": "caller-token" },
      });
      assertEquals(headers.get("x-csrf-token"), "caller-token");
    } finally {
      restoreDom();
    }
  });

  it("does not leak the token to a cross-origin chat endpoint", async () => {
    const restoreDom = installDom();
    try {
      document.cookie = "__Host-vf_csrf=production-token; Path=/; Secure";
      const headers = await captureSendHeaders({ api: "https://other.test/api/ag-ui" });
      assertEquals(headers.get("x-csrf-token"), null);
    } finally {
      restoreDom();
    }
  });
});
