export type { ErrorCatalog, ErrorSolution } from "./catalog/types.ts";
export { ERROR_CATALOG, getErrorSolution, searchErrors } from "./catalog/index.ts";

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
} from "./catalog/index.ts";
