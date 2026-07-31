/**
 * Collapsible — BASIC fork of @radix-ui/react-collapsible with the same API
 * (Collapsible / CollapsibleTrigger / CollapsibleContent). Controlled or
 * uncontrolled open state; content unmounts when closed.
 *
 * The open/close MECHANICS come from the active adapter's `disclosure` slot
 * (`useAdapter().disclosure`) — zero-dependency builtin by default, swappable to
 * Base UI / Radix / React Aria / Ariakit via `UIAdapterProvider`. The skin (this
 * file) owns only the API shape; the parts self-wire through the adapter.
 *
 * @example
 * ```tsx
 * import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "veryfront/ui";
 *
 * <Collapsible>
 *   <CollapsibleTrigger>Show details</CollapsibleTrigger>
 *   <CollapsibleContent>Hidden until toggled.</CollapsibleContent>
 * </Collapsible>;
 * ```
 *
 * @module react/components/ui/collapsible
 */
import * as React from "react";
import { useAdapter } from "./adapter/context.tsx";

/** Props accepted by `<Collapsible>`. */
export interface CollapsibleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Controlled open state (pair with `onOpenChange`). */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Fires when the open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Disable the trigger. */
  disabled?: boolean;
  /** React 19: ref is a regular prop; forwarded to the wrapper node. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Collapsible root — owns open state (via the adapter's disclosure engine). */
export function Collapsible(
  { open, defaultOpen, onOpenChange, disabled, children, ...props }: CollapsibleProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  return (
    <disclosure.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={disabled}
      {...props}
    >
      {children}
    </disclosure.Root>
  );
}

/** Props accepted by `<CollapsibleTrigger>`. */
export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render as a Slot, merging the trigger behaviour onto the child element. */
  asChild?: boolean;
  /** React 19: ref is a regular prop; forwarded to the trigger node. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Toggles the collapsible. `asChild` merges onto the child element. */
export function CollapsibleTrigger(
  { children, ...props }: CollapsibleTriggerProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  return <disclosure.Trigger {...props}>{children}</disclosure.Trigger>;
}

/** Collapsible content — rendered only while open. */
export function CollapsibleContent(
  { children, ...props }: React.HTMLAttributes<HTMLDivElement> & {
    ref?: React.Ref<HTMLDivElement>;
  },
): React.ReactElement | null {
  const { disclosure } = useAdapter();
  return <disclosure.Content {...props}>{children}</disclosure.Content>;
}
