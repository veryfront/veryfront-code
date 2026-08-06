/**
 * Calendar: a dependency-free single-month date grid. Renders a header row
 * (prev-month button · "Month YYYY" caption · next-month button), a weekday
 * header, and a `role="grid"` table of days. The selected day is controlled via
 * `value`; clicking a day fires `onChange`. The displayed month is tracked
 * internally (seeded from `defaultMonth ?? value ?? today`) and moved by the
 * prev/next buttons. Self-contained: no `react-day-picker`, no floating engine;
 * skinned with the veryfront theme tokens.
 *
 * @example
 * ```tsx
 * import { Calendar } from "veryfront/ui";
 *
 * function Example() {
 *   const [day, setDay] = React.useState<Date>();
 *   return <Calendar value={day} onChange={setDay} />;
 * }
 * ```
 *
 * @module react/components/ui/calendar
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Sunday-first weekday labels; rotated when weekStartsOn === 1.
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** First day of the month `d` falls in, at local midnight. */
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** True when `a` and `b` are the same calendar day. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Chunk the flat cell list into rows of seven. */
function toWeeks(cells: Array<number | null>): Array<Array<number | null>> {
  const weeks: Array<Array<number | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Props accepted by `<Calendar>`. */
export interface CalendarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** The selected day (controlled). @default undefined */
  value?: Date;
  /** Fires with the clicked day. @default undefined */
  onChange?: (date: Date) => void;
  /** Month shown initially; the displayed month is tracked internally and moved by the prev/next buttons. @default value ?? today */
  defaultMonth?: Date;
  /** First day of the week: `0` = Sunday, `1` = Monday. @default 0 */
  weekStartsOn?: 0 | 1;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** A dependency-free single-month date grid. */
export function Calendar({
  value,
  onChange,
  defaultMonth,
  weekStartsOn = 0,
  className,
  ref,
  ...props
}: CalendarProps): React.ReactElement {
  const [displayed, setDisplayed] = React.useState<Date>(() =>
    startOfMonth(defaultMonth ?? value ?? new Date())
  );

  const today = new Date();
  const year = displayed.getFullYear();
  const month = displayed.getMonth();
  const caption = `${MONTHS[month]} ${year}`;

  const weekdays = weekStartsOn === 1 ? [...WEEKDAYS.slice(1), WEEKDAYS[0]] : WEEKDAYS;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (new Date(year, month, 1).getDay() - weekStartsOn + 7) % 7;
  const cells: Array<number | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = toWeeks(cells);

  const goPrev = () => setDisplayed(new Date(year, month - 1, 1));
  const goNext = () => setDisplayed(new Date(year, month + 1, 1));
  const select = (day: number) => onChange?.(new Date(year, month, day));

  return (
    <div
      ref={ref}
      data-month={caption}
      className={cn(
        "w-fit select-none rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={goPrev}
          className="inline-flex size-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          &#8249;
        </button>
        <div aria-live="polite" className="text-sm font-medium text-[var(--foreground)]">
          {caption}
        </div>
        <button
          type="button"
          aria-label="Next month"
          onClick={goNext}
          className="inline-flex size-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          &#8250;
        </button>
      </div>
      <table role="grid" aria-label={caption} className="border-collapse">
        <thead>
          <tr role="row" className="flex">
            {weekdays.map((label, i) => (
              <th
                key={i}
                scope="col"
                className="inline-flex size-9 items-center justify-center text-xs font-normal text-[var(--muted-foreground)]"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi} role="row" className="flex">
              {week.map((day, di) => {
                if (day == null) {
                  return <td key={di} role="gridcell" className="size-9" />;
                }
                const date = new Date(year, month, day);
                const selected = value != null && isSameDay(value, date);
                const isToday = isSameDay(today, date);
                return (
                  // aria-selected belongs on the gridcell: ARIA defines it for
                  // gridcell/option/row/tab, not for role="button". The button
                  // carries aria-pressed for its own state instead.
                  <td
                    key={di}
                    role="gridcell"
                    aria-selected={selected}
                    data-selected={selected ? "true" : undefined}
                    className="p-0"
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      data-today={isToday ? "true" : undefined}
                      onClick={() => select(day)}
                      className={cn(
                        "inline-flex size-9 items-center justify-center rounded-md text-sm text-[var(--foreground)]",
                        "hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                        isToday && "ring-1 ring-[var(--ring)]",
                        selected &&
                          "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)]",
                      )}
                    >
                      {day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
