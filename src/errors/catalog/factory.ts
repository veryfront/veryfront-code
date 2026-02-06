import type { ErrorSlug } from "../error-registry.ts";
import type { ErrorSolution } from "./types.ts";

type ErrorSolutionConfig = Omit<ErrorSolution, "slug" | "docs"> & { docs?: string };

export function createErrorSolution(
  slug: ErrorSlug,
  config: ErrorSolutionConfig,
): ErrorSolution {
  return {
    ...config,
    slug,
    docs: config.docs ?? `https://veryfront.com/docs/errors/${slug}`,
  };
}

export function createSimpleError(
  slug: ErrorSlug,
  title: string,
  message: string,
  steps: string[],
): ErrorSolution {
  return createErrorSolution(slug, { title, message, steps });
}
