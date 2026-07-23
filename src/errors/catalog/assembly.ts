import type { ErrorSlug } from "../error-registry.ts";
import type { ErrorSolution, PartialErrorCatalog } from "./types.ts";

/** Merge catalog fragments and verify exact coverage of the required slugs. */
export function assembleErrorCatalog(
  fragments: readonly PartialErrorCatalog[],
  requiredSlugs: readonly ErrorSlug[],
): PartialErrorCatalog {
  if (!Array.isArray(fragments) || !Array.isArray(requiredSlugs)) {
    throw new TypeError("Catalog fragments and required slugs must be arrays");
  }

  const catalog = Object.create(null) as Record<string, ErrorSolution>;
  for (const fragment of fragments) {
    let entries: Array<[string, ErrorSolution]>;
    try {
      if (!fragment || typeof fragment !== "object" || Array.isArray(fragment)) {
        throw new TypeError("Invalid error catalog fragment");
      }
      entries = Object.entries(fragment) as Array<[string, ErrorSolution]>;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError("Invalid error catalog fragment");
    }

    for (const [slug, solution] of entries) {
      let solutionSlug: string;
      try {
        solutionSlug = solution.slug;
      } catch {
        throw new TypeError("Invalid error solution");
      }
      if (solutionSlug !== slug) {
        throw new TypeError(`Error solution ${solutionSlug} must match its catalog key ${slug}`);
      }
      if (Object.hasOwn(catalog, slug)) {
        throw new TypeError(`Duplicate error solution: ${slug}`);
      }
      Object.defineProperty(catalog, slug, {
        configurable: false,
        enumerable: true,
        value: solution,
        writable: false,
      });
    }
  }

  const required = new Set<string>();
  for (const slug of requiredSlugs) {
    if (typeof slug !== "string" || required.has(slug)) {
      throw new TypeError("Required error slugs must be unique strings");
    }
    required.add(slug);
    if (!Object.hasOwn(catalog, slug)) {
      throw new TypeError(`Missing error solution: ${slug}`);
    }
  }
  for (const slug of Object.keys(catalog)) {
    if (!required.has(slug)) throw new TypeError(`Unexpected error solution: ${slug}`);
  }

  return Object.freeze(catalog) as PartialErrorCatalog;
}
