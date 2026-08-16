/**
 * Chat attachments must satisfy CSRF in a deployed environment.
 *
 * A production build defaults `security.csrf` to on, so the server rejects any
 * non-GET request that lacks an `x-csrf-token` header matching the
 * `__Host-vf_csrf` cookie. #3611 fixed the AG-UI chat turn itself, but
 * attachments travel over two *other* transports, and neither sent the token:
 *
 *   - `useUpload` — the one `<Chat uploadApi>` actually wires up
 *     (`app-mode-chat.tsx`, `controlled-chat.tsx`). Uploads over
 *     `XMLHttpRequest`, because fetch has no upload-progress event.
 *   - `useAttachments` — the durable uploads registry, exported from
 *     `veryfront/chat` for an "Uploads" surface. `POST {url}` to upload,
 *     `DELETE {url}?id=` to remove.
 *
 * So a deployed chat *with attachments* still answered 403 after #3611 — while
 * `veryfront dev` (CSRF off) kept working and hid the break.
 *
 * These tests drive the real hooks and pipe whatever they emit through the real
 * `CsrfHandler`, so they fail on an actual 403 rather than on a header
 * assertion. The registry's list `GET` is a safe method and needs no token.
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { CsrfHandler } from "#veryfront/security/http/csrf/csrf-handler.ts";
import { applyCsrfCookie } from "#veryfront/security/csrf/helpers.ts";
import type { HandlerContext } from "#veryfront/types";
import { useAttachments, type UseAttachmentsResult } from "./use-uploads-registry.ts";
import { useUpload, type UseUploadResult } from "./use-upload.ts";

const ORIGIN = "https://acme.veryfront.com";

function installDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `${ORIGIN}/`,
  });
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "localStorage",
    "File",
    "FormData",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value: (window as unknown as Record<string, unknown>)[key],
      writable: true,
    });
  }
  window.localStorage.clear();
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as unknown as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

function csrfCtx(): HandlerContext {
  return {
    projectDir: "/tmp/test",
    adapter: { env: { get: () => undefined } } as unknown as HandlerContext["adapter"],
    securityConfig: { csrf: true },
  } as HandlerContext;
}

/**
 * The document load that hands the browser its readable CSRF cookie. This runs
 * the real `applyCsrfCookie`, so the cookie the client reads here is the one
 * production actually issues — and if anyone ever flips that cookie to
 * HttpOnly, this throws instead of the fix silently becoming a no-op.
 */
function loadDocumentCookie(): void {
  const headers = new Headers();
  applyCsrfCookie(new Request(`${ORIGIN}/`, { headers: { accept: "text/html" } }), headers, true);
  const setCookie = headers.get("set-cookie") ?? "";
  if (/httponly/i.test(setCookie)) {
    throw new Error(`CSRF cookie is HttpOnly, client JS cannot read it: ${setCookie}`);
  }
  // jsdom enforces the `__Host-` prefix rules (Secure + Path=/ + no Domain)
  // exactly as a browser does, so the full attribute list matters.
  document.cookie = setCookie;
}

/**
 * Stand in for the browser + server edge: attaches the document's cookies the
 * way a same-origin `fetch` would, then runs the request through the real CSRF
 * handler before the upload endpoint would ever see it.
 */
function installCsrfEdge(
  endpoint: (req: Request) => Response,
): { restore: () => void; statuses: Map<string, number> } {
  const originalFetch = globalThis.fetch;
  const statuses = new Map<string, number>();
  const handler = new CsrfHandler();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), document.baseURI);
    const headers = new Headers(init?.headers);
    if (document.cookie) headers.set("cookie", document.cookie);
    const req = new Request(url, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body as BodyInit | undefined,
    });

    const result = await handler.handle(req, csrfCtx());
    const response = result.response ?? endpoint(req);
    statuses.set(`${req.method} ${url.pathname}`, response.status);
    return response;
  }) as typeof fetch;

  return { restore: () => (globalThis.fetch = originalFetch), statuses };
}

/**
 * The same edge, for the `XMLHttpRequest` transport `useUpload` uses. Whatever
 * headers the hook sets are replayed into a real `Request` and run through the
 * real CSRF handler, so a missing token shows up as an actual 403 status on the
 * XHR rather than as a header assertion.
 */
