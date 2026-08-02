/**
 * Dependency-free collapsible disclosure with controlled or uncontrolled
 * state, stable ARIA control wiring, and content retained as `hidden` while
 * closed so hydration and stateful descendants remain deterministic.
 *
 * @module react/components/ui/collapsible
 */
import * as React from "react";
import { Slot } from "./slot.tsx";
import { useDisclosure } from "./disclosure.ts";

const CollapsibleContext = React.createContext<
  {
    open: boolean;
    toggle: () => void;
    contentId: string;
    disabled?: boolean;
  } | null
>(null);

function stableDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

/** Props accepted by `<Collapsible>`. */
export interface CollapsibleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Collapsible root — owns open state. */
export function Collapsible({
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  children,
  ref,
  ...props
}: CollapsibleProps): React.ReactElement {
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const toggle = React.useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);
  const contentId = `vf-collapsible-${stableDomId(React.useId())}-content`;
  return (
    <div {...props} ref={ref} data-state={isOpen ? "open" : "closed"}>
      <CollapsibleContext.Provider
        value={{ open: isOpen, toggle, contentId, disabled }}
      >
        {children}
      </CollapsibleContext.Provider>
    </div>
  );
}

/** Props accepted by `<CollapsibleTrigger>`. */
export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Toggles the collapsible. `asChild` merges onto the child element. */
export function CollapsibleTrigger({
  asChild,
  onClick,
  disabled,
  ref,
  children,
  ...props
}: CollapsibleTriggerProps): React.ReactElement {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx) {
    throw new Error("CollapsibleTrigger must be used within <Collapsible>");
  }
  const Comp = asChild ? Slot : "button";
  const isDisabled = Boolean(ctx.disabled || disabled);
  return (
    <Comp
      {...props}
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      aria-expanded={ctx.open}
      aria-controls={ctx.contentId}
      aria-disabled={asChild && isDisabled ? true : undefined}
      data-state={ctx.open ? "open" : "closed"}
      disabled={isDisabled}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (!e.defaultPrevented && !isDisabled) ctx.toggle();
      }}
    >
      {children}
    </Comp>
  );
}

/** Collapsible content — rendered only while open. */
export function CollapsibleContent(
  { children, hidden, id, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx) {
    throw new Error("CollapsibleContent must be used within <Collapsible>");
  }
  return (
    <div
      {...props}
      id={id ?? ctx.contentId}
      data-state={ctx.open ? "open" : "closed"}
      hidden={Boolean(hidden || !ctx.open)}
    >
      {children}
    </div>
  );
}
