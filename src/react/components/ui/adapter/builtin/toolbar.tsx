/**
 * Builtin Toolbar adapter: the zero-dependency roving-tabindex machinery
 * (`role="toolbar"`, arrow-key navigation, Home/End, one tab stop) assembled as
 * `ToolbarParts`. The Root roves focus over its `Item`s; each Item marks itself
 * `data-toolbar-item` so the Root can find it. Behaviour-preserving move of
 * `toolbar.tsx`'s logic; Items carry NO visual classes (the skin passes those).
 *
 * @module react/components/ui/adapter/builtin/toolbar
 */
import * as React from "react";
import { Slot } from "../../slot.tsx";
import type { ToolbarParts } from "../contract.ts";

function enabledItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-toolbar-item]")).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true",
  );
}

const ToolbarRoot: ToolbarParts["Root"] = (
  { orientation = "horizontal", children, onKeyDown, ref, ...props },
) => {
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const setRef = React.useCallback((node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = node;
  }, [ref]);

  // Keep the current roving stop across rerenders. Fall back to the first enabled
  // item only when the active/tabbable item disappeared or became disabled.
  React.useLayoutEffect(() => {
    const root = innerRef.current;
    if (!root) return;
    const items = enabledItems(root);
    const focused = root.contains(root.ownerDocument.activeElement)
      ? root.ownerDocument.activeElement as HTMLElement
      : null;
    const resting = items.find((element) => element === focused || element.tabIndex === 0) ??
      items[0];
    items.forEach((el) => {
      el.tabIndex = el === resting ? 0 : -1;
    });
  });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const root = innerRef.current;
    if (!root) return;
    const items = enabledItems(root);
    if (items.length === 0) return;

    const rtl = root.ownerDocument.defaultView?.getComputedStyle(root).direction === "rtl";
    const nextKey = orientation === "vertical" ? "ArrowDown" : (rtl ? "ArrowLeft" : "ArrowRight");
    const prevKey = orientation === "vertical" ? "ArrowUp" : (rtl ? "ArrowRight" : "ArrowLeft");
    const current = items.indexOf(root.ownerDocument.activeElement as HTMLElement);

    let nextIndex: number;
    if (event.key === nextKey) nextIndex = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === prevKey) {
      nextIndex = current < 0 ? 0 : (current - 1 + items.length) % items.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    const next = items[nextIndex];
    if (!next) return;
    items.forEach((el) => {
      el.tabIndex = el === next ? 0 : -1;
    });
    next.focus();
  };

  return (
    <div
      {...props}
      ref={setRef}
      role="toolbar"
      aria-orientation={orientation}
      data-orientation={orientation}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
};

const ToolbarItem: ToolbarParts["Item"] = ({ asChild, ref, ...props }) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...props}
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      data-toolbar-item=""
    />
  );
};

export const builtinToolbar: ToolbarParts = {
  Root: ToolbarRoot,
  Item: ToolbarItem,
};
