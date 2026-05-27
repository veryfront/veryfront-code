import type { InitRuntime } from "./types.ts";

const VALID_RUNTIMES: readonly InitRuntime[] = ["node", "bun", "deno"];

/**
 * Validate an unknown value (from CLI args or a config file) and return it
 * as an `InitRuntime`. Throws with an actionable error when the value is
 * not one of `node | bun | deno`.
 */
export function parseRuntime(value: unknown): InitRuntime {
  if (
    typeof value === "string" &&
    (VALID_RUNTIMES as readonly string[]).includes(value)
  ) {
    return value as InitRuntime;
  }
  throw new Error(
    `Invalid runtime value: ${JSON.stringify(value)}. ` +
      `Must be one of: ${VALID_RUNTIMES.join(", ")}.`,
  );
}
