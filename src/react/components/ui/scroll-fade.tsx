/**
 * ScrollFade — ported 1:1 from Veryfront Studio. A scrollable container that
 * auto-applies edge fade gradients (mask-image) when content overflows or the
 * user scrolls. Self-contained (refs + ResizeObserver, no radix); Studio's
 * `scrollbar-thin` plugin utilities are dropped for the native
 * `[scrollbar-width:thin]`. Veryfront's nearest equivalent to a "ScrollArea".
 * Private to the chat module.
 *
 * @module react/components/ui/scroll-fade
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

const BOTH_EDGES =
  "data-[overflow]:not-data-[scrolled]:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent_100%)] data-[scrolled]:not-data-[overflow]:[mask-image:linear-gradient(to_bottom,transparent_0,black_1.5rem)] data-[overflow]:data-[scrolled]:[mask-image:linear-gradient(to_bottom,transparent_0,black_1.5rem,black_calc(100%-1.5rem),transparent_100%)]";

const BOTTOM_EDGE =
  "data-[overflow]:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent_100%)]";

/** Props accepted by `<ScrollFade>`. */
export interface ScrollFadeProps extends React.ComponentProps<"div"> {
  /**
   * Which edges to fade. `both` (default) fades the top when scrolled and the
   * bottom when more content sits below; `bottom` fades only the bottom while
   * content overflows.
   */
  edges?: "both" | "bottom";
}

/** A scroll container with auto edge-fade affordances. */
export function ScrollFade({
  edges = "both",
  className,
  children,
  ...props
}: ScrollFadeProps): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = React.useState(false);
  const [hasScrolled, setHasScrolled] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      setHasOverflow(el.scrollHeight - el.clientHeight - el.scrollTop > 1);
      setHasScrolled(el.scrollTop > 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      data-overflow={hasOverflow || undefined}
      data-scrolled={hasScrolled || undefined}
      className={cn(
        "overflow-auto overscroll-contain [scrollbar-width:thin]",
        edges === "both" ? BOTH_EDGES : BOTTOM_EDGE,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
