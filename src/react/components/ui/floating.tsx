/**
 * Floating — shared Portal + fixed-positioning helper for the overlay
 * primitives (DropdownMenu, Popover, Select). Renders `children` into
 * the nearest Veryfront UI scope (or `document.body` when no scope exists),
 * positioned relative to `anchorRef`, so the surface escapes a primitive's
 * clipping container while retaining scoped design tokens. Anchors below the
 * trigger (flips above when it would overflow), clamps to the viewport, follows
 * scroll/resize, and dismisses on outside-click / `Escape`.
 *
 * @module react/components/ui/floating
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { UI_SCOPE_SELECTOR } from "./design-tokens.ts";
import { registerDismissableLayer } from "./dismissable-layer.ts";
import { focusFirst, focusWithoutScroll } from "./focus-management.ts";
import { composeRefs } from "./slot.tsx";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect.ts";

const VIEWPORT_PADDING_PX = 8;

export type FloatingDismissReason = "escape" | "pointer";

// Warn once per session, not per render, when a surface opens unanchored.
let warnedMissingAnchor = false;

/** Props accepted by `<Floating>`. */
export interface FloatingProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Element the surface is positioned against (usually the trigger element). */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Current anchor value when the owner tracks callback-ref replacement. */
  anchorElement?: HTMLElement | null;
  open: boolean;
  /** Horizontal edge to align to. */
  align?: "start" | "end";
  /** Called on outside-click or `Escape`. */
  onDismiss: (reason: FloatingDismissReason) => void;
  /** Give the surface at least the anchor's width (Select). */
  matchTriggerWidth?: boolean;
  /** Move focus into the surface after it is portalled. */
  initialFocus?: true | string;
  /** Focus target for Escape dismissal when the positioning anchor is a wrapper. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Consumer ref for the portalled surface node. */
  contentRef?: React.Ref<HTMLDivElement>;
}

/** Portal a positioned surface anchored to `anchorRef`. */
export function Floating({
  anchorRef,
  anchorElement,
  open,
  align = "start",
  onDismiss,
  matchTriggerWidth,
  initialFocus,
  returnFocusRef,
  contentRef,
  style,
  children,
  ...rest
}: FloatingProps): React.ReactElement | null {
  const ref = React.useRef<HTMLDivElement>(null);
  const surfaceRef = React.useMemo(
    () => composeRefs<HTMLDivElement>(ref, contentRef),
    [contentRef],
  );
  const resolvedAnchor = anchorElement ?? anchorRef.current;
  // Portals have no server representation. Keep the server and the first
  // hydration render identical, then enable the portal after the component has
  // mounted in a browser. This also avoids touching `document` during SSR when
  // a surface starts open via `defaultOpen`.
  const [portalReady, setPortalReady] = React.useState(false);
  const [pos, setPos] = React.useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });

  // Stable ref for onDismiss so the layout effect doesn't tear down and
  // re-register all scroll/resize/pointer/key listeners on every parent render
  // when the caller passes an inline arrow. Without this, `pos` resets to
  // `visibility: hidden` on each re-registration, causing visible flicker.
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!open || !portalReady) return;
    const anchor = resolvedAnchor;
    if (!anchor) {
      if (!warnedMissingAnchor) {
        warnedMissingAnchor = true;
        console.warn(
          "[ui] Floating surface opened without an anchor element. " +
            "If the trigger uses asChild, its child must forward `ref` to a DOM node.",
        );
      }
      return;
    }
    const ownerDocument = anchor.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!ownerWindow) return;

    const update = () => {
      const a = anchor.getBoundingClientRect();
      const c = ref.current;
      if (!c) return;
      const cw = c.offsetWidth;
      const ch = c.offsetHeight;
      const vw = ownerWindow.innerWidth;
      const vh = ownerWindow.innerHeight;
      const isRtl = ownerWindow.getComputedStyle(anchor).direction === "rtl";
      const alignRight = (align === "end") !== isRtl;
      let left = alignRight ? a.right - cw : a.left;
      left = Math.max(
        VIEWPORT_PADDING_PX,
        Math.min(left, vw - cw - VIEWPORT_PADDING_PX),
      );
      let top = a.bottom + VIEWPORT_PADDING_PX;
      if (
        top + ch > vh - VIEWPORT_PADDING_PX &&
        a.top - VIEWPORT_PADDING_PX - ch > VIEWPORT_PADDING_PX
      ) {
        top = a.top - VIEWPORT_PADDING_PX - ch;
      }
      setPos({
        position: "fixed",
        top,
        left,
        visibility: "visible",
        ...(matchTriggerWidth ? { minWidth: a.width } : null),
      });
    };
    update();
    // Re-measure on the next frame: when a menu mounts already-open
    // (`defaultOpen`), the first synchronous measurement can land before the
    // portalled surface has its final layout, leaving it stuck at the hidden
    // origin. A rAF re-run positions it once layout settles. Guarded because
    // `requestAnimationFrame` is browser-only (absent in test/SSR envs).
    const raf = typeof ownerWindow.requestAnimationFrame === "function"
      ? ownerWindow.requestAnimationFrame(update)
      : 0;
    ownerWindow.addEventListener("scroll", update, true);
    ownerWindow.addEventListener("resize", update);
    const onPointer = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof ownerWindow.Node)) return;
      if (
        ref.current && !ref.current.contains(t) &&
        !anchor.contains(t)
      ) onDismissRef.current("pointer");
    };
    const unregisterDismissableLayer = registerDismissableLayer(
      ownerDocument,
      () => ref.current,
      () => {
        onDismissRef.current("escape");
        queueMicrotask(() => {
          const focusTarget = returnFocusRef?.current ?? anchor;
          if (focusTarget.isConnected) focusWithoutScroll(focusTarget);
        });
      },
    );
    ownerDocument.addEventListener("mousedown", onPointer);
    return () => {
      if (raf) ownerWindow.cancelAnimationFrame(raf);
      ownerWindow.removeEventListener("scroll", update, true);
      ownerWindow.removeEventListener("resize", update);
      ownerDocument.removeEventListener("mousedown", onPointer);
      unregisterDismissableLayer();
    };
  }, [open, portalReady, align, matchTriggerWidth, resolvedAnchor, returnFocusRef]);

  useIsomorphicLayoutEffect(() => {
    if (!open || !portalReady || !initialFocus) return;
    const surface = ref.current;
    if (!surface) return;
    const target = initialFocus === true
      ? undefined
      : surface.querySelector<HTMLElement>(initialFocus);
    if (target) focusWithoutScroll(target);
    else focusFirst(surface);
  }, [initialFocus, open, portalReady]);

  if (!open || !portalReady) return null;
  // Portal into the nearest scope root rather than <body>: the design tokens are
  // scoped to `[data-vf-ui]` / `[data-vf-chat]`, so a surface under <body> would
  // resolve every `var(--…)` to nothing (transparent background, wrong text
  // color). The root still sits above the composer's `overflow-hidden`, so we
  // keep the clipping escape while staying inside the token scope.
  const anchor = resolvedAnchor;
  const ownerDocument = anchor?.ownerDocument;
  if (!anchor || !ownerDocument) return null;
  const container = anchor.closest<HTMLElement>("[data-vf-modal-content]") ??
    anchor.closest<HTMLElement>(UI_SCOPE_SELECTOR) ?? ownerDocument.body;
  return createPortal(
    <div ref={surfaceRef} style={{ ...pos, ...style }} {...rest}>{children}</div>,
    container,
  );
}
