/**
 * Accordion — stacked, togglable sections. `type="single"` keeps at most one
 * section open (optionally `collapsible` back to none); `type="multiple"` lets
 * any number stay open. The Accordion owns the single/multiple/collapsible
 * coordination; each item's collapse MECHANICS come from the active adapter's
 * `disclosure` slot (`useAdapter().disclosure`), controlled by that coordination
 * — so an engine swap drives every item's collapse. Each header's open state is
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
 *     <AccordionContent>Ships in 2–3 days.</AccordionContent>
 *   </AccordionItem>
 * </Accordion>;
 * ```
 *
 * @module react/components/ui/accordion
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { useAdapter } from "./adapter/context.tsx";

interface AccordionContextValue {
  value: string[];
  toggle: (itemValue: string) => void;
}
const AccordionContext = React.createContext<AccordionContextValue | null>(null);

function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Props accepted by `<Accordion>`. */
export interface AccordionProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  /** `single` — at most one section open; `multiple` — any number. @default "single" */
  type?: "single" | "multiple";
  /** When `type="single"`, allow closing the open section back to none. */
  collapsible?: boolean;
  /** Controlled open value(s). `string` for `single`, `string[]` for `multiple`. */
  value?: string | string[];
  /** Initial open value(s) when uncontrolled. */
  defaultValue?: string | string[];
  /** Fires with the next open value(s) (same shape as `value`). */
  onValueChange?: (value: string | string[]) => void;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

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
  const [internal, setInternal] = React.useState<string[]>(() => toArray(defaultValue));
  const open = isControlled ? toArray(value) : internal;

  const toggle = React.useCallback((itemValue: string) => {
    let next: string[];
    if (type === "single") {
      const isOpen = open[0] === itemValue;
      next = isOpen ? (collapsible ? [] : open) : [itemValue];
    } else {
      next = open.includes(itemValue) ? open.filter((v) => v !== itemValue) : [...open, itemValue];
    }
    if (!isControlled) setInternal(next);
    onValueChange?.(type === "single" ? (next[0] ?? "") : next);
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
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * A single togglable section. Its open/collapse MECHANICS come from the active
 * adapter's `disclosure` slot (controlled by the Accordion's single/multiple
 * coordination) — so an engine swap drives every item's collapse while the
 * Accordion keeps owning which sections may be open.
 */
export function AccordionItem(
  { value, className, children, ...props }: AccordionItemProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  const root = React.useContext(AccordionContext);
  const open = root?.value.includes(value) ?? false;
  return (
    <disclosure.Root
      open={open}
      onOpenChange={() => root?.toggle(value)}
      data-value={value}
      className={className}
      {...props}
    >
      {children}
    </disclosure.Root>
  );
}

/** Props accepted by `<AccordionTrigger>`. */
export interface AccordionTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render as a Slot, merging the trigger behaviour onto the child element. */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** The clickable header that toggles its section (via the disclosure slot). */
export function AccordionTrigger(
  { className, children, ...props }: AccordionTriggerProps,
): React.ReactElement {
  const { disclosure } = useAdapter();
  return (
    <disclosure.Trigger
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
  );
}

/** Props accepted by `<AccordionContent>`. */
export interface AccordionContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The section body — rendered only while its section is open (via the slot). */
export function AccordionContent(
  { className, children, ...props }: AccordionContentProps,
): React.ReactElement | null {
  const { disclosure } = useAdapter();
  return (
    <disclosure.Content
      role="region"
      className={cn("pb-3 text-base text-[var(--muted-foreground)]", className)}
      {...props}
    >
      {children}
    </disclosure.Content>
  );
}
