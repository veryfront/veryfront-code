import { ensureError, INVALID_ARGUMENT } from "#veryfront/errors";

/**
 * Store a selected output in the JSON form every backend persists, so the
 * memory and Redis backends read back the same value. A value JSON cannot
 * represent (a function, a symbol, a bigint) fails the run.
 */
export function toJsonOutput(selected: unknown): unknown {
  if (selected === undefined) return undefined;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(selected);
  } catch (error) {
    throw INVALID_ARGUMENT.create({
      detail: `Workflow output is not JSON-serializable: ${ensureError(error).message}`,
    });
  }
  if (serialized === undefined) {
    throw INVALID_ARGUMENT.create({
      detail: `Workflow output is not JSON-serializable (got ${typeof selected})`,
    });
  }
  return JSON.parse(serialized);
}
