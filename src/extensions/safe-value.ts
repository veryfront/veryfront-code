/**
 * Total, side-effect-contained formatting helpers for extension boundaries.
 *
 * These helpers are intentionally internal. Extension code can throw arbitrary
 * JavaScript values, including values whose coercion hooks throw.
 */

export const UnprintableThrownValue = "[unprintable thrown value]" as const;

/** Describe a thrown value without allowing its coercion hooks to escape. */
export function describeThrownValue(value: unknown): string {
  try {
    if (value instanceof Error) {
      const message = value.message;
      if (typeof message === "string" && message.length > 0) return message;
    }
  } catch {
    return UnprintableThrownValue;
  }

  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    return UnprintableThrownValue;
  }
}

/** Serialize diagnostic metadata while preserving cycles and bigint values. */
export function stringifyAuditValue(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, current: unknown) => {
      if (typeof current === "bigint") return `${current}n`;
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) return "[Circular]";
        seen.add(current);
      }
      return current;
    });
    return serialized ?? describeThrownValue(value);
  } catch (error) {
    return `[unavailable: ${describeThrownValue(error)}]`;
  }
}
