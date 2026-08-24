import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { type ComponentDomOptions, installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { Head } from "../Head.tsx";
import { ChatStyleProvider } from "./chat-style-provider.tsx";
import { ChatRoot } from "./chat/composition/chat-root.tsx";
import { ColorModeScript } from "../ui/color-mode.tsx";
import { DesignTokenStyle } from "../ui/tokens.tsx";
import { runWithHeadCollector } from "../../head-collector.ts";
import { setupSSRGlobals } from "#veryfront/rendering/ssr-globals.ts";

const TEST_NONCE = "nonce-123";

function injectNonceIntoStyleTags(html: string, nonce: string): string {
  return html.replaceAll("<style", `<style nonce="${nonce}"`);
}

function injectNonceIntoInlineTags(html: string, nonce: string): string {
  return html
    .replaceAll("<style", `<style nonce="${nonce}"`)
    .replaceAll("<script", `<script nonce="${nonce}"`);
}

const DOM_OPTIONS: ComponentDomOptions = {
  windowGlobals: [
    "self",
    "HTMLStyleElement",
    "HTMLTextAreaElement",
    "MutationObserver",
  ],
};

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const startedAt = Date.now();

  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for hydrated state");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function flushHydrationTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function hydrateAndReadStyleNonce(element: React.ReactElement): Promise<string | null> {
  const serverMarkup = injectNonceIntoStyleTags(renderToString(element), TEST_NONCE);
  const dom = new JSDOM(`<!doctype html><div id="root">${serverMarkup}</div>`, {
    url: "https://example.com/",
  });
  const restore = installComponentDom(dom, DOM_OPTIONS);

  try {
    const root = document.getElementById("root");
    assert(root, "Expected hydration root to exist");

    const hydratedRoot = hydrateRoot(root, element);
    await waitFor(() => document.querySelector('[data-hydrated="yes"]') !== null);

    const style = root.querySelector("style");
    assert(style, "Expected hydrated tree to contain an inline style tag");

    const nonce = style.getAttribute("nonce");
    await unmountReactRoot(hydratedRoot);
    await flushHydrationTimers();
    return nonce;
  } finally {
    restore();
  }
}

async function hydrateAndReadScriptNonce(element: React.ReactElement): Promise<string | null> {
  const serverMarkup = injectNonceIntoInlineTags(renderToString(element), TEST_NONCE);
  const dom = new JSDOM(`<!doctype html><div id="root">${serverMarkup}</div>`, {
    url: "https://example.com/",
  });
  const restore = installComponentDom(dom, DOM_OPTIONS);

  try {
    const root = document.getElementById("root");
    assert(root, "Expected hydration root to exist");

    const hydratedRoot = hydrateRoot(root, element);
    await waitFor(() => document.querySelector('[data-hydrated="yes"]') !== null);

    const script = root.querySelector("script");
    assert(script, "Expected hydrated tree to contain an inline script tag");

    const nonce = script.getAttribute("nonce");
    await unmountReactRoot(hydratedRoot);
    await flushHydrationTimers();
    return nonce;
  } finally {
    restore();
  }
}

async function hydrateAndReadManagedHeadStyleNonce(
  element: React.ReactElement,
): Promise<string | null> {
  const serverMarkup = renderToString(element);
  const dom = new JSDOM(
    `<!doctype html><html><head><style nonce="${TEST_NONCE}">.seed{color:black}</style></head><body><div id="root">${serverMarkup}</div></body></html>`,
    {
      url: "https://example.com/",
    },
  );
  const restore = installComponentDom(dom, DOM_OPTIONS);

  try {
    const root = document.getElementById("root");
    assert(root, "Expected hydration root to exist");

    const hydratedRoot = hydrateRoot(root, element);
    await waitFor(() => document.head.querySelector('style[data-veryfront-managed="1"]') !== null);

    const style = document.head.querySelector('style[data-veryfront-managed="1"]');
    assert(style, "Expected Head to append a managed inline style tag");

    const nonce = style.getAttribute("nonce");
    await unmountReactRoot(hydratedRoot);
    await flushHydrationTimers();
    return nonce;
  } finally {
    restore();
  }
}

function HydratingChatStyleProviderFixture(): React.ReactElement {
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div data-hydrated={hydrated ? "yes" : "no"}>
      <ChatStyleProvider>
        <div data-vf-chat="">hello</div>
      </ChatStyleProvider>
    </div>
  );
}

function HydratingChatRootFixture(): React.ReactElement {
  const [hydrated, setHydrated] = React.useState(false);
  const [input, setInput] = React.useState("");

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div data-hydrated={hydrated ? "yes" : "no"}>
      <ChatRoot
        messages={[]}
        input={input}
        setInput={setInput}
        onSubmit={(event) => event?.preventDefault()}
      >
        <textarea
          data-input-box=""
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </ChatRoot>
    </div>
  );
}

function HydratingHeadStyleFixture(): React.ReactElement {
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div data-hydrated={hydrated ? "yes" : "no"}>
      <Head>
        <style>{".vf-head-style{color:red}"}</style>
      </Head>
    </div>
  );
}

function HydratingColorModeScriptFixture(): React.ReactElement {
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div data-hydrated={hydrated ? "yes" : "no"}>
      <ColorModeScript />
    </div>
  );
}

describe("getDocumentNonce hydration behavior", () => {
  it("prefers the server render nonce when SSR globals install a document stub", async () => {
    setupSSRGlobals();
    const { result: html } = await runWithHeadCollector(
      () => renderToString(<DesignTokenStyle />),
      { nonce: TEST_NONCE },
    );

    assert(html.startsWith(`<style nonce="${TEST_NONCE}">`));
  });

  it("applies the isolated render nonce to framework-owned server styles", async () => {
    const { result: html } = await runWithHeadCollector(
      () => renderToString(<DesignTokenStyle />),
      { nonce: TEST_NONCE },
    );

    assert(html.startsWith(`<style nonce="${TEST_NONCE}">`));
  });

  it("applies the isolated render nonce to ColorModeScript during SSR", async () => {
    const { result: html } = await runWithHeadCollector(
      () => renderToString(<ColorModeScript />),
      { nonce: TEST_NONCE },
    );

    assert(html.startsWith(`<script nonce="${TEST_NONCE}">`));
  });

  it("preserves nonces on ChatStyleProvider style tags after hydration re-renders", async () => {
    const nonce = await hydrateAndReadStyleNonce(<HydratingChatStyleProviderFixture />);
    assertEquals(nonce, TEST_NONCE);
  });

  it("preserves nonces on ChatRoot style tags after hydration re-renders", async () => {
    const nonce = await hydrateAndReadStyleNonce(<HydratingChatRootFixture />);
    assertEquals(nonce, TEST_NONCE);
  });

  it("reuses the document nonce for Head-managed inline styles on the client", async () => {
    const nonce = await hydrateAndReadManagedHeadStyleNonce(<HydratingHeadStyleFixture />);
    assertEquals(nonce, TEST_NONCE);
  });

  it("preserves nonces on ColorModeScript after hydration re-renders", async () => {
    const nonce = await hydrateAndReadScriptNonce(<HydratingColorModeScriptFixture />);
    assertEquals(nonce, TEST_NONCE);
  });
});
