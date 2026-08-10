import React from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applyHeadDirectives, executeScripts } from "#veryfront/routing/client/dom-utils.ts";
import { escapeManagedHeadRawText } from "#veryfront/html/managed-head-protocol.ts";
import { retireClientHeadOwnership } from "#veryfront/html/client-head-manager.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import { wrapWithServerRenderContext } from "#veryfront/react/server-render-context.ts";
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
    { url: "https://example.com/" },
  );
  const window = dom.window;
  const restoreScriptExecution = options.runScripts
    ? installInlineScriptExecution(window)
    : () => {};
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
      restoreScriptExecution();
      for (const key of keys) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      dom.window.close();
    },
  };
}

function installInlineScriptExecution(
  window: InstanceType<typeof JSDOM>["window"],
): () => void {
  const executedScripts = new WeakSet<HTMLScriptElement>();
  const execute = (node: Node): void => {
    if (!(node instanceof window.HTMLScriptElement) || !node.isConnected) return;
    const script = node as HTMLScriptElement;
    if (executedScripts.has(script)) return;
    executedScripts.add(script);

    const type = (script.getAttribute("type") ?? "").trim().toLowerCase();
    if (
      script.hasAttribute("src") ||
      (type !== "" && type !== "text/javascript" && type !== "application/javascript")
    ) return;

    new Function("window", "document", script.textContent ?? "")(
      window,
      window.document,
    );
  };

  for (const script of window.document.querySelectorAll("script")) execute(script);

  const nodePrototype = window.Node.prototype;
  const appendChild = nodePrototype.appendChild;
  const insertBefore = nodePrototype.insertBefore;
  const replaceChild = nodePrototype.replaceChild;
  nodePrototype.appendChild = function <T extends Node>(child: T): T {
    const appended = appendChild.call(this, child) as T;
    execute(appended);
    return appended;
  };
  nodePrototype.insertBefore = function <T extends Node>(
    child: T,
    reference: Node | null,
  ): T {
    const inserted = insertBefore.call(this, child, reference) as T;
    execute(inserted);
    return inserted;
  };
  nodePrototype.replaceChild = function <T extends Node>(child: Node, oldChild: T): T {
    const replaced = replaceChild.call(this, child, oldChild) as T;
    execute(child);
    return replaced;
  };

  return () => {
    nodePrototype.appendChild = appendChild;
    nodePrototype.insertBefore = insertBefore;
    nodePrototype.replaceChild = replaceChild;
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

describe("Head client management", () => {
  it("suppresses the expected server-only commit-token difference during hydration", async () => {
    const children = <title>Hydrated managed head</title>;
    const { result: serverMarkup } = await runWithHeadCollector((renderContext) =>
      renderToString(wrapWithServerRenderContext(<Head>{children}</Head>, renderContext))
    );
    assert(
      serverMarkup.includes("data-vf-server-head-commit="),
      "Expected SSR to emit a server-only managed-head commit token",
    );

    const { restore } = installDom({
      body: `<div id="root">${serverMarkup}</div>`,
    });
    const recoverableErrors: unknown[] = [];
    const consoleErrors: unknown[][] = [];
    const previousConsoleError = console.error;
    let root: Root | undefined;
    console.error = (...args: unknown[]) => consoleErrors.push(args);

    try {
      root = hydrateRoot(rootElement(), <Head>{children}</Head>, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await waitFor(() => document.title === "Hydrated managed head");
      await nextTask();

      assertEquals(recoverableErrors, []);
      assertEquals(consoleErrors, []);
    } finally {
      console.error = previousConsoleError;
      await unmountReactRoot(root);
      restore();
    }
  });

  it("adopts explicit shell singletons late and restores their baseline on unmount", async () => {
    const { restore } = installDom({
      head: `
        <title data-vf-shell-head="true">Shell title</title>
        <meta data-vf-shell-head="true" name="description" content="Shell description">
        <link data-vf-shell-head="true" rel="canonical" href="https://example.com/shell">
        <meta id="third-party" name="description" content="Third party">`,
    });
    let root: Root | undefined;
    try {
      const shellTitle = document.head.querySelector('title[data-vf-shell-head="true"]');
      const shellDescription = document.head.querySelector(
        'meta[data-vf-shell-head="true"][name="description"]',
      );
      const shellCanonical = document.head.querySelector(
        'link[data-vf-shell-head="true"][rel="canonical"]',
      );
      const thirdParty = document.getElementById("third-party");
      assert(shellTitle && shellDescription && shellCanonical && thirdParty);

      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <Head>
            <title>Client title</title>
            <meta name="description" content="Client description" />
            <link rel="canonical" href="https://example.com/client" />
          </Head>,
        );
      });
      await waitFor(() => shellTitle.getAttribute("data-vf-react-head") === "true");

      assertStrictEquals(document.head.querySelector("title"), shellTitle);
      assertStrictEquals(
        document.head.querySelector('meta[name="description"]'),
        shellDescription,
      );
      assertStrictEquals(document.head.querySelector('link[rel="canonical"]'), shellCanonical);
      assertEquals(document.title, "Client title");
      assertEquals(shellDescription.getAttribute("content"), "Client description");
      assertEquals(shellCanonical.getAttribute("href"), "https://example.com/client");
      assertEquals(thirdParty.getAttribute("data-vf-react-head"), null);
      assertEquals(thirdParty.getAttribute("content"), "Third party");

      await unmountReactRoot(root);
      root = undefined;

      assertStrictEquals(document.head.querySelector("title"), shellTitle);
      assertStrictEquals(
        document.head.querySelector('meta[name="description"]'),
        shellDescription,
      );
      assertStrictEquals(document.head.querySelector('link[rel="canonical"]'), shellCanonical);
      assertEquals(document.title, "Shell title");
      assertEquals(shellDescription.getAttribute("content"), "Shell description");
      assertEquals(shellCanonical.getAttribute("href"), "https://example.com/shell");
      for (const element of [shellTitle, shellDescription, shellCanonical]) {
        assertEquals(element.getAttribute("data-vf-shell-head"), "true");
        assertEquals(element.getAttribute("data-vf-head"), null);
        assertEquals(element.getAttribute("data-vf-react-head"), null);
        assertEquals(element.getAttribute("data-veryfront-managed"), null);
      }
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("discards an adopted shell baseline on route ownership retirement", async () => {
    const { restore } = installDom({
      head: '<title data-vf-shell-head="true">Previous</title>' +
        '<meta data-vf-shell-head="true" name="description" content="Previous">',
    });
    let root: Root | undefined;
    try {
      const previousTitle = document.head.querySelector("title");
      const previousMeta = document.head.querySelector('meta[name="description"]');
      assert(previousTitle && previousMeta);

      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <Head>
            <title>React</title>
            <meta name="description" content="React" />
          </Head>,
        );
      });
      await waitFor(() => previousTitle.getAttribute("data-vf-react-head") === "true");

      retireClientHeadOwnership(document);

      assertEquals(previousTitle.isConnected, false);
      assertEquals(previousMeta.isConnected, false);
      assertEquals(document.head.querySelector("title"), null);
      assertEquals(document.head.querySelector('meta[name="description"]'), null);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("adopts destination route directives and restores their baseline on unmount", async () => {
    const scriptContent = '{"source":"route"}';
    const { restore } = installDom({
      body: `<div id="root"></div><div id="route"><vf-head>
        <title>Route title</title>
        <meta name="description" content="Route description">
        <link rel="canonical" href="https://example.com/route">
        <script id="route-state" type="application/json">${scriptContent}</script>
      </vf-head></div>`,
    });
    let root: Root | undefined;
    try {
      const routeContainer = document.getElementById("route");
      assert(routeContainer instanceof HTMLElement);
      applyHeadDirectives(routeContainer);

      const routeTitle = document.head.querySelector("title");
      const routeDescription = document.head.querySelector('meta[name="description"]');
      const routeCanonical = document.head.querySelector('link[rel="canonical"]');
      const routeScript = document.getElementById("route-state");
      assert(routeTitle && routeDescription && routeCanonical && routeScript);
      for (const element of [routeTitle, routeDescription, routeCanonical, routeScript]) {
        assertEquals(element.getAttribute("data-vf-route-head"), "true");
      }

      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <Head>
            <title>Route title</title>
            <meta name="description" content="Route description" />
            <link rel="canonical" href="https://example.com/route" />
            <script
              id="route-state"
              type="application/json"
              dangerouslySetInnerHTML={{ __html: scriptContent }}
            />
          </Head>,
        );
      });
      await waitFor(() => routeTitle.getAttribute("data-vf-react-head") === "true");

      assertStrictEquals(document.head.querySelector("title"), routeTitle);
      assertStrictEquals(document.head.querySelector('meta[name="description"]'), routeDescription);
      assertStrictEquals(document.head.querySelector('link[rel="canonical"]'), routeCanonical);
      assertStrictEquals(document.getElementById("route-state"), routeScript);
      assertEquals(document.head.querySelectorAll("title").length, 1);
      assertEquals(document.head.querySelectorAll('meta[name="description"]').length, 1);
      assertEquals(document.head.querySelectorAll('link[rel="canonical"]').length, 1);
      assertEquals(document.head.querySelectorAll("#route-state").length, 1);

      await unmountReactRoot(root);
      root = undefined;

      for (const element of [routeTitle, routeDescription, routeCanonical, routeScript]) {
        assertEquals(element.isConnected, true);
        assertEquals(element.getAttribute("data-vf-route-head"), "true");
        assertEquals(element.getAttribute("data-veryfront-managed"), "1");
        assertEquals(element.getAttribute("data-vf-head"), null);
        assertEquals(element.getAttribute("data-vf-react-head"), null);
      }
      assertEquals(document.title, "Route title");
      assertEquals(routeDescription.getAttribute("content"), "Route description");
      assertEquals(routeCanonical.getAttribute("href"), "https://example.com/route");
      assertEquals(routeScript.textContent, scriptContent);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("does not reexecute a mismatched route-directive script on first React adoption", async () => {
    const { dom, restore } = installDom({
      runScripts: "dangerously",
      body: `<div id="root"></div><div id="route"><vf-head>
        <script id="route-exec">window.__routeExecRuns=(window.__routeExecRuns||0)+1;</script>
      </vf-head></div>`,
    });
    let root: Root | undefined;
    try {
      const scriptWindow = dom.window as typeof dom.window & { __routeExecRuns?: number };
      const routeContainer = document.getElementById("route");
      assert(routeContainer instanceof HTMLElement);
      applyHeadDirectives(routeContainer);
      const routeScript = document.getElementById("route-exec");
      assert(routeScript);
      const executionsBeforeReactAdoption = scriptWindow.__routeExecRuns;
      assert(typeof executionsBeforeReactAdoption === "number");

      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <Head>
            <script id="route-exec">
              {"window.__routeExecRuns=(window.__routeExecRuns||0)+100;"}
            </script>
          </Head>,
        );
      });
      await waitFor(() => routeScript.getAttribute("data-vf-react-head") === "true");

      assertEquals(scriptWindow.__routeExecRuns, executionsBeforeReactAdoption);
      assertEquals(document.head.querySelectorAll("#route-exec").length, 1);
      assertStrictEquals(document.getElementById("route-exec"), routeScript);

      await unmountReactRoot(root);
      root = undefined;

      assertEquals(scriptWindow.__routeExecRuns, executionsBeforeReactAdoption);
      assertEquals(routeScript.getAttribute("data-vf-route-head"), "true");
      assertEquals(
        routeScript.textContent,
        "window.__routeExecRuns=(window.__routeExecRuns||0)+1;",
      );
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("retires page head while preserving app-wide viewport and manifest state", async () => {
    const { restore } = installDom({
      head: `
        <title data-vf-shell-head="true">Previous title</title>
        <meta data-vf-shell-head="true" name="description" content="Previous description">
        <link data-vf-shell-head="true" rel="canonical" href="https://example.com/previous">
        <meta data-vf-shell-head="true" name="viewport" content="width=device-width">
        <style data-veryfront-managed="1">.previous{color:red}</style>
        <meta id="third-party" name="author" content="Third party">`,
    });
    let root: Root | undefined;
    try {
      const shellViewport = document.head.querySelector('meta[name="viewport"]');
      const thirdParty = document.getElementById("third-party");
      assert(shellViewport && thirdParty);

      root = createRoot(rootElement());
      flushSync(() => {
        root?.render(
          <Head>
            <meta name="viewport" content="width=900" />
            <link rel="manifest" href="/app.webmanifest" />
          </Head>,
        );
      });
      await waitFor(() =>
        document.head.querySelector('link[rel="manifest"]')?.getAttribute(
          "data-vf-react-head",
        ) === "true"
      );

      const managedManifest = document.head.querySelector('link[rel="manifest"]');
      assert(managedManifest);
      assertStrictEquals(document.head.querySelector('meta[name="viewport"]'), shellViewport);
      assertEquals(shellViewport.getAttribute("content"), "width=900");

      retireClientHeadOwnership(document);

      assertEquals(document.head.querySelector("title"), null);
      assertEquals(document.head.querySelector('meta[name="description"]'), null);
      assertEquals(document.head.querySelector('link[rel="canonical"]'), null);
      assertEquals(document.head.querySelector("style"), null);
      assertStrictEquals(document.head.querySelector('meta[name="viewport"]'), shellViewport);
      assertEquals(shellViewport.getAttribute("content"), "width=device-width");
      assertEquals(shellViewport.getAttribute("data-vf-shell-head"), "true");
      assertStrictEquals(document.head.querySelector('link[rel="manifest"]'), managedManifest);
      assertEquals(managedManifest.getAttribute("data-vf-shell-head"), "true");
      assertEquals(managedManifest.getAttribute("data-vf-react-head"), null);
      assertStrictEquals(document.getElementById("third-party"), thirdParty);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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

      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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

      await unmountReactRoot(root);
      root = undefined;
      assertEquals(document.head.querySelectorAll('[data-vf-react-head="true"]').length, 0);
      assertEquals(document.head.querySelector("title"), null);
      assertEquals(document.head.querySelector('meta[name="description"]'), null);
      assertEquals(document.head.querySelector('link[rel="canonical"]'), null);
      assertEquals(document.head.querySelector("style"), null);
      assertEquals(document.head.querySelector("#stable"), null);
    } finally {
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(rootA);
      await unmountReactRoot(rootB);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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
      await unmountReactRoot(root);
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

  it("does not materialize lowercase event attributes or invoke raw-content accessors", async () => {
    const { restore } = installDom();
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const root = createRoot(rootElement);
      let accessorCalls = 0;
      const rawHTML = Object.create(null) as { __html?: string };
      Object.defineProperty(rawHTML, "__html", {
        configurable: true,
        get() {
          accessorCalls += 1;
          return "globalThis.__unexpected = true";
        },
      });

      flushSync(() => {
        root.render(
          <Head>
            <meta
              name="head-event-probe"
              content="safe"
              {...({ onclick: "globalThis.__unexpected = true" } as Record<string, string>)}
            />
            <script dangerouslySetInnerHTML={rawHTML as { __html: string }} />
          </Head>,
        );
      });
      await nextTask();

      const meta = document.head.querySelector<HTMLMetaElement>(
        'meta[name="head-event-probe"]',
      );
      assert(meta);
      assertEquals(meta.hasAttribute("onclick"), false);
      assertEquals(accessorCalls, 0);

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });
});
