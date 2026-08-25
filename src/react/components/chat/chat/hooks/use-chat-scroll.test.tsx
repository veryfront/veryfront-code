/**
 * `useChatScroll` superset behaviour (RFC 2980): provides
 * `scrollRef`/`contentRef`/`isAtBottom`/`scrollToBottom` plus
 * `viewportRef`, `scrollToStart`/`scrollToEnd`, `scrollToMessage`, and
 * `getViewportProps`. Methods no-op safely when refs are unattached.
 */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { useChatScroll, type UseChatScrollResult } from "./use-stick-to-bottom.ts";

function capture(): UseChatScrollResult<HTMLDivElement> {
  let captured: UseChatScrollResult<HTMLDivElement> | null = null;
  function Fixture(): null {
    captured = useChatScroll<HTMLDivElement>(0);
    return null;
  }
  renderToString(<Fixture />);
  assert(captured, "hook produced a result");
  return captured!;
}

describe("useChatScroll (superset)", () => {
  it("keeps the canonical base surface", () => {
    const s = capture();
    assert(s.scrollRef, "scrollRef present");
    assert(s.contentRef, "contentRef present");
    assertEquals(typeof s.scrollToBottom, "function");
    assertEquals(typeof s.isAtBottom, "boolean");
  });

  it("adds the RFC superset methods", () => {
    const s = capture();
    assertEquals(s.viewportRef, s.scrollRef, "viewportRef aliases scrollRef");
    assertEquals(typeof s.scrollToStart, "function");
    assertEquals(typeof s.scrollToEnd, "function");
    assertEquals(typeof s.scrollToMessage, "function");
    assertEquals(typeof s.getViewportProps, "function");
  });

  it("getViewportProps returns the viewport ref + data-at-bottom", () => {
    const s = capture();
    const vp = s.getViewportProps();
    assertEquals(vp.ref, s.scrollRef, "viewport props carry the scroll ref");
    // data-at-bottom mirrors isAtBottom: "" when pinned, omitted otherwise.
    assertEquals(vp["data-at-bottom"], s.isAtBottom ? "" : undefined);
  });

  it("scroll methods are safe no-ops when refs are unattached", () => {
    const s = capture();
    // scrollRef.current is null in SSR — optional chaining must guard.
    s.scrollToStart();
    s.scrollToEnd();
    s.scrollToMessage("m-1");
    assert(true, "no method threw with null refs");
  });

  it("scrollToMessage matches arbitrary ids and scrolls only its viewport", () => {
    const dom = new JSDOM(
      '<div id="viewport"><article data-message-id="plain"></article><article></article></div>',
    );
    const restore = installComponentDom(dom);
    try {
      const s = capture();
      const viewport = dom.window.document.querySelector<HTMLDivElement>("#viewport")!;
      const target = viewport.querySelectorAll<HTMLElement>("article")[1]!;
      const id = 'quoted"] message\\id';
      target.dataset.messageId = id;
      viewport.scrollTop = 120;
      viewport.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
      target.getBoundingClientRect = () => ({ top: 360 } as DOMRect);
      let viewportScroll: ScrollToOptions | undefined;
      viewport.scrollTo = (options?: ScrollToOptions | number, _y?: number) => {
        if (typeof options === "object") viewportScroll = options;
      };
      let ancestorScrolls = 0;
      target.scrollIntoView = () => ancestorScrolls += 1;
      s.scrollRef.current = viewport;

      s.scrollToMessage(id, "auto");

      assertEquals(viewportScroll, { top: 380, behavior: "auto" });
      assertEquals(ancestorScrolls, 0);
    } finally {
      restore();
      dom.window.close();
    }
  });

  it("pins to the bottom while content grows and yields once the user scrolls up", async () => {
    const componentDom = new JSDOM('<div id="root"></div>');
    // Fake ResizeObserver: capture each observer's callback so the test can
    // fire it after mutating the fake layout metrics.
    const observers: Array<{ target: Element; fire: () => void }> = [];
    class FakeResizeObserver {
      #callback: () => void;
      constructor(callback: () => void) {
        this.#callback = callback;
      }
      observe(target: Element) {
        observers.push({ target, fire: () => this.#callback() });
      }
      disconnect() {}
    }
    (componentDom.window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      FakeResizeObserver;
    // The fake ResizeObserver is defined on the JSDOM window first so the shared
    // installer copies it over its default stub.
    const restore = installComponentDom(componentDom, {
      windowGlobals: ["ResizeObserver", "Event"],
    });
    let root: Root | undefined;
    try {
      let captured: UseChatScrollResult<HTMLDivElement> | null = null;
      const Fixture = (): React.ReactElement => {
        captured = useChatScroll<HTMLDivElement>(0, { threshold: 10 });
        return (
          <div ref={captured.scrollRef} data-at-bottom={captured.isAtBottom ? "" : undefined}>
            <div ref={captured.contentRef as React.RefObject<HTMLDivElement | null>} />
          </div>
        );
      };
      // jsdom has no Element.scrollTo; the hook calls it on mount, so stub it
      // before rendering and record every call.
      const scrollToCalls: ScrollToOptions[] = [];
      componentDom.window.HTMLElement.prototype.scrollTo = function (
        options?: ScrollToOptions | number,
      ) {
        if (typeof options === "object") scrollToCalls.push(options);
      };
      const container = componentDom.window.document.getElementById("root")!;
      root = createRoot(container);
      flushSync(() => root!.render(<Fixture />));
      scrollToCalls.length = 0;
      const viewport = container.firstElementChild as HTMLDivElement;
      const content = viewport.firstElementChild as HTMLDivElement;
      const layout = { scrollHeight: 100, clientHeight: 100, scrollTop: 0 };
      for (const key of ["scrollHeight", "clientHeight", "scrollTop"] as const) {
        Object.defineProperty(viewport, key, {
          get: () => layout[key],
          set: (v: number) => {
            layout[key] = v;
          },
          configurable: true,
        });
      }
      Object.defineProperty(content, "scrollHeight", {
        get: () => layout.scrollHeight,
        configurable: true,
      });
      const contentObserver = observers.find((o) => o.target === content);
      assert(contentObserver, "content ResizeObserver attached");
      const scroll = () =>
        flushSync(() => viewport.dispatchEvent(new componentDom.window.Event("scroll")));

      // Reader scrolls up past the threshold: pin released.
      layout.scrollHeight = 300;
      layout.scrollTop = 0;
      scroll();
      assertEquals(captured!.isAtBottom, false, "scrolling up past the threshold releases the pin");
      assertEquals(viewport.hasAttribute("data-at-bottom"), false, "data-at-bottom is dropped");

      // Content grows while reading history: no auto-scroll.
      layout.scrollHeight = 400;
      contentObserver!.fire();
      assertEquals(scrollToCalls.length, 0, "no auto-scroll while the user is reading history");

      // Reader returns to the bottom: pin restored, growth is followed.
      layout.scrollTop = 300;
      scroll();
      assertEquals(captured!.isAtBottom, true, "scrolling back to the bottom restores the pin");
      layout.scrollHeight = 500;
      contentObserver!.fire();
      assertEquals(
        scrollToCalls.at(-1),
        { top: 500, behavior: "auto" },
        "pinned viewport follows content growth",
      );

      // Within threshold still counts as at bottom.
      layout.scrollTop = 500 - 100 - 10;
      scroll();
      assertEquals(
        captured!.isAtBottom,
        true,
        "a distance equal to the threshold is still at bottom",
      );
      layout.scrollTop = 500 - 100 - 11;
      scroll();
      assertEquals(captured!.isAtBottom, false, "a distance past the threshold is not at bottom");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });
});
