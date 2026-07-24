import type { ErrorSlug } from "../error-registry.ts";

export interface ErrorSolution {
  readonly slug: ErrorSlug;
  readonly title: string;
  readonly message: string;
  readonly steps?: readonly string[];
  readonly example?: string;
  readonly docs?: string;
  readonly relatedErrors?: readonly ErrorSlug[];
  readonly tips?: readonly string[];
}

export type ErrorCatalog = Readonly<Record<ErrorSlug, ErrorSolution>>;
export type PartialErrorCatalog = Readonly<Partial<Record<ErrorSlug, ErrorSolution>>>;
