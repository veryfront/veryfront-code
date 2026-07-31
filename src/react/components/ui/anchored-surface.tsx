/**
 * Shared behavioral machinery for Popover and DropdownMenu.
 * @module react/components/ui/anchored-surface
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { composeRefs, Slot } from "./slot.tsx";
import { Floating } from "./floating.tsx";
import { type DisclosureOptions, useDisclosure } from "./disclosure.ts";

/** Context value shared between an anchored skin's Root and its parts. */
export interface AnchoredState {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  defaultTriggerId: string;
  defaultContentId: string;
  triggerId: string;
  contentId: string;
  setTriggerId: React.Dispatch<React.SetStateAction<string>>;
  setContentId: React.Dispatch<React.SetStateAction<string>>;
}

/** Props for `AnchoredTrigger` (returned by the factory). */
export interface AnchoredTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  /** Composed with the internal positioning-anchor ref. */
  ref?: React.Ref<HTMLButtonElement>;
  /** `aria-haspopup` value -- `"dialog"` for Popover, `"menu"` for DropdownMenu. */
  haspopup: NonNullable<React.AriaAttributes["aria-haspopup"]>;
}

/** Props for `AnchoredContent` (returned by the factory). */
export interface AnchoredContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
  /** Internal focus target used by Popover and DropdownMenu skins. */
  initialFocus?: true | string;
}

function stableDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

/**
 * Creates a fresh context instance plus the AnchoredRoot, AnchoredTrigger, and
 * AnchoredContent parts -- all bound to that context.
 *
 * Each skin (Popover, DropdownMenu) calls this ONCE at module scope so their
 * contexts are distinct objects. This prevents cross-binding when one skin is
 * nested inside the other or inside a modal skin: a DropdownMenuItem close
 * call only affects the DropdownMenu whose context is in scope, never a
 * Popover above it in the tree.
 */
export function createAnchoredSurfaceParts() {
  const Context = React.createContext<AnchoredState | null>(null);

  /**
   * Disclosure state + context provider. Renders no node of its own - the
   * positioning anchor for `Floating` is the trigger element itself, carried
   * on context as `anchorRef` and attached by `AnchoredTrigger`.
   */
  function AnchoredRoot(
    { children, open, defaultOpen, onOpenChange }: DisclosureOptions & {
      children: React.ReactNode;
    },
  ): React.ReactElement {
    const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
    const anchorRef = React.useRef<HTMLElement | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const reactId = stableDomId(React.useId());
    const defaultTriggerId = `vf-anchored-${reactId}-trigger`;
    const defaultContentId = `vf-anchored-${reactId}-content`;
    const [triggerId, setTriggerId] = React.useState(defaultTriggerId);
    const [contentId, setContentId] = React.useState(defaultContentId);
    const ctx = React.useMemo(
      () => ({
        open: isOpen,
        setOpen,
        anchorRef,
        triggerRef,
        defaultTriggerId,
        defaultContentId,
        triggerId,
        contentId,
        setTriggerId,
        setContentId,
      }),
      [
        contentId,
        defaultContentId,
        defaultTriggerId,
        isOpen,
        setOpen,
        triggerId,
      ],
    );
    return (
      <Context.Provider value={ctx}>
        {children}
      </Context.Provider>
    );
  }

  /**
   * Toggle trigger. Sets `aria-haspopup` and `aria-expanded`; toggles open on
   * click; carries the positioning-anchor ref (composed with any consumer
   * `ref`, including through `asChild`). Skins differ only in the `haspopup`
   * value they supply.
   *
   * `asChild` contract: the child must forward `ref` to its DOM node (every
   * `ui` component does; refs pass as regular props on function components in
   * React 19). A child that drops `ref` leaves the surface unanchored —
   * `Floating` warns in that case instead of silently rendering nothing.
   */
  function AnchoredTrigger(
    {
      children,
      asChild,
      disabled,
      id,
      onClick,
      haspopup,
      ref,
      type,
      ...props
    }: AnchoredTriggerProps,
  ): React.ReactElement {
    const ctx = React.useContext(Context);
    if (!ctx) {
      throw new Error("Anchored trigger parts must be used within their root");
    }
    const Comp = asChild ? Slot : "button";
    const resolvedId = id ?? ctx.defaultTriggerId;
    React.useLayoutEffect(() => {
      ctx.setTriggerId(resolvedId);
      return () => {
        ctx.setTriggerId((current) => current === resolvedId ? ctx.defaultTriggerId : current);
      };
    }, [ctx.defaultTriggerId, ctx.setTriggerId, resolvedId]);
    const setTriggerRef = React.useCallback((element: HTMLButtonElement | null) => {
      ctx.triggerRef.current = element;
      ctx.anchorRef.current = element;
    }, [ctx.anchorRef, ctx.triggerRef]);
    const composedRef = React.useMemo(
      () => composeRefs<HTMLButtonElement>(setTriggerRef, ref),
      [ref, setTriggerRef],
    );
    return (
      <Comp
        {...props}
        type={asChild ? type : type ?? "button"}
        ref={composedRef}
        id={resolvedId}
        aria-haspopup={haspopup}
        aria-expanded={ctx.open}
        aria-controls={ctx.contentId}
        aria-disabled={asChild && disabled ? true : undefined}
        disabled={asChild ? undefined : disabled}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          if (!e.defaultPrevented && !disabled) ctx.setOpen(!ctx.open);
        }}
      >
        {children}
      </Comp>
    );
  }

  /** `Floating` wrapper with base classes. Skins extend via `className` and `role`. */
  function AnchoredContent(
    {
      children,
      className,
      align,
      id,
      initialFocus,
      tabIndex,
      "aria-labelledby": labelledBy,
      ...props
    }: AnchoredContentProps,
  ): React.ReactElement | null {
    const ctx = React.useContext(Context);
    if (!ctx) {
      throw new Error("Anchored content parts must be used within their root");
    }
    const resolvedId = id ?? ctx.defaultContentId;
    React.useLayoutEffect(() => {
      ctx.setContentId(resolvedId);
      return () => {
        ctx.setContentId((current) => current === resolvedId ? ctx.defaultContentId : current);
      };
    }, [ctx.defaultContentId, ctx.setContentId, resolvedId]);
    return (
      <Floating
        {...props}
        anchorRef={ctx.anchorRef}
        open={ctx.open}
        align={align}
        onDismiss={() => ctx.setOpen(false)}
        initialFocus={initialFocus}
        returnFocusRef={ctx.triggerRef}
        id={resolvedId}
        aria-labelledby={labelledBy ?? ctx.triggerId}
        tabIndex={tabIndex ?? -1}
        className={cn(
          "z-50 overflow-hidden rounded-lg bg-[var(--popover)] text-[var(--foreground)] shadow-sm outline-none",
          className,
        )}
      >
        {children}
      </Floating>
    );
  }

  return { Context, AnchoredRoot, AnchoredTrigger, AnchoredContent };
}
