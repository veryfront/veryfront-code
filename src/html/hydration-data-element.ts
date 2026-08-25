/**
 * The hydration payload is an authority boundary: route code may render any
 * element inside the application root, including a duplicate id. Only the
 * unique matching element directly owned by <body> is accepted.
 */
export const HYDRATION_DATA_ELEMENT_ID = "veryfront-hydration-data";

export interface HydrationDataElementLike {
  readonly id: string;
  readonly tagName?: string;
  readonly parentElement?: unknown;
  textContent: string | null;
  getAttribute(name: string): string | null;
}

export interface HydrationDataDocumentLike {
  readonly body: {
    readonly firstElementChild?: HydrationDataElementLike | null;
  } | null;
  querySelectorAll(selector: string): Iterable<HydrationDataElementLike>;
}

/**
 * Returns the unique server-owned hydration element, or null when its direct
 * body ownership is ambiguous. Current shells place it first; legacy shells
 * place it after the application root. Nested route-owned duplicates cannot
 * satisfy either ownership check.
 */
export function findServerHydrationDataElement(
  document: HydrationDataDocumentLike,
): HydrationDataElementLike | null {
  try {
    const matches = [...document.querySelectorAll(`[id="${HYDRATION_DATA_ELEMENT_ID}"]`)];
    if (matches.length !== 1) return null;

    const body = document.body;
    if (!body) return null;
    const element = matches[0]!;
    if (body.firstElementChild !== element && element.parentElement !== body) return null;
    if (element.tagName?.toLowerCase() !== "script") return null;
    if (element.getAttribute("type")?.trim().toLowerCase() !== "application/json") return null;

    return element;
  } catch {
    return null;
  }
}
