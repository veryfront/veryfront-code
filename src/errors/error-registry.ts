import {
  composeErrorRegistry,
  getRegistryEntriesByCategory,
  getRegistryEntry,
  getRegistrySlugs,
} from "./error-registry-helpers.ts";
import { type ErrorCategory } from "./types.ts";

// Error definitions live in per-category modules under ./error-registry/.
// This barrel re-exports them and assembles the slug → definition registry.
import { CONFIG_REGISTRY } from "./error-registry/config.ts";
import { BUILD_REGISTRY } from "./error-registry/build.ts";
import { RUNTIME_REGISTRY } from "./error-registry/runtime.ts";
import { ROUTE_REGISTRY } from "./error-registry/route.ts";
import { MODULE_REGISTRY } from "./error-registry/module.ts";
import { SERVER_REGISTRY } from "./error-registry/server.ts";
import { BOUNDARY_REGISTRY } from "./error-registry/boundary.ts";
import { DEV_REGISTRY } from "./error-registry/dev.ts";
import { DEPLOY_REGISTRY } from "./error-registry/deploy.ts";
import { AGENT_REGISTRY } from "./error-registry/agent.ts";
import { GENERAL_REGISTRY } from "./error-registry/general.ts";

export * from "./error-registry/config.ts";
export * from "./error-registry/build.ts";
export * from "./error-registry/runtime.ts";
export * from "./error-registry/route.ts";
export * from "./error-registry/module.ts";
export * from "./error-registry/server.ts";
export * from "./error-registry/boundary.ts";
export * from "./error-registry/dev.ts";
export * from "./error-registry/deploy.ts";
export * from "./error-registry/agent.ts";
export * from "./error-registry/general.ts";

/**
 * Central registry mapping every error slug to its definition. Assembled from
 * the per-category registry fragments.
 */
export const ERROR_REGISTRY = composeErrorRegistry(
  CONFIG_REGISTRY,
  BUILD_REGISTRY,
  RUNTIME_REGISTRY,
  ROUTE_REGISTRY,
  MODULE_REGISTRY,
  SERVER_REGISTRY,
  BOUNDARY_REGISTRY,
  DEV_REGISTRY,
  DEPLOY_REGISTRY,
  AGENT_REGISTRY,
  GENERAL_REGISTRY,
);

export type ErrorSlug = keyof typeof ERROR_REGISTRY;

/**
 * Get an error definition by slug
 */
export function getErrorBySlug(slug: ErrorSlug) {
  return getRegistryEntry(ERROR_REGISTRY, slug);
}

/**
 * Get all errors in a category
 */
export function getErrorsByCategory(category: ErrorCategory) {
  return getRegistryEntriesByCategory(ERROR_REGISTRY, category);
}

/**
 * Get all registered slugs
 */
export function getAllSlugs(): ErrorSlug[] {
  return getRegistrySlugs(ERROR_REGISTRY) as ErrorSlug[];
}
