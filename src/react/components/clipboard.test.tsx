import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { assert, assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ComponentDomOptions, installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { type ClipboardFeedback, copyTextToClipboard, useClipboardFeedback } from "./clipboard.ts";

function defineClipboard(
  window: JSDOM["window"],
  writeText: (text: string) => Promise<void>,
): void {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

const DOM_OPTIONS: ComponentDomOptions = {
  windowGlobals: ["self"],
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

describe("copyTextToClipboard", () => {
  it("uses the Clipboard API without creating a fallback element", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const writes: string[] = [];
    defineClipboard(dom.window, (text) => {
      writes.push(text);
      return Promise.resolve();
    });
    let fallbackCalls = 0;
    Object.defineProperty(dom.window.document, "execCommand", {
      configurable: true,
      value: () => {
        fallbackCalls += 1;
        return true;
      },
    });

    try {
      assertStrictEquals(
        await copyTextToClipboard("const answer = 42;", dom.window.document),
        true,
      );
      assertEquals(writes, ["const answer = 42;"]);
      assertEquals(fallbackCalls, 0);
      assertEquals(dom.window.document.querySelectorAll("textarea").length, 0);
    } finally {
      dom.window.close();
    }
  });

  it("cleans up the fallback and restores focus and selection", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><button id="copy">Copy</button><span id="selected">selected text</span></body></html>',
    );
    defineClipboard(dom.window, () => Promise.reject(new Error("permission denied")));
    const document = dom.window.document;
    const button = document.getElementById("copy") as HTMLButtonElement;
    const selected = document.getElementById("selected");
    assert(selected, "selection fixture exists");
    button.focus();

    let fallbackValue: string | undefined;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        fallbackValue = document.querySelector<HTMLTextAreaElement>("textarea")?.value;
        return true;
      },
    });

    try {
      assertStrictEquals(await copyTextToClipboard("fallback", document), true);
      assertEquals(fallbackValue, "fallback");
      assertEquals(document.querySelectorAll("textarea").length, 0);
      assertStrictEquals(document.activeElement, button);

      button.blur();
      const range = document.createRange();
      range.selectNodeContents(selected);
      document.getSelection()?.addRange(range);
      assertEquals(document.getSelection()?.toString(), "selected text");
      assertStrictEquals(await copyTextToClipboard("fallback", document), true);
      assertEquals(document.getSelection()?.toString(), "selected text");
    } finally {
      dom.window.close();
    }
  });

  it("reports fallback failure and still removes its temporary textarea", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    defineClipboard(dom.window, () => Promise.reject(new Error("permission denied")));
    const document = dom.window.document;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });

    try {
      assertStrictEquals(await copyTextToClipboard("not copied", document), false);
      assertEquals(document.querySelectorAll("textarea").length, 0);

      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: () => {
          throw new Error("blocked");
        },
      });
      assertStrictEquals(await copyTextToClipboard("still not copied", document), false);
      assertEquals(document.querySelectorAll("textarea").length, 0);
    } finally {
      dom.window.close();
    }
  });

  it("never crosses documents to use an unrelated global clipboard", async () => {
    const globalDom = new JSDOM("<!doctype html><html><body></body></html>");
    const targetDom = new JSDOM("<!doctype html><html><body></body></html>");
    const restore = installComponentDom(globalDom, DOM_OPTIONS);
    const globalWrites: string[] = [];
    defineClipboard(globalDom.window, (text) => {
      globalWrites.push(text);
      return Promise.resolve();
    });
    let targetFallbackCalls = 0;
    Object.defineProperty(targetDom.window.document, "execCommand", {
      configurable: true,
      value: () => {
        targetFallbackCalls += 1;
        return true;
      },
    });

    try {
      assertStrictEquals(
        await copyTextToClipboard("target only", targetDom.window.document),
        true,
      );
      assertEquals(globalWrites, []);
      assertEquals(targetFallbackCalls, 1);
      assertEquals(targetDom.window.document.querySelectorAll("textarea").length, 0);
    } finally {
      restore();
      targetDom.window.close();
    }
  });

  it("settles promptly on abort and consumes a late clipboard rejection", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    let rejectWrite!: (error: Error) => void;
    defineClipboard(
      dom.window,
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const controller = new AbortController();

    try {
      const pending = copyTextToClipboard(
        "cancelled",
        dom.window.document,
        controller.signal,
      );
      controller.abort();
      assertStrictEquals(await pending, false);

      rejectWrite(new Error("late clipboard rejection"));
      await Promise.resolve();
      assertEquals(dom.window.document.querySelectorAll("textarea").length, 0);
    } finally {
      dom.window.close();
    }
  });
});

describe("useClipboardFeedback", () => {
  it("lets the latest request win without running a stale fallback", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    const pending: Array<{
      resolve: () => void;
      reject: (error: Error) => void;
    }> = [];
    defineClipboard(dom.window, () =>
      new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      }));
    let fallbackCalls = 0;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        fallbackCalls += 1;
        return true;
      },
    });
    let feedback: ClipboardFeedback | undefined;

    function Harness(): React.ReactElement {
      feedback = useClipboardFeedback();
      return (
        <output>
          {feedback.outcome ? `${feedback.outcome.status}:${feedback.outcome.text}` : "idle"}
        </output>
      );
    }

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => root.render(<Harness />));
      assert(feedback, "hook result is available");

      const first = feedback.copy("first", document);
      const second = feedback.copy("second", document);
      assertEquals(pending.length, 2);

      pending[1]?.resolve();
      assertStrictEquals(await second, true);
      await settle();
      assertEquals(rootElement.textContent, "copied:second");

      pending[0]?.reject(new Error("late rejection"));
      assertStrictEquals(await first, false);
      await settle();
      assertEquals(rootElement.textContent, "copied:second");
      assertEquals(fallbackCalls, 0);

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("clears the feedback outcome once the bounded window elapses", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    defineClipboard(dom.window, () => Promise.resolve());
    let feedback: ClipboardFeedback | undefined;

    function Harness(): React.ReactElement {
      feedback = useClipboardFeedback(10);
      return (
        <output>
          {feedback.outcome ? `${feedback.outcome.status}:${feedback.outcome.text}` : "idle"}
        </output>
      );
    }

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => root.render(<Harness />));
      assert(feedback, "hook result is available");

      assertStrictEquals(await feedback.copy("text", document), true);
      await settle();
      assertEquals(
        rootElement.textContent,
        "copied:text",
        "a resolved copy publishes the outcome",
      );

      await waitFor(() => rootElement.textContent === "idle", {
        interval: 5,
        message: "the feedback window clears the outcome after the timeout",
      });

      await unmountReactRoot(root);
    } finally {
      restore();
    }
  });

  it("does not publish a pending result after unmount", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    const restore = installComponentDom(dom, DOM_OPTIONS);
    let release!: () => void;
    defineClipboard(dom.window, () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }));
    let feedback: ClipboardFeedback | undefined;

    function Harness(): null {
      feedback = useClipboardFeedback();
      return null;
    }

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => root.render(<Harness />));
      assert(feedback, "hook result is available");

      const pendingCopy = feedback.copy("late", document);
      await unmountReactRoot(root);
      release();
      assertStrictEquals(await pendingCopy, false);
      await settle();
      assertEquals(rootElement.textContent, "");
    } finally {
      restore();
    }
  });
});
