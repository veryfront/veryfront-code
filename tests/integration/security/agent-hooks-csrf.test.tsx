/**
 * The double-submit token on the rest of the exported agent hook family.
 *
 * `useChat` was migrated to `csrfMutationHeaders` first, and the three hooks
 * here were left behind. That gap was invisible while `veryfront dev` skipped
 * the check: a deployed build answered `403` and a local one did not. Now that
 * local development enforces the same contract, a hook that omits the header
 * fails on the developer's own machine, so each one is pinned here.
 */
import "#veryfront/schemas/_test-setup.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { useAgent } from "#veryfront/agent/react/use-agent.ts";
import { useCompletion } from "#veryfront/agent/react/use-completion.ts";
import { useStreaming } from "#veryfront/agent/react/use-streaming.ts";

const PAGE = '<!doctype html><html><body><div id="root"></div></body></html>';
const PAGE_URL = "https://example.test/";

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

function hasRequestHeaders(value: unknown): value is { headers?: HeadersInit } {
  return typeof value === "object" && value !== null && "headers" in value;
}

function jsonResponse(): Response {
  return new Response(
    JSON.stringify({ messages: [], toolCalls: [], status: "completed" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function streamResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/plain" } },
  );
}

/**
 * Render a component that calls one hook, drive the mutation it hands back,
 * and return the request URL and headers the hook's own `fetch` produced.
 *
 * `cookie` is written to `document.cookie` before the render, because
 * `csrfMutationHeaders` reads the token from the document the hook runs in.
 */
async function captureMutation(
  renderHook: () => () => Promise<void>,
  respond: () => Response,
  cookie?: string,
): Promise<{ headers: Headers; url: string }> {
  const dom = new JSDOM(PAGE, { url: PAGE_URL });
  const restoreDom = installComponentDom(dom, {});
  if (cookie) document.cookie = cookie;

  let headers = new Headers();
  let url = "";
  const mockFetch = (input: Request | URL | string, init?: RequestInit) => {
    url = String(input);
    headers = new Headers(hasRequestHeaders(init) ? init.headers : undefined);
    return Promise.resolve(respond());
  };

  try {
    return await withMockFetch(mockFetch as typeof globalThis.fetch, async () => {
      let mutate: (() => Promise<void>) | null = null;
      function Capture(): null {
        mutate = renderHook();
        return null;
      }

      const root = createRoot(document.getElementById("root")!);
      try {
        flushSync(() => root.render(<Capture />));
        await mutate!();
        await settle();
        return { headers, url };
      } finally {
        flushSync(() => root.unmount());
        await settle();
      }
    });
  } finally {
    restoreDom();
    dom.window.close();
  }
}

describe("agent/react hook CSRF double-submit", () => {
  it("useAgent echoes the token cookie on its agent POST", async () => {
    const { headers, url } = await captureMutation(
      () => {
        const agent = useAgent({ agent: "support" });
        return () => agent.invoke("hello");
      },
      jsonResponse,
      "__Host-vf_csrf=agent-token; Path=/; Secure",
    );

    assertEquals(
      url,
      "/api/agents/support",
      "useAgent must keep posting to its own agent route",
    );
    assertEquals(
      headers.get("x-csrf-token"),
      "agent-token",
      "useAgent must echo __Host-vf_csrf or every invoke answers 403",
    );
  });

  it("useAgent omits the header when the page holds no token cookie", async () => {
    const { headers } = await captureMutation(() => {
      const agent = useAgent({ agent: "support" });
      return () => agent.invoke("hello");
    }, jsonResponse);

    assertEquals(
      headers.get("x-csrf-token"),
      null,
      "with no cookie to echo there is no token, and the server stays fail-closed",
    );
  });

  it("useStreaming echoes the token cookie on its stream POST", async () => {
    const { headers } = await captureMutation(
      () => {
        const stream = useStreaming({ url: "/api/stream" });
        return () => stream.start({ prompt: "hello" });
      },
      streamResponse,
      "__Host-vf_csrf=stream-token; Path=/; Secure",
    );

    assertEquals(
      headers.get("x-csrf-token"),
      "stream-token",
      "useStreaming must echo __Host-vf_csrf or every stream answers 403",
    );
  });

  it("useStreaming does not leak the token to a cross-origin stream URL", async () => {
    const { headers } = await captureMutation(
      () => {
        const stream = useStreaming({ url: "https://other.test/api/stream" });
        return () => stream.start();
      },
      streamResponse,
      "__Host-vf_csrf=stream-token; Path=/; Secure",
    );

    assertEquals(
      headers.get("x-csrf-token"),
      null,
      "a cross-origin stream endpoint must never receive this origin's token",
    );
  });

  it("useCompletion echoes the token cookie on its completion POST", async () => {
    const { headers } = await captureMutation(
      () => {
        const completion = useCompletion({ api: "/api/completion" });
        return () => completion.complete("hello");
      },
      streamResponse,
      "__Host-vf_csrf=completion-token; Path=/; Secure",
    );

    assertEquals(
      headers.get("x-csrf-token"),
      "completion-token",
      "useCompletion must echo __Host-vf_csrf or every completion answers 403",
    );
  });

  it("useCompletion keeps a caller-supplied token instead of overwriting it", async () => {
    const { headers } = await captureMutation(
      () => {
        const completion = useCompletion({
          api: "/api/completion",
          headers: { "x-csrf-token": "caller-token" },
        });
        return () => completion.complete("hello");
      },
      streamResponse,
      "__Host-vf_csrf=cookie-token; Path=/; Secure",
    );

    assertEquals(
      headers.get("x-csrf-token"),
      "caller-token",
      "the documented headers escape hatch must still win over the cookie",
    );
  });
});
