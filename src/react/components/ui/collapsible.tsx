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
import { type RegisterDisclosurePart, useDisclosureIdRegistry } from "./disclosure-id-registry.ts";
import { composeRefs } from "./slot.tsx";

/** Props accepted by `<Collapsible>`. */
export interface CollapsibleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /**
   * Stable id for the trigger and the content's `aria-labelledby`. Required for
   * that relationship in SSR output.
   */
  triggerId?: string;
  /**
   * Stable id for the content and the trigger's `aria-controls`. Required for
   * that relationship in SSR output.
   */
  contentId?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

interface CollapsibleElementProps {
  id?: string;
  asChild?: boolean;
  children?: React.ReactNode;
}

interface CollapsibleIdContextValue {
  explicitTriggerId?: string;
  explicitContentId?: string;
  defaultContentId: string;
  triggerIds: readonly string[];
  contentIds: readonly string[];
  triggerIdsReady: boolean;
  contentIdsReady: boolean;
  registerTrigger: RegisterDisclosurePart;
  registerContent: RegisterDisclosurePart;
}

const CollapsibleIdContext = React.createContext<CollapsibleIdContextValue | null>(null);

function stableDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

function useCollapsibleIds(part: string): CollapsibleIdContextValue {
  const context = React.useContext(CollapsibleIdContext);
  if (!context) throw new Error(`${part} must be used within <Collapsible>`);
  return context;
}

function declaredTriggerId(props: CollapsibleElementProps): string | undefined {
  if (!props.asChild || !React.isValidElement<{ id?: string }>(props.children)) return props.id;
  const childId = props.children.props.id;
  if (props.id !== undefined && childId !== undefined && props.id !== childId) {
    throw new Error("CollapsibleTrigger id must match its composed child's id");
  }
  return props.id ?? childId;
}

/**
 * Collapsible root whose open-state mechanics come from the active adapter.
 * Public parts register their realized IDs through context, so opaque wrappers
 * and multiple triggers retain unique DOM IDs and synchronized ARIA references
 * without inspecting or rewriting the consumer's React tree. Supply root
 * `triggerId` and `contentId` values when the same relationships must be present
 * in static SSR output, before refs can register rendered parts.
 */
export function Collapsible(
  { children, triggerId, contentId, ...props }: CollapsibleProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  const generatedId = stableDomId(React.useId());
  const defaultContentId = contentId ?? `vf-collapsible-${generatedId}-content`;
  const triggerFallback = React.useMemo(
    () => triggerId === undefined ? [] : [triggerId],
    [triggerId],
  );
  const contentFallback = React.useMemo(() => [defaultContentId], [defaultContentId]);
  const [triggerIds, hasRegisteredTriggers, registerTrigger] = useDisclosureIdRegistry(
    "trigger",
    triggerFallback,
  );
  const [contentIds, hasRegisteredContent, registerContent] = useDisclosureIdRegistry(
    "content",
    contentFallback,
  );
  const triggerIdsReady = triggerId !== undefined || hasRegisteredTriggers;
  const contentIdsReady = contentId !== undefined || hasRegisteredContent;
  const adapterTriggerId = triggerIds.length === 1 ? triggerIds[0] : undefined;
  const adapterContentId = contentIds.length === 1 ? contentIds[0] : undefined;
  const idContext = React.useMemo<CollapsibleIdContextValue>(
    () => ({
      explicitTriggerId: triggerId,
      explicitContentId: contentId,
      defaultContentId,
      triggerIds,
      contentIds,
      triggerIdsReady,
      contentIdsReady,
      registerTrigger,
      registerContent,
    }),
    [
      triggerId,
      contentId,
      defaultContentId,
      triggerIds,
      contentIds,
      triggerIdsReady,
      contentIdsReady,
      registerTrigger,
      registerContent,
    ],
  );
  return (
    <CollapsibleIdContext.Provider value={idContext}>
      <disclosure.Root
        {...props}
        triggerId={adapterTriggerId}
        contentId={adapterContentId}
      >
        {children}
      </disclosure.Root>
    </CollapsibleIdContext.Provider>
  );
}

/** Props accepted by `<CollapsibleTrigger>`. */
export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Toggle through the active disclosure adapter. `asChild` composes onto one child. */
export function CollapsibleTrigger(
  {
    asChild,
    children,
    id,
    ref,
    "aria-controls": ariaControls,
    ...props
  }: CollapsibleTriggerProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  const ids = useCollapsibleIds("CollapsibleTrigger");
  const generatedId = stableDomId(React.useId());
  const registrationKey = `trigger-${generatedId}`;
  const declaredId = declaredTriggerId({ asChild, children, id });
  if (
    ids.explicitTriggerId !== undefined &&
    declaredId !== undefined &&
    ids.explicitTriggerId !== declaredId
  ) {
    throw new Error("Collapsible trigger id must match the triggerId owned by Collapsible");
  }
  const realizedId = declaredId ?? ids.explicitTriggerId ??
    `vf-collapsible-${generatedId}-trigger`;
  const controlledIds = ariaControls !== undefined
    ? ariaControls
    : ids.contentIdsReady
    ? ids.contentIds.join(" ") || null
    : null;
  const registrationRef = React.useCallback<React.RefCallback<HTMLButtonElement>>(
    (node) => node === null ? undefined : ids.registerTrigger(registrationKey, realizedId),
    [ids.registerTrigger, registrationKey, realizedId],
  );
  const composedRef = React.useMemo(
    () => composeRefs<HTMLButtonElement>(registrationRef, ref),
    [registrationRef, ref],
  );
  return (
    <disclosure.Trigger
      {...props}
      asChild={asChild}
      id={realizedId}
      aria-controls={controlledIds}
      ref={composedRef}
    >
      {children}
    </disclosure.Trigger>
  );
}

/** Props accepted by `<CollapsibleContent>`. */
export interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Collapsible content retained in the DOM and hidden while closed. */
export function CollapsibleContent(
  {
    children,
    id,
    ref,
    "aria-labelledby": ariaLabelledBy,
    ...props
  }: CollapsibleContentProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  const ids = useCollapsibleIds("CollapsibleContent");
  const generatedId = stableDomId(React.useId());
  const registrationKey = `content-${generatedId}`;
  if (
    ids.explicitContentId !== undefined &&
    id !== undefined &&
    ids.explicitContentId !== id
  ) {
    throw new Error("Collapsible content id must match the contentId owned by Collapsible");
  }
  const realizedId = id ?? ids.defaultContentId;
  const labelledBy = ariaLabelledBy !== undefined
    ? ariaLabelledBy
    : ids.triggerIdsReady
    ? ids.triggerIds.join(" ") || null
    : null;
  const registrationRef = React.useCallback<React.RefCallback<HTMLDivElement>>(
    (node) => node === null ? undefined : ids.registerContent(registrationKey, realizedId),
    [ids.registerContent, registrationKey, realizedId],
  );
  const composedRef = React.useMemo(
    () => composeRefs<HTMLDivElement>(registrationRef, ref),
    [registrationRef, ref],
  );
  return (
    <disclosure.Content
      {...props}
      id={realizedId}
      aria-labelledby={labelledBy}
      ref={composedRef}
    >
      {children}
    </disclosure.Content>
  );
}
