import { isDataControlResult } from "#veryfront/data/helpers.ts";
import type { DataResult } from "#veryfront/data/types.ts";

export type SSRControlOutcome =
  | { kind: "not-found" }
  | {
    kind: "redirect";
    location: string;
    permanent: boolean;
  };

export function findSSRControlOutcome(error: unknown): SSRControlOutcome | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;

    if (isDataControlResult(current)) {
      return toSSRControlOutcome(current);
    }

    seen.add(current);
    stack.push((current as { cause?: unknown }).cause);
    const aggregated = (current as { errors?: unknown }).errors;
    if (Array.isArray(aggregated)) stack.push(...aggregated);
  }

  return null;
}

export function isSSRControlOutcome(error: unknown): boolean {
  return findSSRControlOutcome(error) !== null;
}

function toSSRControlOutcome(result: DataResult): SSRControlOutcome {
  if (result.redirect) {
    return {
      kind: "redirect",
      location: result.redirect.destination,
      permanent: result.redirect.permanent === true,
    };
  }

  return { kind: "not-found" };
}
