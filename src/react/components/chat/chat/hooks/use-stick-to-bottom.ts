/**
 * useStickToBottom — keeps a scroll container pinned to the bottom while new
 * content streams in, but yields to the user the moment they scroll up. Forked
 * (technique only, no dependency) from Studio's `useStickToBottom`.
 *
 * - `isAtBottom` — whether the viewport is within `threshold`px of the bottom.
 * - Auto-scrolls to the bottom on new content **only when already at bottom**,
 *   so reading history isn't interrupted.
 * - Follows content *height* growth (via a `ResizeObserver` on the content
 *   element) rather than a discrete message count, so streaming tokens —
 *   which grow the last message without changing `messages.length` — keep the
 *   viewport pinned instead of scrolling off-screen.
 * - A width change on the container (e.g. toggling the sidebar) reflows content
 *   and *pauses* auto-scroll for one frame so it isn't mistaken for new content
 *   and yank the view.
 *
 * @module react/components/chat/hooks/use-stick-to-bottom
 */
import * as React from "react";

/** Options for {@link useStickToBottom}. */
export interface UseStickToBottomOptions {
  /** Distance (px) from the bottom still considered "at bottom". @default 64 */
  threshold?: number;
}

/** Result of {@link useStickToBottom}. */
export interface UseStickToBottomResult<T extends HTMLElement> {
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
}

/**
 * Track and maintain "stick to bottom" for a scroll container. Attach
 * `scrollRef` to the scrollable container and `contentRef` to the element that
 * grows as messages / tokens arrive; the hook follows that growth while the
 * user is pinned to the bottom.
 *
 * `contentKey` (e.g. `messages.length`) is still accepted as a fallback trigger
 * for environments without `ResizeObserver`.
 */
export function useStickToBottom<T extends HTMLElement>(
  contentKey: number,
  { threshold = 64 }: UseStickToBottomOptions = {},
): UseStickToBottomResult<T> {
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

  // Track the user's scroll position.
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

  // Pause auto-scroll for one frame when the container width changes (reflow,
  // not new content — e.g. toggling the sidebar).
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

  // Follow content-height growth: while the content element grows taller (new
  // messages *and* streaming tokens within the last message), stay pinned to
  // the bottom if the user was already there. Uses instant scroll so it keeps
  // up with rapid token streaming without smooth-scroll animations queuing up.
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

  // Fallback for environments without ResizeObserver: stick on message-count
  // changes only.
  React.useEffect(() => {
    if (typeof ResizeObserver !== "undefined") return;
    if (pausedRef.current) return;
    if (isAtBottomRef.current) scrollToBottom("smooth");
  }, [contentKey, scrollToBottom]);

  // On mount: jump to the bottom without animation (matches SSR paint).
  React.useEffect(() => {
    scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { scrollRef, contentRef, isAtBottom, scrollToBottom };
}
