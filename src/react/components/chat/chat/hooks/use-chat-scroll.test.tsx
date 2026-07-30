/**
 * `useChatScroll` superset behaviour (RFC 2980): keeps the `useStickToBottom`
 * base (`scrollRef`/`contentRef`/`isAtBottom`/`scrollToBottom`) and adds
 * `viewportRef`, `scrollToStart`/`scrollToEnd`, `scrollToMessage`, and
 * `getViewportProps`. Methods no-op safely when refs are unattached.
 */
import { renderToString } from "react-dom/server";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
  it("keeps the useStickToBottom base surface", () => {
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
});
