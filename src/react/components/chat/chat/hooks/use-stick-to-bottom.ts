/**
 * useStickToBottom — keeps a scroll container pinned to the bottom while new
 * content streams in, but yields to the user the moment they scroll up. Forked
 * (technique only, no dependency) from Studio's `useStickToBottom`.
 *
 * - `isAtBottom` — whether the viewport is within `threshold`px of the bottom.
 * - Auto-scrolls to the bottom on new content **only when already at bottom**,
 *   so reading history isn't interrupted.
 * - A `ResizeObserver` on the container width *pauses* auto-scroll for one tick
 *   (a width change — e.g. toggling the sidebar — reflows content and must not
 *   be mistaken for new messages / yank the view).
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
  /** True while the viewport sits within `threshold` of the bottom. */
  isAtBottom: boolean;
  /** Programmatically scroll to the bottom. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

/**
 * Track and maintain "stick to bottom" for a scroll container. Pass the count
 * that changes when new content arrives (e.g. `messages.length`) as `contentKey`
 * so a fresh message triggers an auto-scroll when the user is already pinned.
 */
export function useStickToBottom<T extends HTMLElement>(
  contentKey: number,
  { threshold = 64 }: UseStickToBottomOptions = {},
): UseStickToBottomResult<T> {
  const scrollRef = React.useRef<T | null>(null);
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
  // not new content).
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

  // On new content: stick to the bottom only if the user was already there.
  React.useEffect(() => {
    if (pausedRef.current) return;
    if (isAtBottomRef.current) scrollToBottom("smooth");
  }, [contentKey, scrollToBottom]);

  // On mount: jump to the bottom without animation (matches SSR paint).
  React.useEffect(() => {
    scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { scrollRef, isAtBottom, scrollToBottom };
}
