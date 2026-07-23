import { ERROR_CATALOG } from "../catalog/index.ts";
import type { ErrorSolution as CatalogErrorSolution } from "../catalog/types.ts";
import type { ErrorSlug } from "../error-registry.ts";

/** Compatibility view of a canonical error solution. */
export type ErrorSolution = Pick<
  CatalogErrorSolution,
  "message" | "steps" | "example" | "docs"
>;

const LEGACY_SOLUTION_ALIASES = Object.freeze(
  {
    "missing-config": "config-not-found",
    "invalid-config": "config-invalid",
    "invalid-route": "invalid-route-file",
    "client-boundary": "client-boundary-violation",
    "import-not-found": "import-resolution-error",
    "port-in-use": "port-in-use",
    "build-failed": "build-failed",
    "missing-deps": "dependency-missing",
  } satisfies Record<string, ErrorSlug>,
);

/**
 * Compatibility aliases backed by the canonical error catalog.
 */
export const ERROR_SOLUTIONS: Readonly<Record<string, ErrorSolution>> = Object.freeze(
  Object.entries(LEGACY_SOLUTION_ALIASES).reduce<Record<string, ErrorSolution>>(
    (solutions, [alias, slug]) => {
      const solution = ERROR_CATALOG[slug];
      if (!solution) throw new TypeError(`Missing canonical error solution: ${slug}`);
      Object.defineProperty(solutions, alias, {
        configurable: false,
        enumerable: true,
        value: solution,
        writable: false,
      });
      return solutions;
    },
    Object.create(null) as Record<string, ErrorSolution>,
  ),
);
