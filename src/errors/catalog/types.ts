import type { ErrorSlug } from "../error-registry.ts";

/** User-facing explanation and recovery guidance for one registered error. */
export interface ErrorSolution {
  /** Registered error slug. */
  readonly slug: ErrorSlug;
  /** Short user-facing title. */
  readonly title: string;
  /** Explanation of the failure. */
  readonly message: string;
  /** Ordered recovery actions. */
  readonly steps?: readonly string[];
  /** Complete usage or recovery example. */
  readonly example?: string;
  /** Documentation URL. */
  readonly docs?: string;
  /** Related registered errors. */
  readonly relatedErrors?: readonly ErrorSlug[];
  /** Optional diagnostic guidance. */
  readonly tips?: readonly string[];
}

/** Complete mapping from registered slugs to solutions. */
export type ErrorCatalog = Readonly<Record<ErrorSlug, ErrorSolution>>;
/** Catalog fragment containing a subset of registered errors. */
export type PartialErrorCatalog = Readonly<Partial<ErrorCatalog>>;
