/**
 * Floating — shared Portal + fixed-positioning helper for the overlay
 * primitives (DropdownMenu, Popover, Select). Renders `children` into
 * `document.body`, positioned relative to `anchorRef`, so the surface escapes
 * any `overflow`/iframe clipping — the reason Radix uses a Portal. Anchors below
 * the trigger (flips above when it would overflow), clamps to the viewport,
 * follows scroll/resize, and dismisses on outside-click / `Escape`.
 *
 * TODO(a11y): focus management, RTL, richer collision handling. Private to the
 * chat module.
 *
 * @module react/components/chat/ui/floating
 */
import * as React from "react";
import { createPortal } from "react-dom";

/** Props accepted by `<Floating>`. */
export interface FloatingProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Element the surface is positioned against (usually the trigger wrapper). */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  /** Horizontal edge to align to. */
  align?: "start" | "end";
  /** Called on outside-click or `Escape`. */
  onDismiss: () => void;
  /** Give the surface at least the anchor's width (Select). */
  matchTriggerWidth?: boolean;
}

/** Portal a positioned surface anchored to `anchorRef`. */
export function Floating({
  anchorRef,
  open,
  align = "start",
  onDismiss,
  matchTriggerWidth,
  style,
  children,
  ...rest
}: FloatingProps): React.ReactElement | null {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const c = ref.current;
      if (!a || !c) return;
      const cw = c.offsetWidth;
      const ch = c.offsetHeight;
      const vw = globalThis.innerWidth;
      const vh = globalThis.innerHeight;
      let left = align === "end" ? a.right - cw : a.left;
      left = Math.max(8, Math.min(left, vw - cw - 8));
      let top = a.bottom + 8;
      if (top + ch > vh - 8 && a.top - 8 - ch > 8) top = a.top - 8 - ch;
      setPos({
        position: "fixed",
        top,
        left,
        visibility: "visible",
        ...(matchTriggerWidth ? { minWidth: a.width } : null),
      });
    };
    update();
    globalThis.addEventListener("scroll", update, true);
    globalThis.addEventListener("resize", update);
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        ref.current && !ref.current.contains(t) &&
        !anchorRef.current?.contains(t)
      ) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("scroll", update, true);
      globalThis.removeEventListener("resize", update);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, align, matchTriggerWidth, onDismiss, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} style={{ ...pos, ...style }} {...rest}>{children}</div>,
    document.body,
  );
}
