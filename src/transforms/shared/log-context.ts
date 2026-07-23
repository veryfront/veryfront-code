const MAX_LOG_LABEL_LENGTH = 160;
// deno-lint-ignore no-control-regex -- log labels must stay on one terminal line.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;

function boundedLabel(value: string, fallback: string): string {
  const normalized = value.replace(CONTROL_CHARACTERS, " ").trim();
  if (!normalized) return fallback;
  return normalized.length <= MAX_LOG_LABEL_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_LOG_LABEL_LENGTH - 11)}[TRUNCATED]`;
}

/** Bound a non-sensitive diagnostic label and remove terminal control characters. */
export function textLogLabel(value: string | undefined, fallback = "unknown"): string {
  if (!value) return fallback;
  return boundedLabel(value, fallback);
}

/** Return a bounded filename without exposing its parent filesystem path. */
export function fileLogLabel(path: string | undefined): string {
  if (!path) return "unknown";
  const normalized = path.replaceAll("\\", "/");
  const withoutQuery = normalized.split(/[?#]/, 1)[0] ?? "";
  const name = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  return boundedLabel(name, "unknown");
}

/** Return only the bounded error class name for public diagnostic logs. */
export function errorLogName(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  try {
    return boundedLabel(String(error.name), "Error");
  } catch {
    return "Error";
  }
}
