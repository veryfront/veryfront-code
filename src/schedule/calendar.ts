interface CronField {
  readonly minimum: number;
  readonly maximum: number;
  readonly names?: ReadonlyMap<string, number>;
}

const DateTimeFormat = Intl.DateTimeFormat;

const MONTHS = new Map([
  ["JAN", 1],
  ["FEB", 2],
  ["MAR", 3],
  ["APR", 4],
  ["MAY", 5],
  ["JUN", 6],
  ["JUL", 7],
  ["AUG", 8],
  ["SEP", 9],
  ["OCT", 10],
  ["NOV", 11],
  ["DEC", 12],
]);

const WEEKDAYS = new Map([
  ["SUN", 0],
  ["MON", 1],
  ["TUE", 2],
  ["WED", 3],
  ["THU", 4],
  ["FRI", 5],
  ["SAT", 6],
]);

const CRON_FIELDS: readonly CronField[] = [
  { minimum: 0, maximum: 59 },
  { minimum: 0, maximum: 23 },
  { minimum: 1, maximum: 31 },
  { minimum: 1, maximum: 12, names: MONTHS },
  { minimum: 0, maximum: 7, names: WEEKDAYS },
];

const INTEGER_PATTERN = /^\d+$/;
const IANA_TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+-]*)+$/;

function parseInteger(value: string): number | null {
  if (!INTEGER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeFieldValue(
  value: string,
  field: CronField,
): { readonly text: string; readonly number: number } | null {
  const named = field.names?.get(value.toUpperCase());
  if (named !== undefined) {
    return { text: value.toUpperCase(), number: named };
  }

  const numeric = parseInteger(value);
  if (numeric === null || numeric < field.minimum || numeric > field.maximum) {
    return null;
  }
  return { text: String(numeric), number: numeric };
}

function normalizeCronItem(item: string, field: CronField): string | null {
  const stepParts = item.split("/");
  if (stepParts.length > 2 || stepParts.some((part) => part.length === 0)) {
    return null;
  }

  const base = stepParts[0]!;
  const stepText = stepParts[1];
  let normalizedBase: string;

  if (base === "*") {
    normalizedBase = base;
  } else {
    const rangeParts = base.split("-");
    if (rangeParts.length > 2 || rangeParts.some((part) => part.length === 0)) {
      return null;
    }

    const start = normalizeFieldValue(rangeParts[0]!, field);
    if (start === null) return null;

    if (rangeParts.length === 1) {
      normalizedBase = start.text;
    } else {
      const end = normalizeFieldValue(rangeParts[1]!, field);
      if (end === null || start.number > end.number) return null;
      normalizedBase = `${start.text}-${end.text}`;
    }
  }

  if (stepText === undefined) return normalizedBase;

  const step = parseInteger(stepText);
  const fieldWidth = field.maximum - field.minimum + 1;
  if (step === null || step < 1 || step > fieldWidth) return null;
  return `${normalizedBase}/${step}`;
}

function normalizeCronField(value: string, field: CronField): string | null {
  const items = value.split(",");
  if (items.some((item) => item.length === 0)) return null;

  const normalized: string[] = [];
  for (const item of items) {
    const candidate = normalizeCronItem(item, field);
    if (candidate === null) return null;
    normalized.push(candidate);
  }
  return normalized.join(",");
}

/**
 * Normalize a bounded, whitespace-canonical five-field cron expression.
 *
 * The caller owns length and control-character checks. Returning `null`
 * indicates unsupported syntax or an out-of-range field.
 */
export function normalizeCronExpression(value: string): string | null {
  const fields = value.trim().split(/ +/);
  if (fields.length !== CRON_FIELDS.length) return null;

  const normalized: string[] = [];
  for (let index = 0; index < CRON_FIELDS.length; index++) {
    const field = normalizeCronField(fields[index]!, CRON_FIELDS[index]!);
    if (field === null) return null;
    normalized.push(field);
  }
  return normalized.join(" ");
}

/**
 * Return whether `value` is a portable IANA-style timezone recognized by the
 * current runtime. Raw UTC offsets are intentionally excluded.
 */
export function isSupportedIanaTimezone(value: string): boolean {
  if (value !== "UTC" && !IANA_TIMEZONE_PATTERN.test(value)) return false;
  try {
    new DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
