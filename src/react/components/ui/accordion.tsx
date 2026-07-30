/**
 * Accordion — stacked, togglable sections. `type="single"` keeps at most one
 * section open (optionally `collapsible` back to none); `type="multiple"` lets
 * any number stay open. Self-contained (context + `aria-expanded` buttons, no
 * floating engine). Each header's open state is exposed as `data-state="open" |
 * "closed"`; skinned with the veryfront theme tokens.
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
import { Slot } from "./slot.tsx";

interface AccordionContextValue {
  value: string[];
  toggle: (itemValue: string) => void;
}
const AccordionContext = React.createContext<AccordionContextValue | null>(null);

interface AccordionItemContextValue {
  value: string;
  open: boolean;
}
const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null);

function useItem(part: string): AccordionItemContextValue {
  const ctx = React.useContext(AccordionItemContext);
  if (!ctx) throw new Error(`<${part}> must be used within <AccordionItem>`);
  return ctx;
}

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

/** A single togglable section. */
export function AccordionItem({
  value,
  className,
  children,
  ref,
  ...props
}: AccordionItemProps): React.ReactElement {
  const root = React.useContext(AccordionContext);
  const open = root?.value.includes(value) ?? false;
  const itemCtx = React.useMemo(() => ({ value, open }), [value, open]);
  return (
    <AccordionItemContext.Provider value={itemCtx}>
      <div ref={ref} data-state={open ? "open" : "closed"} className={className} {...props}>
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

/** Props accepted by `<AccordionTrigger>`. */
export interface AccordionTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render as a Slot, merging the trigger behaviour onto the child element. */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** The clickable header that toggles its section. */
export function AccordionTrigger({
  asChild = false,
  className,
  onClick,
  children,
  ref,
  ...props
}: AccordionTriggerProps): React.ReactElement {
  const root = React.useContext(AccordionContext);
  const item = useItem("AccordionTrigger");
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-expanded={item.open}
      data-state={item.open ? "open" : "closed"}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) root?.toggle(item.value);
      }}
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
    </Comp>
  );
}

/** Props accepted by `<AccordionContent>`. */
export interface AccordionContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The section body — rendered only while its section is open. */
export function AccordionContent({
  className,
  children,
  ref,
  ...props
}: AccordionContentProps): React.ReactElement | null {
  const item = useItem("AccordionContent");
  if (!item.open) return null;
  return (
    <div
      ref={ref}
      role="region"
      data-state="open"
      className={cn("pb-3 text-base text-[var(--muted-foreground)]", className)}
      {...props}
    >
      {children}
    </div>
  );
}
