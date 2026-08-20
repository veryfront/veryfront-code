/**
 * useChatScroll keeps a scroll container pinned to the bottom while new
 * content streams in, but yields to the user the moment they scroll up.
 *
 * - `isAtBottom` tells you whether the viewport is within `threshold`px of the
 *   bottom.
 * - Auto-scrolls to the bottom on new content only when already at bottom, so
 *   reading history is not interrupted.
 * - Follows content height growth, which keeps streaming tokens pinned without
 *   relying on message counts.
 * - A width change on the container pauses auto-scroll for one frame so a
 *   sidebar toggle is not mistaken for new content.
 *
 * @module react/components/chat/hooks/use-stick-to-bottom
 */
import * as React from "react";

/** Options for {@link useChatScroll}. */
export interface UseChatScrollOptions {
  /** Distance (px) from the bottom still considered "at bottom". @default 64 */
  threshold?: number;
}

/** Result of {@link useChatScroll}. */
export interface UseChatScrollResult<T extends HTMLElement> {
  /** Attach to the scrollable container. */
  scrollRef: React.RefObject<T | null>;
  /**
   * Attach to the element that grows as content arrives (the inner content
   * wrapper). Its height is observed to follow streaming output.
   */
  contentRef: React.RefObject<HTMLElement | null>;
  /** True while the viewport sits within `threshold` of the bottom. */
  isAtBottom: boolean;
  /** Programmatically scroll to the bottom. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Alias of `scrollRef`, the scroll viewport (RFC 2980 name). */
  viewportRef: React.RefObject<T | null>;
  /** Scroll the viewport to the top. */
  scrollToStart: (behavior?: ScrollBehavior) => void;
  /** Scroll the viewport to the bottom (alias of `scrollToBottom`). */
  scrollToEnd: (behavior?: ScrollBehavior) => void;
  /** Scroll a message (`[data-message-id="…"]`) into view within the viewport. */
  scrollToMessage: (id: string, behavior?: ScrollBehavior) => void;
  /** Props to spread on the scroll viewport element: `ref` + `data-at-bottom`. */
  getViewportProps: () => {
    ref: React.RefObject<T | null>;
    "data-at-bottom"?: "" | undefined;
  };
}

/**
 * Track and maintain bottom-pinned scroll behavior for a chat viewport.
 */
export function useChatScroll<T extends HTMLElement>(
  contentKey: number,
  { threshold = 64 }: UseChatScrollOptions = {},
): UseChatScrollResult<T> {
  const scrollRef = React.useRef<T | null>(null);
  const contentRef = React.useRef<HTMLElement | null>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  const isAtBottomRef = React.useRef(true);
  const pausedRef = React.useRef(false);

  const computeAtBottom = React.useCallback((): boolean => {
    const el = scrollRef.current;
    if (!el) return true;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= threshold;
  }, [threshold]);

  const scrollToBottom = React.useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [],
  );

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = computeAtBottom();
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [computeAtBottom]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth;
        pausedRef.current = true;
        requestAnimationFrame(() => {
          pausedRef.current = false;
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    let lastHeight = content.scrollHeight;
    const observer = new ResizeObserver(() => {
      const height = content.scrollHeight;
      if (height === lastHeight) return;
      const grew = height > lastHeight;
      lastHeight = height;
      if (pausedRef.current) return;
      if (grew && isAtBottomRef.current) scrollToBottom("auto");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  React.useEffect(() => {
    if (typeof ResizeObserver !== "undefined") return;
    if (pausedRef.current) return;
    if (isAtBottomRef.current) scrollToBottom("smooth");
  }, [contentKey, scrollToBottom]);

  React.useEffect(() => {
    scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToStart = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    scrollRef.current?.scrollTo?.({ top: 0, behavior });
  }, []);

  const scrollToMessage = React.useCallback(
    (id: string, behavior: ScrollBehavior = "smooth") => {
      const viewport = scrollRef.current;
      if (!viewport) return;
      const message = [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")]
        .find((candidate) => candidate.dataset.messageId === id);
      if (!message) return;
      const viewportTop = viewport.getBoundingClientRect().top + viewport.clientTop;
      const messageTop = message.getBoundingClientRect().top;
      viewport.scrollTo({
        top: viewport.scrollTop + messageTop - viewportTop,
        behavior,
      });
    },
    [],
  );

  const getViewportProps = React.useCallback(() => ({
    ref: scrollRef,
    "data-at-bottom": (isAtBottom ? "" : undefined) as "" | undefined,
  }), [isAtBottom]);

  return {
    scrollRef,
    contentRef,
    isAtBottom,
    scrollToBottom,
    viewportRef: scrollRef,
    scrollToStart,
    scrollToEnd: scrollToBottom,
    scrollToMessage,
    getViewportProps,
  };
}
