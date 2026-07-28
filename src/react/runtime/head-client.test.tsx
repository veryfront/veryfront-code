import React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applyHeadDirectives, executeScripts } from "#veryfront/routing/client/dom-utils.ts";
import { escapeManagedHeadRawText } from "#veryfront/html/managed-head-protocol.ts";
import { Head } from "./core.ts";

const HEAD_PLACEHOLDER =
  '<div data-veryfront-head="1" data-vf-react-head-owner="1" style="display:none"></div>';

interface DomInstallOptions {
  readonly head?: string;
  readonly body?: string;
  readonly runScripts?: "dangerously";
}

function installDom(
  options: DomInstallOptions = {},
): { dom: JSDOM; restore: () => void } {
  const dom = new JSDOM(
    `<!doctype html><html><head>${options.head ?? ""}</head><body>${
      options.body ?? '<div id="root"></div>'
    }</body></html>`,
    {
      url: "https://example.com/",
      ...(options.runScripts && { runScripts: options.runScripts }),
    },
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
    "HTMLTemplateElement",
    "DocumentFragment",
    "Event",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }

  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLTemplateElement: window.HTMLTemplateElement,
    DocumentFragment: window.DocumentFragment,
    Event: window.Event,
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return {
    dom,
    restore: () => {
      for (const key of keys) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      dom.window.close();
    },
  };
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for hydrated Head state");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function rootElement(id = "root"): HTMLElement {
  const element = document.getElementById(id);
  assert(element instanceof HTMLElement);
  return element;
}

async function unmount(root: Root | undefined): Promise<void> {
  if (!root) return;
  flushSync(() => root.unmount());
  await nextTask();
}

