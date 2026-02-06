import type { ErrorSlug } from "../error-registry.ts";

export interface ErrorSolution {
  slug: ErrorSlug;
  title: string;
  message: string;
  steps?: string[];
  example?: string;
  docs?: string;
  relatedErrors?: ErrorSlug[];
  tips?: string[];
}

export type ErrorCatalog = Record<ErrorSlug, ErrorSolution>;
export type PartialErrorCatalog = Partial<ErrorCatalog>;
