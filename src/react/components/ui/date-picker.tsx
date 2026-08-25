/**
 * DatePicker: a button that opens a {@link Popover} holding a {@link Calendar};
 * picking a day sets the value and closes the surface. Composition-only: all
 * overlay behaviour (portal into the token scope, positioning, outside-click /
 * `Escape` dismiss) is reused from Popover, and the month grid is the shared
 * Calendar: nothing is re-implemented here. Both the selected `value` and the
 * `open` state support controlled and uncontrolled use; the parts share
 * value/open/format through context. Skinned with the veryfront theme tokens.
 *
 * @example
 * ```tsx
 * import { DatePicker, DatePickerContent, DatePickerTrigger } from "veryfront/ui";
 *
 * function Example() {
 *   const [date, setDate] = React.useState<Date>();
 *   return (
 *     <DatePicker value={date} onChange={setDate}>
 *       <DatePickerTrigger />
 *       <DatePickerContent />
 *     </DatePicker>
 *   );
 * }
 * ```
 *
 * @module react/components/ui/date-picker
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Calendar } from "./calendar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";
import { composeRefs } from "./slot.tsx";

interface DatePickerContextValue {
  /** The selected day (resolved: controlled `value` or internal state). */
  value: Date | undefined;
  /** Commit a picked day (updates internal state when uncontrolled, fires `onChange`). */
  setValue: (date: Date) => void;
  /** Whether the popover is open (resolved). */
  open: boolean;
  /** Set the popover open state (updates internal state when uncontrolled, fires `onOpenChange`). */
  setOpen: (open: boolean) => void;
  /** Text shown on the trigger when no value is selected. */
  placeholder: string;
  /** Formats the selected day into the trigger's label. */
  format: (date: Date) => string;
  /** Month the calendar shows initially. */
  defaultMonth: Date | undefined;
  /** Trigger button used for focus restoration after selecting a day. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const DatePickerContext = React.createContext<DatePickerContextValue | null>(null);

function useDatePickerContext(part: string): DatePickerContextValue {
  const ctx = React.useContext(DatePickerContext);
  if (!ctx) throw new Error(`<${part}> must be used within <DatePicker>`);
  return ctx;
}

/** Props accepted by `<DatePicker>`. */
export interface DatePickerProps {
  /** The trigger and content parts to compose. */
  children: React.ReactNode;
  /** Controlled selected day (pair with `onChange`). @default undefined */
  value?: Date;
  /** Initial selected day when uncontrolled. @default undefined */
  defaultValue?: Date;
  /** Fires with the picked day. @default undefined */
  onChange?: (date: Date) => void;
  /** Controlled open state (pair with `onOpenChange`). @default undefined */
  open?: boolean;
  /** Initial open state when uncontrolled. @default false */
  defaultOpen?: boolean;
  /** Fires when the popover open state changes. @default undefined */
  onOpenChange?: (open: boolean) => void;
  /** Trigger label shown when no value is selected. @default "Pick a date" */
  placeholder?: string;
  /** Formats the selected day into the trigger's label. @default (d) => d.toLocaleDateString() */
  format?: (date: Date) => string;
  /** Month the calendar shows initially; moved internally by its prev/next buttons. @default value ?? today */
  defaultMonth?: Date;
}

/** Root: owns `{ value, open }`, provides context, and renders the Popover. */
export function DatePicker({
  children,
  value,
  defaultValue,
  onChange,
  open,
  defaultOpen,
  onOpenChange,
  placeholder = "Pick a date",
  format = (date) => date.toLocaleDateString(),
  defaultMonth,
}: DatePickerProps): React.ReactElement {
  const valueControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState<Date | undefined>(defaultValue);
  const currentValue = valueControlled ? value : internalValue;

  const openControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = React.useState<boolean>(defaultOpen ?? false);
  const currentOpen = openControlled ? open : internalOpen;
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const setValue = React.useCallback((date: Date) => {
    if (!valueControlled) setInternalValue(date);
    onChange?.(date);
  }, [valueControlled, onChange]);

  const setOpen = React.useCallback((next: boolean) => {
    if (!openControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }, [openControlled, onOpenChange]);

  const ctx = React.useMemo<DatePickerContextValue>(
    () => ({
      value: currentValue,
      setValue,
      open: currentOpen,
      setOpen,
      placeholder,
      format,
      defaultMonth,
      triggerRef,
    }),
    [currentValue, setValue, currentOpen, setOpen, placeholder, format, defaultMonth, triggerRef],
  );

  return (
    <DatePickerContext.Provider value={ctx}>
      <Popover open={currentOpen} onOpenChange={setOpen}>
        {children}
      </Popover>
    </DatePickerContext.Provider>
  );
}

/** A calendar glyph rendered at the trailing edge of the trigger. */
function CalendarIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0 text-[var(--muted-foreground)]"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

/** Props accepted by `<DatePickerTrigger>`. */
export interface DatePickerTriggerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** The field-styled button that shows the formatted value (or placeholder) and opens the popover. */
export function DatePickerTrigger({
  className,
  ref,
  ...props
}: DatePickerTriggerProps): React.ReactElement {
  const ctx = useDatePickerContext("DatePickerTrigger");
  const empty = ctx.value == null;
  const composedRef = React.useMemo(
    () => composeRefs<HTMLButtonElement>(ctx.triggerRef, ref),
    [ctx.triggerRef, ref],
  );
  return (
    <PopoverTrigger asChild>
      <button
        ref={composedRef}
        type="button"
        data-empty={empty ? "true" : undefined}
        className={cn(
          "inline-flex h-[42px] w-full items-center justify-between gap-2 rounded-md px-3 text-base",
          "border border-[var(--input)] bg-[var(--background)] text-[var(--foreground)]",
          "transition-[background-color,color] duration-150 ease-in",
          "hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          "data-[empty=true]:text-[var(--muted-foreground)]",
          className,
        )}
        {...props}
      >
        <span className="truncate">{empty ? ctx.placeholder : ctx.format(ctx.value!)}</span>
        <CalendarIcon />
      </button>
    </PopoverTrigger>
  );
}

/** Props accepted by `<DatePickerContent>`. */
export interface DatePickerContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Horizontal alignment of the surface relative to the trigger. @default "start" */
  align?: "start" | "end";
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The Popover surface wrapping the {@link Calendar}; picking a day commits it and closes. */
export function DatePickerContent({
  className,
  align = "start",
  ref,
  ...props
}: DatePickerContentProps): React.ReactElement {
  const ctx = useDatePickerContext("DatePickerContent");
  return (
    <PopoverContent
      ref={ref}
      align={align}
      className={cn("w-auto min-w-0 p-0", className)}
      {...props}
    >
      <Calendar
        value={ctx.value}
        defaultMonth={ctx.defaultMonth}
        onChange={(date) => {
          ctx.setValue(date);
          ctx.setOpen(false);
          ctx.triggerRef.current?.focus();
        }}
      />
    </PopoverContent>
  );
}