describe("Head client management", () => {
  it("hydrates by adopting matching SSR title, meta, link, style, and script nodes", async () => {
    const scriptContent = 'window.__adopted = "</script>";';
    const { restore } = installDom({
      head: `
        <title data-vf-head="true">SSR title</title>
        <meta data-vf-head="true" name="description" content="SSR description">
        <link data-vf-head="true" rel="canonical" href="https://example.com/ssr">
        <style data-vf-head="true">.ssr{color:blue}</style>
        <script data-vf-head="true" id="ssr-script">${
        escapeManagedHeadRawText(scriptContent, "script")
      }</script>`,
      body: `<div id="root">${HEAD_PLACEHOLDER}</div>`,
    });
    let root: Root | undefined;
    try {
      const original = {
        title: document.head.querySelector("title"),
        meta: document.head.querySelector('meta[name="description"]'),
        link: document.head.querySelector('link[rel="canonical"]'),
        style: document.head.querySelector("style"),
        script: document.head.querySelector("#ssr-script"),
      };

      root = hydrateRoot(
        rootElement(),
        <Head>
          <title>SSR title</title>
          <meta name="description" content="SSR description" />
          <link rel="canonical" href="https://example.com/ssr" />
          <style>{".ssr{color:blue}"}</style>
          <script
            id="ssr-script"
            dangerouslySetInnerHTML={{ __html: scriptContent }}
          />
        </Head>,
      );
      await waitFor(() => original.script?.getAttribute("data-vf-react-head") === "true");

      assertStrictEquals(document.head.querySelector("title"), original.title);
      assertStrictEquals(
        document.head.querySelector('meta[name="description"]'),
        original.meta,
      );
      assertStrictEquals(
        document.head.querySelector('link[rel="canonical"]'),
        original.link,
      );
      assertStrictEquals(document.head.querySelector("style"), original.style);
      assertStrictEquals(document.head.querySelector("#ssr-script"), original.script);
      assertEquals(document.head.querySelectorAll("title").length, 1);
      assertEquals(document.head.querySelectorAll('meta[name="description"]').length, 1);
      assertEquals(document.head.querySelectorAll('link[rel="canonical"]').length, 1);
      assertEquals(document.head.querySelectorAll("style").length, 1);
      assertEquals(document.head.querySelectorAll("#ssr-script").length, 1);
      for (const element of Object.values(original)) {
        assert(element);
        assertEquals(element.getAttribute("data-vf-react-head"), "true");
        assertEquals(element.getAttribute("data-veryfront-managed"), "1");
      }
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("adopts the response nonce without restoring an authored nonce", async () => {
    const { restore } = installDom({
      head: '<style data-vf-head="true" nonce="response">.secure{display:block}</style>',
      body: `<div id="root">${HEAD_PLACEHOLDER}</div>`,
    });
    let root: Root | undefined;
    try {
      const original = document.head.querySelector("style");
      root = hydrateRoot(
        rootElement(),
        <Head>
          <style nonce="authored">{".secure{display:block}"}</style>
        </Head>,
      );
      await waitFor(() => original?.getAttribute("data-vf-react-head") === "true");

      assertStrictEquals(document.head.querySelector("style"), original);
      assertEquals(original?.getAttribute("nonce"), "response");
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("uses the rendered anchor document for registration, updates, nonce, and cleanup", async () => {
    const { restore } = installDom({
      head: '<style id="primary-csp" nonce="primary-nonce"></style>' +
        '<meta data-vf-head="true" name="author" content="Frame one">',
    });
    let root: Root | undefined;
    try {
      const primaryMeta = document.head.querySelector('meta[name="author"]');
      const iframe = document.createElement("iframe");
      document.body.appendChild(iframe);
      const frameDocument = iframe.contentDocument;
      assert(frameDocument);
      frameDocument.head.innerHTML = '<style id="frame-csp" nonce="frame-nonce"></style>';
      const mount = frameDocument.createElement("div");
      frameDocument.body.appendChild(mount);

      const frameHead = (
        title: string,
        author: string,
        style: string,
      ) => (
        <React.StrictMode>
          <Head>
            <title>{title}</title>
            <meta name="author" content={author} />
            <style nonce="authored-nonce">{style}</style>
          </Head>
        </React.StrictMode>
      );

      root = createRoot(mount);
      flushSync(() => {
        root?.render(frameHead("Frame one", "Frame one", ".one{}"));
      });
      await waitFor(() =>
        frameDocument.head
          .querySelector('meta[name="author"]')
          ?.getAttribute("data-vf-react-head") === "true"
      );

      assertEquals(frameDocument.title, "Frame one");
      assertEquals(
        frameDocument.head
          .querySelector('meta[name="author"]')
          ?.getAttribute("content"),
        "Frame one",
      );
      assertEquals(
        frameDocument.head
          .querySelector('style[data-vf-react-head="true"]')
          ?.getAttribute("nonce"),
        "frame-nonce",
      );
      assertStrictEquals(
        document.head.querySelector('meta[name="author"]'),
        primaryMeta,
      );
      assertEquals(
        primaryMeta?.getAttribute("data-vf-react-head"),
        null,
      );

      flushSync(() => {
        root?.render(frameHead("Frame two", "Frame two", ".two{}"));
      });
      await waitFor(() => frameDocument.title === "Frame two");
      assertEquals(
        frameDocument.head
          .querySelector('meta[name="author"]')
          ?.getAttribute("content"),
        "Frame two",
      );
      assertEquals(
        frameDocument.head
          .querySelector('style[data-vf-react-head="true"]')
          ?.textContent,
        ".two{}",
      );

      await unmount(root);
      root = undefined;
      assertEquals(
        frameDocument.head.querySelectorAll(
          '[data-vf-react-head="true"]',
        ).length,
        0,
      );
      assertEquals(
        frameDocument.head.querySelector("#frame-csp")?.isConnected,
        true,
      );
      assertStrictEquals(
        document.head.querySelector('meta[name="author"]'),
        primaryMeta,
      );
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("adopts canonical boolean-presence and data boolean attributes", async () => {
    const { restore } = installDom({
      head: '<script data-vf-head="true" id="presence" defer data-enabled="false"></script>',
      body: `<div id="root">${HEAD_PLACEHOLDER}</div>`,
    });
    let root: Root | undefined;
    try {
      const original = document.head.querySelector("#presence");
      const props = {
        id: "presence",
        defer: "defer",
        "data-enabled": false,
      } as unknown as React.ScriptHTMLAttributes<HTMLScriptElement>;
      root = hydrateRoot(
        rootElement(),
        <Head>{React.createElement("script", props)}</Head>,
      );
      await waitFor(() => original?.getAttribute("data-vf-react-head") === "true");

      assertStrictEquals(document.head.querySelector("#presence"), original);
      assertEquals(original?.getAttribute("defer"), "");
      assertEquals(original?.getAttribute("data-enabled"), "false");
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("adopts HTML-normalized newlines in text and attributes", async () => {
    const { restore } = installDom({
      head: '<meta data-vf-head="true" name="author" content="A\r\nB\rC">' +
        '<style data-vf-head="true">.a{\r\ncolor:red\r}</style>',
      body: `<div id="root">${HEAD_PLACEHOLDER}</div>`,
    });
    let root: Root | undefined;
    try {
      const windowsNewlines = "A\r\nB\rC";
      const originalMeta = document.head.querySelector('meta[name="author"]');
      const originalStyle = document.head.querySelector("style");
      root = hydrateRoot(
        rootElement(),
        <Head>
          <meta name="author" content={windowsNewlines} />
          <style>{".a{\r\ncolor:red\r}"}</style>
        </Head>,
      );
      await waitFor(() => originalStyle?.getAttribute("data-vf-react-head") === "true");

      assertStrictEquals(
        document.head.querySelector('meta[name="author"]'),
        originalMeta,
      );
      assertStrictEquals(document.head.querySelector("style"), originalStyle);
      assertEquals(originalMeta?.getAttribute("content"), "A\nB\nC");
      assertEquals(originalStyle?.textContent, ".a{\ncolor:red\n}");
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("leaves the shell-owned charset untouched", async () => {
    const { restore } = installDom({
      head: '<meta charset="UTF-8">',
    });
    let root: Root | undefined;
    try {
      const charset = document.head.querySelector("meta[charset]");
      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <Head>
            <meta charSet="utf-8" />
          </Head>,
        );
      });
      await nextTask();

      assertEquals(document.head.querySelectorAll("meta[charset]").length, 1);
      assertStrictEquals(document.head.querySelector("meta[charset]"), charset);
      assertEquals(charset?.hasAttribute("data-vf-react-head"), false);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("does not reexecute an adopted inline SSR script with escaped raw text", async () => {
    const content = 'window.__headRuns=(window.__headRuns||0)+1;window.__payload="</ScRiPt>";';
    const { dom, restore } = installDom({
      head: `<script data-vf-head="true" id="once">${
        escapeManagedHeadRawText(content, "script")
      }</script>`,
      body: `<div id="root">${HEAD_PLACEHOLDER}</div>`,
      runScripts: "dangerously",
    });
    let root: Root | undefined;
    try {
      const scriptWindow = dom.window as typeof dom.window & {
        __headRuns?: number;
        __payload?: string;
      };
      const original = document.head.querySelector("#once");
      assertEquals(scriptWindow.__headRuns, 1);

      root = hydrateRoot(
        rootElement(),
        <Head>
          <script id="once" dangerouslySetInnerHTML={{ __html: content }} />
        </Head>,
      );
      await waitFor(() => original?.getAttribute("data-vf-react-head") === "true");

      assertEquals(scriptWindow.__headRuns, 1);
      assertEquals(scriptWindow.__payload, "</ScRiPt>");
      assertStrictEquals(document.head.querySelector("#once"), original);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("retains a mismatched keyed SSR script during hydration and replaces only a later update", async () => {
    const serverContent = "window.__headRuns=(window.__headRuns||0)+1;";
    const hydrationContent = "window.__headRuns=(window.__headRuns||0)+10;";
    const updateContent = "window.__headRuns=(window.__headRuns||0)+100;";
    const { dom, restore } = installDom({
      head: `<script data-vf-head="true" id="versioned">${serverContent}</script>`,
      body: `<div id="root">${HEAD_PLACEHOLDER}</div>`,
      runScripts: "dangerously",
    });
    let root: Root | undefined;
    try {
      const scriptWindow = dom.window as typeof dom.window & {
        __headRuns?: number;
      };
      const original = document.head.querySelector("#versioned");
      root = hydrateRoot(
        rootElement(),
        <Head>
          <script
            id="versioned"
            dangerouslySetInnerHTML={{ __html: hydrationContent }}
          />
        </Head>,
      );
      await waitFor(() => original?.getAttribute("data-vf-react-head") === "true");

      assertEquals(scriptWindow.__headRuns, 1);
      assertStrictEquals(document.head.querySelector("#versioned"), original);

      flushSync(() => {
        root?.render(
          <Head>
            <script
              id="versioned"
              dangerouslySetInnerHTML={{ __html: updateContent }}
            />
          </Head>,
        );
      });
      await nextTask();

      assertEquals(scriptWindow.__headRuns, 101);
      assertNotStrictEquals(document.head.querySelector("#versioned"), original);
      assertEquals(document.head.querySelectorAll("#versioned").length, 1);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("reconciles updates in place where safe and removes all owned nodes on unmount", async () => {
    const scriptContent = "window.__updateRuns=(window.__updateRuns||0)+1;";
    const { dom, restore } = installDom({
      head: `
        <title data-vf-head="true">One</title>
        <meta data-vf-head="true" name="description" content="One">
        <link data-vf-head="true" rel="canonical" href="https://example.com/one">
        <style data-vf-head="true">.one{color:red}</style>
        <script data-vf-head="true" id="stable">${scriptContent}</script>`,
      body: `<div id="root">${HEAD_PLACEHOLDER}</div>`,
      runScripts: "dangerously",
    });
    let root: Root | undefined;
    try {
      const scriptWindow = dom.window as typeof dom.window & {
        __updateRuns?: number;
      };
      const originalTitle = document.head.querySelector("title");
      const originalMeta = document.head.querySelector('meta[name="description"]');
      const originalLink = document.head.querySelector('link[rel="canonical"]');
      const originalStyle = document.head.querySelector("style");
      const originalScript = document.head.querySelector("#stable");

      root = hydrateRoot(
        rootElement(),
        <Head>
          <title>One</title>
          <meta name="description" content="One" />
          <link rel="canonical" href="https://example.com/one" />
          <style>{".one{color:red}"}</style>
          <script
            id="stable"
            dangerouslySetInnerHTML={{ __html: scriptContent }}
          />
        </Head>,
      );
      await waitFor(() => originalScript?.getAttribute("data-vf-react-head") === "true");

      flushSync(() => {
        root?.render(
          <Head>
            <title>Two</title>
            <meta name="description" content="Two" />
            <link rel="canonical" href="https://example.com/two" />
            <style>{".two{color:blue}"}</style>
            <script
              id="stable"
              dangerouslySetInnerHTML={{ __html: scriptContent }}
            />
          </Head>,
        );
      });
      await nextTask();

      assertStrictEquals(document.head.querySelector("title"), originalTitle);
      assertStrictEquals(
        document.head.querySelector('meta[name="description"]'),
        originalMeta,
      );
      assertStrictEquals(
        document.head.querySelector('link[rel="canonical"]'),
        originalLink,
      );
      assertNotStrictEquals(document.head.querySelector("style"), originalStyle);
      assertStrictEquals(document.head.querySelector("#stable"), originalScript);
      assertEquals(document.title, "Two");
      assertEquals(originalMeta?.getAttribute("content"), "Two");
      assertEquals(originalLink?.getAttribute("href"), "https://example.com/two");
      assertEquals(document.head.querySelector("style")?.textContent, ".two{color:blue}");
      assertEquals(scriptWindow.__updateRuns, 1);

      await unmount(root);
      root = undefined;
      assertEquals(document.head.querySelectorAll('[data-vf-react-head="true"]').length, 0);
      assertEquals(document.head.querySelector("title"), null);
      assertEquals(document.head.querySelector('meta[name="description"]'), null);
      assertEquals(document.head.querySelector('link[rel="canonical"]'), null);
      assertEquals(document.head.querySelector("style"), null);
      assertEquals(document.head.querySelector("#stable"), null);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("preserves concurrent owner precedence, repeatable ordering, and fallback on removal", async () => {
    const { restore } = installDom();
    let root: Root | undefined;

    function LayoutHead() {
      return (
        <Head>
          <title>Layout</title>
          <link rel="canonical" href="https://example.com/layout" />
          <meta property="og:image" content="layout.jpg" />
          <script id="shared" src="/layout.js" />
        </Head>
      );
    }

    function PageHead() {
      return (
        <Head>
          <title>Page</title>
          <link rel="canonical" href="https://example.com/page" />
          <meta property="og:image" content="page.jpg" />
          <script id="shared" src="/page.js" />
        </Head>
      );
    }

    function Tree(
      { pageFirst = false, showPage = true }: {
        pageFirst?: boolean;
        showPage?: boolean;
      },
    ) {
      const layout = <LayoutHead key="layout" />;
      const page = showPage ? <PageHead key="page" /> : null;
      return <>{pageFirst ? [page, layout] : [layout, page]}</>;
    }

    const imageOrder = () =>
      [...document.head.querySelectorAll('meta[property="og:image"]')]
        .map((meta) => meta.getAttribute("content"));

    try {
      root = createRoot(rootElement());
      flushSync(() => root?.render(<Tree />));
      await nextTask();

      assertEquals(document.title, "Page");
      assertEquals(
        document.head.querySelector('link[rel="canonical"]')?.getAttribute("href"),
        "https://example.com/page",
      );
      assertEquals(imageOrder(), ["layout.jpg", "page.jpg"]);
      assertEquals(document.head.querySelectorAll("#shared").length, 1);
      assertEquals(document.head.querySelector("#shared")?.getAttribute("src"), "/layout.js");

      flushSync(() => root?.render(<Tree pageFirst />));
      await nextTask();
      assertEquals(document.title, "Layout");
      assertEquals(
        document.head.querySelector('link[rel="canonical"]')?.getAttribute("href"),
        "https://example.com/layout",
      );
      assertEquals(imageOrder(), ["page.jpg", "layout.jpg"]);
      assertEquals(document.head.querySelectorAll("#shared").length, 1);
      assertEquals(document.head.querySelector("#shared")?.getAttribute("src"), "/page.js");

      flushSync(() => root?.render(<Tree showPage={false} />));
      await nextTask();
      assertEquals(document.title, "Layout");
      assertEquals(imageOrder(), ["layout.jpg"]);
      assertEquals(document.head.querySelector("#shared")?.getAttribute("src"), "/layout.js");
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("reorders repeatable children when their declared order changes", async () => {
    const { restore } = installDom();
    let root: Root | undefined;
    const authors = () =>
      [...document.head.querySelectorAll('meta[name="author"]')]
        .map((meta) => meta.getAttribute("content"));

    const AuthorHead = ({ order }: { order: readonly string[] }) => (
      <Head>
        {order.map((author) => <meta key={author} name="author" content={author} />)}
      </Head>
    );

    try {
      root = createRoot(rootElement());
      flushSync(() => root?.render(<AuthorHead order={["A", "B"]} />));
      await nextTask();
      assertEquals(authors(), ["A", "B"]);

      flushSync(() => root?.render(<AuthorHead order={["B", "A"]} />));
      await nextTask();
      assertEquals(authors(), ["B", "A"]);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("reserves later exact anonymous scripts before fail-closed hydration fallback", async () => {
    const content = "window.__anonymousRuns=(window.__anonymousRuns||0)+1;";
    const { dom, restore } = installDom({
      head: `<script data-vf-head="true">${content}</script>`,
      body: `<div id="root">${HEAD_PLACEHOLDER}</div>`,
      runScripts: "dangerously",
    });
    let root: Root | undefined;
    try {
      const scriptWindow = dom.window as typeof dom.window & {
        __anonymousRuns?: number;
      };
      const original = document.head.querySelector("script");

      root = hydrateRoot(
        rootElement(),
        <Head>
          <script />
          <script dangerouslySetInnerHTML={{ __html: content }} />
        </Head>,
      );
      await waitFor(() => document.head.querySelectorAll("script").length === 2);

      assertEquals(scriptWindow.__anonymousRuns, 1);
      assertStrictEquals(
        [...document.head.querySelectorAll("script")].find((script) =>
          script.textContent === content
        ),
        original,
      );
      assertEquals(
        [...document.head.querySelectorAll("script")].filter((script) =>
          script.textContent === content
        ).length,
        1,
      );
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("keeps unmatched SSR nodes until every selective-hydration owner registers", async () => {
    const { restore } = installDom({
      head: `
        <meta data-vf-head="true" name="author" content="A">
        <meta data-vf-head="true" name="author" content="B">`,
      body: `
        <div id="root-a">${HEAD_PLACEHOLDER}</div>
        <div id="root-b">${HEAD_PLACEHOLDER}</div>`,
    });
    let rootA: Root | undefined;
    let rootB: Root | undefined;
    try {
      rootA = hydrateRoot(
        rootElement("root-a"),
        <Head>
          <meta name="author" content="A" />
        </Head>,
      );
      await waitFor(() =>
        document.head
          .querySelector('meta[name="author"][content="A"]')
          ?.getAttribute("data-vf-react-head") === "true"
      );

      assertEquals(
        document.head.querySelector('meta[name="author"][content="B"]') !== null,
        true,
      );

      rootB = hydrateRoot(rootElement("root-b"), <Head>{null}</Head>);
      await waitFor(() => document.head.querySelector('meta[name="author"][content="B"]') === null);
      assertEquals(
        document.head.querySelector('meta[name="author"][content="B"]'),
        null,
      );
      assertEquals(
        document.head.querySelectorAll('meta[name="author"]').length,
        1,
      );
    } finally {
      await unmount(rootA);
      await unmount(rootB);
      restore();
    }
  });

  it("rejects event/internal attributes and never adopts an unmarked hostile identity", async () => {
    const { restore } = installDom({
      head: '<script id="analytics&quot;] [data-probe=&quot;" src="/existing.js"></script>',
    });
    let root: Root | undefined;
    try {
      const id = 'analytics"] [data-probe="';
      const props = {
        id,
        src: '/asset.js?value="quoted"',
        onLoad: () => {
          throw new Error("must never serialize");
        },
        onload: "alert(1)",
        "DATA-VF-HEAD": "spoofed",
        "Data-Vf-Hash": "spoofed",
        "data-vf-react-head": "spoofed",
        "DATA-VF-REACT-HEAD-OWNER": "1",
      } as React.ScriptHTMLAttributes<HTMLScriptElement> & Record<string, unknown>;

      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <Head>
            {React.createElement("script", props)}
          </Head>,
        );
      });
      await nextTask();

      const scripts = [...document.head.querySelectorAll("script")];
      const managed = scripts.filter((script) =>
        script.getAttribute("data-vf-react-head") === "true"
      );
      assertEquals(scripts.length, 2);
      assertEquals(managed.length, 1);
      assertEquals(managed[0]?.id, id);
      assertEquals(managed[0]?.getAttribute("src"), '/asset.js?value="quoted"');
      assertEquals(managed[0]?.hasAttribute("onload"), false);
      assertEquals(managed[0]?.hasAttribute("data-vf-hash"), false);
      assertEquals(managed[0]?.hasAttribute("data-vf-react-head-owner"), false);
      assertEquals(
        document.querySelectorAll('[data-vf-react-head-owner="1"]').length,
        1,
      );
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("executes a StrictMode inline script only once across effect replay", async () => {
    const { dom, restore } = installDom({ runScripts: "dangerously" });
    let root: Root | undefined;
    try {
      const scriptWindow = dom.window as typeof dom.window & {
        __strictRuns?: number;
      };
      const content = "window.__strictRuns=(window.__strictRuns||0)+1;";
      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <React.StrictMode>
            <Head>
              <script
                id="strict-once"
                dangerouslySetInnerHTML={{ __html: content }}
              />
            </Head>
          </React.StrictMode>,
        );
      });
      await nextTask();

      assertEquals(scriptWindow.__strictRuns, 1);
      assertEquals(document.head.querySelectorAll("#strict-once").length, 1);
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("hands authority to route head directives without leaving React singletons", async () => {
    const { restore } = installDom();
    let root: Root | undefined;
    try {
      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <Head>
            <link rel="canonical" href="https://example.com/react" />
          </Head>,
        );
      });
      await nextTask();
      const reactCanonical = document.head.querySelector(
        'link[rel="canonical"]',
      );
      assert(reactCanonical);

      const container = document.createElement("section");
      const directive = document.createElement("vf-head");
      const routeCanonical = document.createElement("link");
      routeCanonical.setAttribute("rel", "canonical");
      routeCanonical.setAttribute("href", "https://example.com/route");
      directive.appendChild(routeCanonical);
      container.appendChild(directive);
      document.body.appendChild(container);

      applyHeadDirectives(container);

      const canonicalLinks = document.head.querySelectorAll(
        'link[rel="canonical"]',
      );
      assertEquals(canonicalLinks.length, 1);
      assertEquals(
        canonicalLinks[0]?.getAttribute("href"),
        "https://example.com/route",
      );
      assertEquals(reactCanonical.isConnected, false);
      assertEquals(
        document.head.querySelector('[data-vf-react-head="true"]'),
        null,
      );
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("executes route head and body scripts exactly once each", () => {
    const { dom, restore } = installDom({ runScripts: "dangerously" });
    try {
      const scriptWindow = dom.window as typeof dom.window & {
        __routeHeadRuns?: number;
        __routeBodyRuns?: number;
      };
      const container = document.createElement("section");
      container.innerHTML = `
        <vf-head>
          <script>window.__routeHeadRuns=(window.__routeHeadRuns||0)+1;</script>
        </vf-head>
        <script>window.__routeBodyRuns=(window.__routeBodyRuns||0)+1;</script>
      `;
      document.body.appendChild(container);

      applyHeadDirectives(container);
      executeScripts(container);

      assertEquals(scriptWindow.__routeHeadRuns, 1);
      assertEquals(scriptWindow.__routeBodyRuns, 1);
    } finally {
      restore();
    }
  });
});
