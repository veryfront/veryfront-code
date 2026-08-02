/**
 * Collapsible skin routed through the active adapter's disclosure mechanics.
 * The dependency-free builtin provides controlled or uncontrolled state,
 * stable ARIA control wiring, and content retained as `hidden` while closed so
 * hydration and stateful descendants remain deterministic.
 *
 * @module react/components/ui/collapsible
 */
import * as React from "react";
import { useAdapter } from "./adapter/context.tsx";

/** Props accepted by `<Collapsible>`. */
export interface CollapsibleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** Stable id for the trigger and the content's `aria-labelledby`. */
  triggerId?: string;
  /** Stable id for the content and the trigger's `aria-controls`. */
  contentId?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Collapsible root whose open-state mechanics come from the active adapter. */
export function Collapsible(
  { children, ...props }: CollapsibleProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  return (
    <disclosure.Root {...props}>
      {children}
    </disclosure.Root>
  );
}

/** Props accepted by `<CollapsibleTrigger>`. */
export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Toggle through the active disclosure adapter. `asChild` composes onto one child. */
export function CollapsibleTrigger(props: CollapsibleTriggerProps): React.ReactElement {
  const { disclosure } = useAdapter();
  return <disclosure.Trigger {...props} />;
}

/** Collapsible content retained in the DOM and hidden while closed. */
export function CollapsibleContent(
  props: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  const { disclosure } = useAdapter();
  return <disclosure.Content {...props} />;
}
