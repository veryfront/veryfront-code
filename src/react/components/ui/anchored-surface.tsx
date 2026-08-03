/**
 * Shared behavioral machinery for Popover and DropdownMenu.
 * @module react/components/ui/anchored-surface
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import {
  composeRefs,
  getPolymorphicButtonType,
  type PolymorphicButtonAttributes,
  Slot,
} from "./slot.tsx";
import { Floating } from "./floating.tsx";
import { type DisclosureOptions, useDisclosure } from "./disclosure.ts";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect.ts";

/** Context value shared between an anchored skin's Root and its parts. */
export interface AnchoredState {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  anchorElement: HTMLElement | null;
  setAnchorElement: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
  triggerRef: React.RefObject<HTMLElement | null>;
  defaultTriggerId: string;
  defaultContentId: string;
  triggerId: string;
  contentId: string;
  setTriggerId: React.Dispatch<React.SetStateAction<string>>;
  setContentId: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Backward-compatible public props for an anchored trigger.
 *
 * Keep this as a broad interface so existing wrapper interfaces, conditional
 * `asChild` values, and button-shaped prop spreads remain source-compatible.
 * Skin-level overloads add precise element refs for literal slotted calls.
 */
export interface AnchoredTriggerPublicProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Slotted-element props for an anchored trigger. */
export type AnchoredSlottedTriggerProps<T extends HTMLElement = HTMLElement> =
  & Omit<PolymorphicButtonAttributes<T>, "children" | "ref" | "type">
  & {
    asChild: true;
    children: React.ReactElement;
    /** Apply disabled semantics across native and non-native slotted controls. */
    disabled?: boolean;
    /** Applied only when `children` is an intrinsic `<button>`; opaque buttons own `type`. */
    type?: T extends HTMLButtonElement ? React.ButtonHTMLAttributes<HTMLButtonElement>["type"]
      : never;
    ref?: React.Ref<T>;
  };

/** Props for `AnchoredTrigger` (returned by the factory). */
export type AnchoredTriggerProps<T extends HTMLElement = HTMLElement> =
  & (AnchoredTriggerPublicProps | AnchoredSlottedTriggerProps<T>)
  & {
    /** `aria-haspopup` value -- `"dialog"` for Popover, `"menu"` for DropdownMenu. */
    haspopup: NonNullable<React.AriaAttributes["aria-haspopup"]>;
  };

/** Props for `AnchoredContent` (returned by the factory). */
export interface AnchoredContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
  /** Internal focus target used by Popover and DropdownMenu skins. */
  initialFocus?: true | string;
  /** Consumer ref for the rendered floating surface. */
  ref?: React.Ref<HTMLDivElement>;
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
    const [anchorElement, setAnchorElement] = React.useState<HTMLElement | null>(null);
    const triggerRef = React.useRef<HTMLElement | null>(null);
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
        anchorElement,
        setAnchorElement,
        triggerRef,
        defaultTriggerId,
        defaultContentId,
        triggerId,
        contentId,
        setTriggerId,
        setContentId,
      }),
      [
        anchorElement,
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
  function AnchoredTrigger<T extends HTMLElement = HTMLElement>(
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
    }: AnchoredTriggerProps<T>,
  ): React.ReactElement {
    const ctx = React.useContext(Context);
    if (!ctx) {
      throw new Error("Anchored trigger parts must be used within their root");
    }
    const resolvedId = id ?? ctx.defaultTriggerId;
    useIsomorphicLayoutEffect(() => {
      ctx.setTriggerId(resolvedId);
      return () => {
        ctx.setTriggerId((current) => current === resolvedId ? ctx.defaultTriggerId : current);
      };
    }, [ctx.defaultTriggerId, ctx.setTriggerId, resolvedId]);
    const setTriggerRef = React.useCallback((element: HTMLElement | null) => {
      ctx.triggerRef.current = element;
      ctx.anchorRef.current = element;
      ctx.setAnchorElement(element);
    }, [ctx.anchorRef, ctx.setAnchorElement, ctx.triggerRef]);
    const composedRef = React.useMemo(
      () =>
        composeRefs<HTMLElement>(
          setTriggerRef,
          ref as React.Ref<HTMLElement> | undefined,
        ),
      [ref, setTriggerRef],
    );
    const handleClick = (event: React.MouseEvent<HTMLElement>): void => {
      (onClick as React.MouseEventHandler<HTMLElement> | undefined)?.(event);
      if (!event.defaultPrevented && !disabled) ctx.setOpen(!ctx.open);
    };
    const stateProps = {
      id: resolvedId,
      "aria-haspopup": haspopup,
      "aria-expanded": ctx.open,
      "aria-controls": ctx.contentId,
      "aria-disabled": asChild && disabled ? true : undefined,
      disabled,
      onClick: handleClick,
    } as const;
    if (asChild) {
      return (
        <Slot
          {...(props as React.HTMLAttributes<HTMLElement>)}
          {...stateProps}
          type={getPolymorphicButtonType(true, children, type)}
          ref={composedRef}
        >
          {children}
        </Slot>
      );
    }
    return (
      <button
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        {...stateProps}
        type={getPolymorphicButtonType(false, children, type)}
        ref={composedRef}
      >
        {children}
      </button>
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
      ref,
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
    useIsomorphicLayoutEffect(() => {
      ctx.setContentId(resolvedId);
      return () => {
        ctx.setContentId((current) => current === resolvedId ? ctx.defaultContentId : current);
      };
    }, [ctx.defaultContentId, ctx.setContentId, resolvedId]);
    return (
      <Floating
        {...props}
        anchorRef={ctx.anchorRef}
        anchorElement={ctx.anchorElement}
        open={ctx.open}
        align={align}
        onDismiss={() => ctx.setOpen(false)}
        initialFocus={initialFocus}
        returnFocusRef={ctx.triggerRef}
        contentRef={ref}
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