function installXhrCsrfEdge(): {
  restore: () => void;
  statuses: Map<string, number>;
  tokens: Map<string, string | null>;
} {
  const originalXhr = globalThis.XMLHttpRequest;
  const statuses = new Map<string, number>();
  const tokens = new Map<string, string | null>();
  const handler = new CsrfHandler();

  class EdgeXhr {
    #method = "GET";
    #url = "";
    #headers = new Headers();
    status = 0;
    responseText = "";
    responseURL = "";
    upload: { onprogress: (() => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;

    open(method: string, url: string): void {
      this.#method = method;
      this.#url = url;
    }
    setRequestHeader(key: string, value: string): void {
      this.#headers.set(key, value);
    }
    abort(): void {}
    send(body?: BodyInit): void {
      void (async () => {
        const url = new URL(this.#url, document.baseURI);
        const headers = new Headers(this.#headers);
        tokens.set(`${this.#method} ${url.pathname}`, headers.get("x-csrf-token"));
        if (document.cookie) headers.set("cookie", document.cookie);
        const req = new Request(url, { method: this.#method, headers, body });

        const result = await handler.handle(req, csrfCtx());
        this.status = result.response?.status ?? 200;
        this.responseURL = url.href;
        this.responseText = result.response
          ? await result.response.text()
          : JSON.stringify({ id: "up-1", url: "/files/a.txt" });
        statuses.set(`${this.#method} ${url.pathname}`, this.status);
        this.onload?.();
      })();
    }
  }

  globalThis.XMLHttpRequest = EdgeXhr as unknown as typeof XMLHttpRequest;
  return { restore: () => (globalThis.XMLHttpRequest = originalXhr), statuses, tokens };
}

function renderUpload(
  options: Parameters<typeof useUpload>[0],
): { upload: () => UseUploadResult; unmount: () => Promise<void> } {
  let latest: UseUploadResult | null = null;
  function Capture(): null {
    latest = useUpload(options);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return { upload: () => latest!, unmount: () => unmountReactRoot(root) };
}

function renderAttachments(
  url: string,
): { attachments: () => UseAttachmentsResult; unmount: () => Promise<void> } {
  let latest: UseAttachmentsResult | null = null;
  function Capture(): null {
    latest = useAttachments({ url });
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    attachments: () => latest!,
    unmount: () => unmountReactRoot(root),
  };
}

describe("chat attachment CSRF", () => {
  // `<Chat uploadApi>` wires exactly this hook, so this is the transport the
  // advertised chat-with-attachments flow actually 403s on.
  it("sends the double-submit token on a <Chat uploadApi> upload", async () => {
    const restoreDom = installDom();
    loadDocumentCookie();
    const edge = installXhrCsrfEdge();
    const view = renderUpload({ api: "/api/uploads" });
    try {
      view.upload().upload([new File(["a"], "a.txt", { type: "text/plain" })]);
      await waitFor(() => edge.statuses.has("POST /api/uploads"));

      assertEquals(edge.statuses.get("POST /api/uploads"), 200);
    } finally {
      await view.unmount();
      edge.restore();
      restoreDom();
    }
  });

  it("does not leak the page CSRF token from <Chat uploadApi> cross-origin", async () => {
    const restoreDom = installDom();
    loadDocumentCookie();
    const edge = installXhrCsrfEdge();
    const view = renderUpload({ api: "https://uploads.example.net/api/uploads" });
    try {
      view.upload().upload([new File(["a"], "a.txt", { type: "text/plain" })]);
      await waitFor(() => edge.tokens.size > 0);

      assertEquals(edge.tokens.get("POST /api/uploads"), null);
    } finally {
      await view.unmount();
      edge.restore();
      restoreDom();
    }
  });

  it("sends the double-submit token on an attachment upload", async () => {
    const restoreDom = installDom();
    loadDocumentCookie();
    const edge = installCsrfEdge((req) =>
      req.method === "GET"
        ? Response.json({ items: [] })
        : Response.json({ id: "up-1", name: "a.txt", url: "/files/a.txt", size: 1 })
    );
    const view = renderAttachments("/api/uploads");
    try {
      view.attachments().upload([new File(["a"], "a.txt", { type: "text/plain" })]);
      await waitFor(() => edge.statuses.has("POST /api/uploads"));

      assertEquals(edge.statuses.get("POST /api/uploads"), 200);
    } finally {
      await view.unmount();
      edge.restore();
      restoreDom();
    }
  });

  it("sends the double-submit token on an attachment removal", async () => {
    const restoreDom = installDom();
    loadDocumentCookie();
    const edge = installCsrfEdge((req) =>
      req.method === "GET"
        ? Response.json({
          items: [{ id: "up-1", name: "a.txt", url: "/files/a.txt", size: 1 }],
        })
        : new Response(null, { status: 204 })
    );
    const view = renderAttachments("/api/uploads");
    try {
      await view.attachments().remove("up-1");
      await waitFor(() => edge.statuses.has("DELETE /api/uploads"));

      assertEquals(edge.statuses.get("DELETE /api/uploads"), 204);
    } finally {
      await view.unmount();
      edge.restore();
      restoreDom();
    }
  });

  it("does not leak the page CSRF token to a cross-origin upload endpoint", async () => {
    const restoreDom = installDom();
    loadDocumentCookie();
    const originalFetch = globalThis.fetch;
    let sentToken: string | null | undefined;

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") sentToken = new Headers(init?.headers).get("x-csrf-token");
      return Promise.resolve(
        method === "GET"
          ? Response.json({ items: [] })
          : Response.json({ id: "up-1", name: "a.txt", url: `${String(input)}/a.txt`, size: 1 }),
      );
    }) as typeof fetch;
    const view = renderAttachments("https://uploads.example.net/api/uploads");
    try {
      view.attachments().upload([new File(["a"], "a.txt", { type: "text/plain" })]);
      await waitFor(() => sentToken !== undefined);

      assertEquals(sentToken, null);
    } finally {
      await view.unmount();
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });
});
