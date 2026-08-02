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

interface DeclaredPartIds {
  triggerId?: string;
  contentId?: string;
}

interface CollapsibleElementProps {
  id?: string;
  asChild?: boolean;
  children?: React.ReactNode;
}

function declaredTriggerId(props: CollapsibleElementProps): string | undefined {
  if (!props.asChild || !React.isValidElement<{ id?: string }>(props.children)) return props.id;
  const childId = props.children.props.id;
  if (props.id !== undefined && childId !== undefined && props.id !== childId) {
    throw new Error("CollapsibleTrigger id must match its composed child's id");
  }
  return props.id ?? childId;
}

function collectDeclaredPartIds(children: React.ReactNode): DeclaredPartIds {
  const ids: DeclaredPartIds = {};

  const visit = (nodes: React.ReactNode): void => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement<CollapsibleElementProps>(child)) return;
      if (child.type === Collapsible) return;

      if (child.type === CollapsibleTrigger) {
        ids.triggerId ??= declaredTriggerId(child.props);
        return;
      }
      if (child.type === CollapsibleContent) {
        ids.contentId ??= child.props.id;
        return;
      }

      // Inspect transparent fragments and host wrappers only. Function
      // components are opaque and may discard or replace their children.
      if (child.type === React.Fragment || typeof child.type === "string") {
        visit(child.props.children);
      }
    });
  };

  visit(children);
  return ids;
}

function resolvePartId(
  part: "trigger" | "content",
  rootId: string | undefined,
  declaredId: string | undefined,
): string | undefined {
  if (rootId !== undefined && declaredId !== undefined && rootId !== declaredId) {
    throw new Error(
      `Collapsible ${part} id must match the ${part}Id owned by Collapsible`,
    );
  }
  return rootId ?? declaredId;
}

/** Collapsible root whose open-state mechanics come from the active adapter. */
export function Collapsible(
  { children, triggerId, contentId, ...props }: CollapsibleProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  const declaredIds = collectDeclaredPartIds(children);
  const resolvedTriggerId = resolvePartId("trigger", triggerId, declaredIds.triggerId);
  const resolvedContentId = resolvePartId("content", contentId, declaredIds.contentId);
  return (
    <disclosure.Root
      {...props}
      triggerId={resolvedTriggerId}
      contentId={resolvedContentId}
    >
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
