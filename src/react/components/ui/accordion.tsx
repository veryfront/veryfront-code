/**
 * Accordion: stacked, togglable sections. `type="single"` keeps at most one
 * section open (optionally `collapsible` back to none); `type="multiple"` lets
 * any number stay open. The Accordion owns the single/multiple/collapsible
 * coordination; each item's collapse MECHANICS come from the active adapter's
 * `disclosure` slot (`useAdapter().disclosure`), controlled by that coordination
 * - so an engine swap drives every item's collapse. Each header's open state is
 * exposed as `data-state="open" | "closed"`; skinned with the veryfront theme
 * tokens.
 *
 * @example Single, collapsible
 * ```tsx
 * import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "veryfront/ui";
 *
 * <Accordion type="single" collapsible defaultValue="a">
 *   <AccordionItem value="a">
 *     <AccordionTrigger>Shipping</AccordionTrigger>
 *     <AccordionContent>Ships in 2-3 days.</AccordionContent>
 *   </AccordionItem>
 * </Accordion>;
 * ```
 *
 * @module react/components/ui/accordion
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { useAdapter } from "./adapter/context.tsx";
import { type RegisterDisclosurePart, useDisclosureIdRegistry } from "./disclosure-id-registry.ts";
import { composeRefs } from "./slot.tsx";

interface AccordionContextValue {
  value: string[];
  toggle: (itemValue: string) => void;
}
const AccordionContext = React.createContext<AccordionContextValue | null>(null);
interface AccordionItemContextValue {
  explicitTriggerId?: string;
  defaultTriggerId: string;
  triggerIds: readonly string[];
  registerTrigger: RegisterDisclosurePart;
  contentId: string;
}
const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null);

function useAccordionContext(): AccordionContextValue {
  const context = React.useContext(AccordionContext);
  if (!context) throw new Error("AccordionItem must be used within <Accordion>");
  return context;
}

function normalizeValue(
  type: "single" | "multiple",
  value: string | string[] | undefined,
): string[] {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return type === "single" ? values.slice(0, 1) : values;
}

/** Props accepted by `<Accordion>`. */
interface AccordionBaseProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  children?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
}

