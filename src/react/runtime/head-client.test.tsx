import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Head } from "./core.ts";

function installDom(): () => void {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
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
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Head client management", () => {
  it("installs dangerouslySetInnerHTML as inline script content", async () => {
    const restore = installDom();
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const root = createRoot(rootElement);
      const content = 'globalThis.__head_value = "</script>";';

      flushSync(() => {
        root.render(
          <Head>
            <script dangerouslySetInnerHTML={{ __html: content }} />
          </Head>,
        );
      });
      await nextTask();

      const script = document.head.querySelector<HTMLScriptElement>(
        'script[data-veryfront-managed="1"]',
      );
      assert(script);
      assertEquals(script.textContent, content);
      assertEquals(script.hasAttribute("dangerouslysetinnerhtml"), false);

      root.unmount();
    } finally {
      restore();
    }
  });

  it("deduplicates script identities without interpolating them into selectors", async () => {
    const restore = installDom();
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const root = createRoot(rootElement);
      const id = 'analytics"] [data-probe="';
      const firstSrc = '/asset.js?value="quoted"';
      const secondSrc = '/other.js?value="quoted"';

      flushSync(() => {
        root.render(
          <>
            <Head>
              <script id={id} src={firstSrc} />
            </Head>
            <Head>
              <script id={id} src={secondSrc} />
            </Head>
          </>,
        );
      });
      await nextTask();

      const scripts = document.head.querySelectorAll<HTMLScriptElement>(
        'script[data-veryfront-managed="1"]',
      );
      assertEquals(scripts.length, 1);
      assertEquals(scripts[0]?.id, id);
      assertEquals(scripts[0]?.getAttribute("src"), firstSrc);

      root.unmount();
    } finally {
      restore();
    }
  });

  it("does not materialize lowercase event attributes or invoke raw-content accessors", async () => {
    const restore = installDom();
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

      root.unmount();
    } finally {
      restore();
    }
  });
});
