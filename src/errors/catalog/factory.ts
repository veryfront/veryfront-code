import type { ErrorSlug } from "../error-registry.ts";
import { buildErrorDocsUrl } from "../diagnostic-policy.ts";
import type { ErrorSolution } from "./types.ts";

type ErrorSolutionConfig = Omit<ErrorSolution, "slug" | "docs"> & { docs?: string };

function freezeCopy<T>(values: readonly T[] | undefined): readonly T[] | undefined {
  return values === undefined ? undefined : Object.freeze([...values]);
}

export function createErrorSolution(
  slug: ErrorSlug,
  config: ErrorSolutionConfig,
): ErrorSolution {
  const solution: ErrorSolution = {
    ...config,
    slug,
    docs: config.docs ?? buildErrorDocsUrl(slug),
    ...(config.steps === undefined ? {} : { steps: freezeCopy(config.steps) }),
    ...(config.relatedErrors === undefined
      ? {}
      : { relatedErrors: freezeCopy(config.relatedErrors) }),
    ...(config.tips === undefined ? {} : { tips: freezeCopy(config.tips) }),
  };

  return Object.freeze(solution);
}

export function createSimpleError(
  slug: ErrorSlug,
  title: string,
  message: string,
  steps: readonly string[],
): ErrorSolution {
  return createErrorSolution(slug, { title, message, steps });
}