export interface SingleAccordionProps extends AccordionBaseProps {
  type?: "single";
  /** When `type="single"`, allow closing the open section back to none. */
  collapsible?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export interface MultipleAccordionProps extends AccordionBaseProps {
  type: "multiple";
  collapsible?: never;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
}

export type AccordionProps = SingleAccordionProps | MultipleAccordionProps;

/** Render a set of togglable sections. */
export function Accordion({
  type = "single",
  collapsible = false,
  value,
  defaultValue,
  onValueChange,
  className,
  children,
  ref,
  ...props
}: AccordionProps): React.ReactElement {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string[]>(() =>
    normalizeValue(type, defaultValue)
  );
  const open = normalizeValue(type, isControlled ? value : internal);

  React.useEffect(() => {
    if (!isControlled) setInternal((current) => normalizeValue(type, current));
  }, [isControlled, type]);

  const toggle = React.useCallback((itemValue: string) => {
    let next: string[];
    if (type === "single") {
      const isOpen = open[0] === itemValue;
      next = isOpen ? (collapsible ? [] : open) : [itemValue];
    } else {
      next = open.includes(itemValue) ? open.filter((v) => v !== itemValue) : [...open, itemValue];
    }
    if (next.length === open.length && next.every((item, index) => item === open[index])) return;
    if (!isControlled) setInternal(next);
    if (type === "single") {
      (onValueChange as ((value: string) => void) | undefined)?.(next[0] ?? "");
    } else {
      (onValueChange as ((value: string[]) => void) | undefined)?.(next);
    }
  }, [type, collapsible, open, isControlled, onValueChange]);

  const ctx = React.useMemo<AccordionContextValue>(() => ({ value: open, toggle }), [open, toggle]);

  return (
    <AccordionContext.Provider value={ctx}>
      <div
        ref={ref}
        data-type={type}
        className={cn(
          "divide-y divide-[var(--separator)] border-y border-[var(--separator)]",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

/** Props accepted by `<AccordionItem>`. */
export interface AccordionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Identifies this section within the accordion's open value(s). */
  value: string;
  /**
   * Stable id for the trigger and the content's `aria-labelledby`. Set this to
   * a custom composed-child id when static SSR content must reference that
   * child directly; otherwise the containing heading is the pre-hydration
   * label.
   */
  triggerId?: string;
  /** Stable id for the content and the trigger's `aria-controls`. */
  contentId?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * A single togglable section. Its open/collapse MECHANICS come from the active
 * adapter's `disclosure` slot (controlled by the Accordion's single/multiple
 * coordination), so an engine swap drives every item's collapse while the
 * Accordion keeps owning which sections may be open.
 */
export function AccordionItem(
  {
    value,
    className,
    children,
    triggerId: explicitTriggerId,
    contentId: explicitContentId,
    ...props
  }: AccordionItemProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  const root = useAccordionContext();
  const open = root.value.includes(value);
  const generatedId = React.useId().replace(/[^A-Za-z0-9_-]/g, "");
  const defaultTriggerId = explicitTriggerId ??
    `vf-accordion-${generatedId}-trigger`;
  const contentId = explicitContentId ??
    `vf-accordion-${generatedId}-content`;
  const triggerFallback = React.useMemo(() => [defaultTriggerId], [defaultTriggerId]);
  const [triggerIds, , registerTrigger] = useDisclosureIdRegistry(
    "trigger",
    triggerFallback,
  );
  const triggerId = triggerIds.length === 1 ? triggerIds[0] : undefined;
  const itemContext = React.useMemo(
    () => ({
      explicitTriggerId,
      defaultTriggerId,
      triggerIds,
      registerTrigger,
      contentId,
    }),
    [explicitTriggerId, defaultTriggerId, triggerIds, registerTrigger, contentId],
  );
  return (
    <disclosure.Root
      open={open}
      triggerId={triggerId}
      contentId={contentId}
      onOpenChange={(nextOpen) => {
        if (nextOpen !== open) root.toggle(value);
      }}
      data-value={value}
      className={className}
      {...props}
    >
      <AccordionItemContext.Provider value={itemContext}>
        {children}
      </AccordionItemContext.Provider>
    </disclosure.Root>
  );
}

/** Props accepted by `<AccordionTrigger>`. */
export interface AccordionTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render as a Slot, merging the trigger behaviour onto the child element. */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
  /** Semantic heading level wrapped around the trigger. @default 3 */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}

/** The clickable header that toggles its section (via the disclosure slot). */
export function AccordionTrigger(
  {
    asChild,
    className,
    children,
    id,
    ref,
    headingLevel = 3,
    ...props
  }: AccordionTriggerProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  const item = React.useContext(AccordionItemContext);
  if (!item) throw new Error("AccordionTrigger must be used within <AccordionItem>");
  const childId = asChild && React.isValidElement<{ id?: string }>(children)
    ? children.props.id
    : undefined;
  if (id !== undefined && childId !== undefined && id !== childId) {
    throw new Error("AccordionTrigger id must match its composed child's id");
  }
  const declaredId = id ?? childId;
  if (
    item.explicitTriggerId !== undefined && declaredId !== undefined &&
    declaredId !== item.explicitTriggerId
  ) {
    throw new Error("AccordionTrigger id must match the triggerId owned by AccordionItem");
  }
  const realizedId = declaredId ?? item.defaultTriggerId;
  const generatedId = React.useId().replace(/[^A-Za-z0-9_-]/g, "");
  const registrationKey = `accordion-trigger-${generatedId}`;
  const registrationRef = React.useCallback<React.RefCallback<HTMLButtonElement>>(
    (node) => node === null ? undefined : item.registerTrigger(registrationKey, realizedId),
    [item.registerTrigger, registrationKey, realizedId],
  );
  const composedRef = React.useMemo(
    () => composeRefs<HTMLButtonElement>(registrationRef, ref),
    [registrationRef, ref],
  );
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6";
  const fallbackHeadingId = realizedId === item.defaultTriggerId
    ? undefined
    : item.defaultTriggerId;
  return (
    <Heading id={fallbackHeadingId}>
      <disclosure.Trigger
        asChild={asChild}
        id={realizedId}
        ref={composedRef}
        aria-controls={item.contentId}
        className={cn(
          "flex w-full items-center justify-between gap-2 py-3 text-left text-base font-medium",
          "text-[var(--foreground)] transition-colors hover:text-[var(--foreground)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
          "[&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
      </disclosure.Trigger>
    </Heading>
  );
}

/** Props accepted by `<AccordionContent>`. */
export interface AccordionContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The section body: retained in the DOM and hidden while its section is closed. */
export function AccordionContent(
  {
    className,
    children,
    id,
    "aria-labelledby": ariaLabelledBy,
    ...props
  }: AccordionContentProps,
): React.ReactElement | null {
  const { disclosure } = useAdapter();
  const item = React.useContext(AccordionItemContext);
  if (!item) throw new Error("AccordionContent must be used within <AccordionItem>");
  if (id !== undefined && id !== item.contentId) {
    throw new Error("AccordionContent id must match the contentId owned by AccordionItem");
  }
  const realizedId = id ?? item.contentId;
  return (
    <disclosure.Content
      id={realizedId}
      role="region"
      aria-labelledby={ariaLabelledBy ?? item.triggerIds.join(" ")}
      className={cn("pb-3 text-base text-[var(--muted-foreground)]", className)}
      {...props}
    >
      {children}
    </disclosure.Content>
  );
}
