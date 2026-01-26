import type { ErrorCodeType } from "../error-codes.js";

export interface ErrorSolution {
  code: ErrorCodeType;
  title: string;
  message: string;
  steps?: string[];
  example?: string;
  docs?: string;
  relatedErrors?: ErrorCodeType[];
  tips?: string[];
}

export type ErrorCatalog = Record<ErrorCodeType, ErrorSolution>;
export type PartialErrorCatalog = Partial<ErrorCatalog>;
