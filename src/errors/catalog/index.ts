import type { ErrorCodeType } from "../error-codes.ts";
import type { ErrorSolution, PartialErrorCatalog } from "./types.ts";

import { BUILD_ERROR_CATALOG } from "./build-errors.ts";
import { CONFIG_ERROR_CATALOG } from "./config-errors.ts";
import { DEPLOYMENT_ERROR_CATALOG } from "./deployment-errors.ts";
import { DEV_ERROR_CATALOG } from "./dev-errors.ts";
import { GENERAL_ERROR_CATALOG } from "./general-errors.ts";
import { MODULE_ERROR_CATALOG } from "./module-errors.ts";
import { ROUTE_ERROR_CATALOG } from "./route-errors.ts";
import { RSC_ERROR_CATALOG } from "./rsc-errors.ts";
import { RUNTIME_ERROR_CATALOG } from "./runtime-errors.ts";
import { SERVER_ERROR_CATALOG } from "./server-errors.ts";

export const ERROR_CATALOG: PartialErrorCatalog = {
  ...CONFIG_ERROR_CATALOG,
  ...BUILD_ERROR_CATALOG,
  ...RUNTIME_ERROR_CATALOG,
  ...ROUTE_ERROR_CATALOG,
  ...MODULE_ERROR_CATALOG,
  ...SERVER_ERROR_CATALOG,
  ...RSC_ERROR_CATALOG,
  ...DEV_ERROR_CATALOG,
  ...DEPLOYMENT_ERROR_CATALOG,
  ...GENERAL_ERROR_CATALOG,
};

export function getErrorSolution(code: ErrorCodeType): ErrorSolution | null {
  return ERROR_CATALOG[code] ?? null;
}

export function searchErrors(query: string): ErrorSolution[] {
  const lowerQuery = query.toLowerCase();

  return Object.values(ERROR_CATALOG).filter((error) => {
    if (error.title.toLowerCase().includes(lowerQuery)) return true;
    if (error.message.toLowerCase().includes(lowerQuery)) return true;

    return error.steps?.some((step) => step.toLowerCase().includes(lowerQuery)) ?? false;
  });
}

export type { ErrorCatalog, ErrorSolution, PartialErrorCatalog } from "./types.ts";

export { createErrorSolution, createSimpleError } from "./factory.ts";

export {
  BUILD_ERROR_CATALOG,
  CONFIG_ERROR_CATALOG,
  DEPLOYMENT_ERROR_CATALOG,
  DEV_ERROR_CATALOG,
  GENERAL_ERROR_CATALOG,
  MODULE_ERROR_CATALOG,
  ROUTE_ERROR_CATALOG,
  RSC_ERROR_CATALOG,
  RUNTIME_ERROR_CATALOG,
  SERVER_ERROR_CATALOG,
};
