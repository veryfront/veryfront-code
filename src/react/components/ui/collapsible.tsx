/**
 * Collapsible — BASIC fork of @radix-ui/react-collapsible with the same API
 * (Collapsible / CollapsibleTrigger / CollapsibleContent). Controlled or
 * uncontrolled open state; content unmounts when closed.
 *
 * TODO(a11y): id-wired `aria-controls`, height transition
 * (`--radix-collapsible-content-height`), `hidden` instead of unmount for
 * find-in-page. Private to the chat module.
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
import { Slot } from "./slot.tsx";
import { useDisclosure } from "./disclosure.ts";

const CollapsibleContext = React.createContext<
  { open: boolean; toggle: () => void; disabled?: boolean } | null
>(null);

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
}

/** Collapsible root — owns open state. */
export function Collapsible({
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  children,
  ...props
}: CollapsibleProps): React.ReactElement {
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const toggle = React.useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);
  return (
    <div data-state={isOpen ? "open" : "closed"} {...props}>
      <CollapsibleContext.Provider value={{ open: isOpen, toggle, disabled }}>
        {children}
      </CollapsibleContext.Provider>
    </div>
  );
}

/** Props accepted by `<CollapsibleTrigger>`. */
export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render as a Slot, merging the trigger behaviour onto the child element. */
  asChild?: boolean;
}

/** Toggles the collapsible. `asChild` merges onto the child element. */
export function CollapsibleTrigger({
  asChild,
  onClick,
  children,
  ...props
}: CollapsibleTriggerProps): React.ReactElement {
  const ctx = React.useContext(CollapsibleContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      aria-expanded={ctx?.open}
      data-state={ctx?.open ? "open" : "closed"}
      disabled={ctx?.disabled}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        ctx?.toggle();
      }}
      {...props}
    >
      {children}
    </Comp>
  );
}

/** Collapsible content — rendered only while open. */
export function CollapsibleContent(
  { children, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement | null {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx?.open) return null;
  return (
    <div data-state="open" {...props}>
      {children}
    </div>
  );
}
