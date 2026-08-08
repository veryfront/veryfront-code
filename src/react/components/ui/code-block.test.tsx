import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CodeBlock,
  CodeBlockRendererProvider,
  type CodeDiagramRendererProps,
  CodeSurface,
  type CodeSyntaxRendererProps,
  useClipboard,
} from "./code-block.tsx";

function installDom(
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>'),
): { restore: () => void; window: JSDOM["window"] } {
  const window = dom.window;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    self: globalThis.self,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    Event: globalThis.Event,
    MouseEvent: globalThis.MouseEvent,
  };

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
  });

  return {
    window,
    restore: () => {
      Object.assign(globalThis, previous);
      dom.window.close();
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

/**
 * Wait for a condition the copy handler reaches asynchronously.
 *
 * `settle` spends a fixed budget of one microtask and one macrotask, which is
 * enough for the success path but not reliably for the failure path: a rejected
 * `clipboard.writeText` falls back to `execCommand`, and only once that returns
 * false does the failed state get set. That chain is several ticks long, so on
 * a loaded machine the assertion could run against the pre-failure render. Poll
 * for the state the test is actually about, against a wall-clock deadline
 * rather than an iteration count: under load each poll costs more, so a fixed
 * number of attempts is an arbitrary proxy for how long the test is willing to
 * wait.
 */
const WAIT_FOR_TIMEOUT_MS = 2_000;

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs: number = WAIT_FOR_TIMEOUT_MS,
): Promise<void> {
  // `performance.now()` rather than `Date.now()`: a wall clock corrected mid-run
  // by NTP or a VM host can jump backwards, holding the loop open past its
  // bound, or forwards, timing out a test that was about to pass. Elapsed time
  // is what this is measuring, so measure it monotonically.
  const deadline = performance.now() + timeoutMs;

  for (;;) {
    flushSync(() => {});
    if (predicate()) return;
    // Checked after the predicate, so a state that lands exactly on the
    // deadline still counts, and before the sleep, so a failed final check
    // does not pay for a tick it will never use.
    if (performance.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * Unmount and drain the one-shot tasks the runtime leaves behind.
 *
 * The `execCommand` copy fallback selects a textarea, and jsdom queues that
 * `select` event on a bare `setTimeout` it never registers with the window, so
 * `window.close()` cannot clear it. React's scheduler likewise holds a
 * `setImmediate` until it next runs. Both complete on their own, but the test
 * has to yield once more or Deno's leak sanitizer sees them still pending.
 */
async function unmount(root: Root): Promise<void> {
  flushSync(() => root.unmount());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("waitFor", () => {
  // The helper decides whether the clipboard assertions run against a settled
  // render, so a version that resolved early or swallowed a timeout would make
  // those tests pass without checking anything.

  it("returns as soon as the predicate holds", async () => {
    let polls = 0;
    await waitFor(() => ++polls >= 3, "the third poll", 1_000);
    assertEquals(polls, 3, "stops on the poll that succeeds rather than running to the deadline");
  });

  it("succeeds on a state that lands within the deadline", async () => {
    let ready = false;
    setTimeout(() => (ready = true), 5);
    await waitFor(() => ready, "a state that arrives late", 1_000);
    assertEquals(ready, true);
  });

  it("throws a named error naming its timeout", async () => {
    let message = "";
    try {
      await waitFor(() => false, "something that never happens", 20);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assertEquals(message, "Timed out after 20ms waiting for something that never happens");
  });

  it("does not sleep after the check that gives up", async () => {
    // The contract is predicate, then deadline, then sleep: every poll except
    // the last is followed by a sleep. A trailing sleep would mean waiting a
    // tick the loop can never use.
    const realSetTimeout = globalThis.setTimeout;
    let sleeps = 0;
    let polls = 0;
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
    ) => {
      sleeps += 1;
      return realSetTimeout(handler as () => void, timeout);
    }) as typeof setTimeout;

    try {
      await waitFor(
        () => {
          polls += 1;
          return false;
        },
        "never",
        20,
      ).catch(() => {});
    } finally {
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout = realSetTimeout;
    }

    assert(polls > 1, "the loop polls more than once before giving up");
    assertEquals(sleeps, polls - 1, "one sleep between polls, none after the last");
  });
});

describe("CodeBlock renderer boundary", () => {
  it("keeps the standalone CodeSurface renderer optional", () => {
    const html = renderToString(
      <CodeSurface code="const answer = 42;" language="ts" resolvedMode="light" />,
    );

    assertStringIncludes(html, 'data-vf-code-renderer="plain"');
    assertStringIncludes(html, "const answer = 42;");
  });

  it("renders escaped plain source without extension capabilities", () => {
    const html = renderToString(
      <CodeBlock code='<script>alert("x")</script>' language="mermaid" />,
    );

    assertStringIncludes(html, 'data-vf-code-renderer="plain"');
    assertStringIncludes(html, 'class="language-mermaid"');
    assertStringIncludes(html, "&lt;script&gt;");
    assertEquals(html.includes("<script>"), false);
    assertEquals(html.includes('data-vf-code-renderer="extension"'), false);
  });

  it("selects injected syntax and diagram renderers explicitly", () => {
    function SyntaxRenderer({ code, language, mode }: CodeSyntaxRendererProps) {
      return <pre data-syntax={`${language}:${mode}`}>{code}</pre>;
    }
    function DiagramRenderer({ code, language, mode }: CodeDiagramRendererProps) {
      return <figure data-diagram={`${language}:${mode}`}>{code}</figure>;
    }

    const syntaxHtml = renderToString(
      <CodeBlock
        code="const value = 1"
        language="ts"
        mode="dark"
        renderers={{ syntax: SyntaxRenderer }}
      />,
    );
    const diagramHtml = renderToString(
      <CodeBlockRendererProvider renderers={{ diagram: DiagramRenderer }}>
        <CodeBlock code="graph TD" language="mermaid" mode="light" />
      </CodeBlockRendererProvider>,
    );

    assertStringIncludes(syntaxHtml, 'data-vf-code-renderer="extension"');
    assertStringIncludes(syntaxHtml, 'data-syntax="ts:dark"');
    assertStringIncludes(diagramHtml, 'data-diagram="mermaid:light"');
  });

  it("allows a component to select plain source over an inherited renderer", () => {
    function SyntaxRenderer(): React.ReactElement {
      return <strong>rich</strong>;
    }
    const html = renderToString(
      <CodeBlockRendererProvider renderers={{ syntax: SyntaxRenderer }}>
        <CodeBlock code="plain" renderers={{ syntax: null }} />
      </CodeBlockRendererProvider>,
    );

    assertStringIncludes(html, 'data-vf-code-renderer="plain"');
    assertEquals(html.includes("<strong>rich</strong>"), false);
  });

  it("does not replace an extension renderer failure with plain source", () => {
    function BrokenRenderer(): React.ReactElement {
      throw new Error("syntax extension failed");
    }
    assertThrows(
      () =>
        renderToString(
          <CodeBlock code="source" renderers={{ syntax: BrokenRenderer }} />,
        ),
      Error,
      "syntax extension failed",
    );
  });
});

describe("CodeBlock clipboard integration", () => {
  it("passes a real click event to a custom-header onCopy interceptor", async () => {
    const dom = installDom();
    const writes: string[] = [];
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        },
      },
    });
    let interceptedEvent: React.MouseEvent | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <CodeBlock
            code="const value = 1;"
            language="ts"
            renderHeader={({ copy }) => (
              <button type="button" onClick={copy}>Copy custom header</button>
            )}
            onCopy={(event, next) => {
              interceptedEvent = event;
              event.preventDefault();
              queueMicrotask(next);
            }}
          />,
        );
      });

      const button = rootElement.querySelector("button");
      assert(button, "custom copy control renders");
      const nativeEvent = new dom.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(nativeEvent);
      await settle();

      assert(interceptedEvent, "onCopy receives an event");
      assertStrictEquals(interceptedEvent.nativeEvent, nativeEvent);
      assert(interceptedEvent.isDefaultPrevented(), "the React event remains usable");
      assertEquals(writes, ["const value = 1;"]);

      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("fails closed when a custom header drops the event required by onCopy", async () => {
    const dom = installDom();
    let writes = 0;
    let interceptions = 0;
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => {
          writes += 1;
          return Promise.resolve();
        },
      },
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <CodeBlock
            code="sensitive"
            renderHeader={({ copy }) => (
              <button type="button" onClick={() => copy()}>Copy without event</button>
            )}
            onCopy={(_event, next) => {
              interceptions += 1;
              next();
            }}
          />,
        );
      });

      const button = rootElement.querySelector("button");
      assert(button, "custom copy control renders");
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle();

      assertEquals(interceptions, 0);
      assertEquals(writes, 0);
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("keeps flat and collapsible eventless copies in the rendered document", async () => {
    const globalDom = new JSDOM("<!doctype html><html><body></body></html>");
    const targetDom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    const { restore } = installDom(globalDom);
    const globalWrites: string[] = [];
    const targetWrites: string[] = [];
    Object.defineProperty(globalDom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          globalWrites.push(text);
          return Promise.resolve();
        },
      },
    });
    Object.defineProperty(targetDom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          targetWrites.push(text);
          return Promise.resolve();
        },
      },
    });

    try {
      const rootElement = targetDom.window.document.getElementById("root");
      assert(rootElement, "target root fixture exists");
      const root = createRoot(rootElement);
      for (const collapsible of [false, true]) {
        const code = collapsible ? "collapsible target" : "flat target";
        flushSync(() => {
          root.render(
            <CodeBlock
              code={code}
              collapsible={collapsible}
              renderHeader={({ copy }) => (
                <button type="button" onClick={() => copy()}>Copy without event</button>
              )}
            />,
          );
        });

        const button = rootElement.querySelector("button");
        assert(button, "custom copy control renders");
        button.dispatchEvent(new targetDom.window.MouseEvent("click", { bubbles: true }));
        await settle();
      }

      assertEquals(targetWrites, ["flat target", "collapsible target"]);
      assertEquals(globalWrites, []);
      await unmount(root);
    } finally {
      restore();
      targetDom.window.close();
    }
  });

  it("reports failure only when both clipboard mechanisms fail", async () => {
    const dom = installDom();
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });

    function Harness(): React.ReactElement {
      const clipboard = useClipboard("not copied");
      return (
        <button
          type="button"
          data-copied={String(clipboard.copied)}
          data-failed={String(clipboard.failed)}
          onClick={(event) => clipboard.copy(event.currentTarget.ownerDocument)}
        >
          Copy
        </button>
      );
    }

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => root.render(<Harness />));
      const button = rootElement.querySelector("button");
      assert(button, "copy control renders");

      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await waitFor(
        () => button.dataset.failed === "true",
        "both clipboard mechanisms to fail",
      );

      assertEquals(button.dataset.copied, "false");
      assertEquals(button.dataset.failed, "true");
      assertEquals(document.querySelectorAll("textarea").length, 0);

      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("exposes failed copy feedback to assistive technology", async () => {
    const dom = installDom();
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => root.render(<CodeBlock code="not copied" />));
      const button = rootElement.querySelector<HTMLButtonElement>("button");
      assert(button, "copy control renders");

      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await waitFor(
        () => button.getAttribute("aria-label") === "Unable to copy code",
        "the copy control to report failure",
      );

      assertEquals(button.getAttribute("aria-label"), "Unable to copy code");
      assertEquals(
        rootElement.querySelector('[role="status"]')?.textContent,
        "Unable to copy code",
      );
      await unmount(root);
    } finally {
      dom.restore();
    }
  });
});
