/**
 * Errors Catalog
 *
 * @module errors/catalog
 */

import { type ErrorSlug, getAllSlugs } from "../error-registry.ts";
import type { ErrorCatalog, ErrorSolution } from "./types.ts";
import { assembleErrorCatalog } from "./assembly.ts";

import { AGENT_ERROR_CATALOG } from "./agent-errors.ts";
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

/** Immutable catalog covering every registered error slug. */
export const ERROR_CATALOG: ErrorCatalog = assembleErrorCatalog(
  [
    CONFIG_ERROR_CATALOG,
    BUILD_ERROR_CATALOG,
    RUNTIME_ERROR_CATALOG,
    ROUTE_ERROR_CATALOG,
    MODULE_ERROR_CATALOG,
    SERVER_ERROR_CATALOG,
    RSC_ERROR_CATALOG,
    DEV_ERROR_CATALOG,
    DEPLOYMENT_ERROR_CATALOG,
    AGENT_ERROR_CATALOG,
    GENERAL_ERROR_CATALOG,
  ],
  getAllSlugs(),
) as ErrorCatalog;

/** Return the solution for a registered slug, or null when it is not cataloged. */
export function getErrorSolution(slug: ErrorSlug): ErrorSolution | null {
  return Object.hasOwn(ERROR_CATALOG, slug) ? ERROR_CATALOG[slug] ?? null : null;
}

/** Search catalog titles, messages, and recovery steps case-insensitively. */
export function searchErrors(query: string): ErrorSolution[] {
  if (typeof query !== "string") throw new TypeError("query must be a string");
  if (query.length > 256) throw new TypeError("query must not exceed 256 characters");
  const lowerQuery = query.toLowerCase();

  return Object.values(ERROR_CATALOG).filter((error) => {
    if (error.title.toLowerCase().includes(lowerQuery)) return true;
    if (error.message.toLowerCase().includes(lowerQuery)) return true;

    return error.steps?.some((step) => step.toLowerCase().includes(lowerQuery)) ?? false;
  });
}

export type { ErrorCatalog, ErrorSolution, PartialErrorCatalog } from "./types.ts";
export type { ErrorSolutionConfig } from "./factory.ts";

export { createErrorSolution, createSimpleError } from "./factory.ts";

export {
  AGENT_ERROR_CATALOG,
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
