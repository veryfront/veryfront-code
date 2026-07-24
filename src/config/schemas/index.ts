/**
 * Config Schemas
 *
 * @module config/schemas
 */

export {
  findUnknownTopLevelKeys,
  type VeryfrontConfigInput,
  veryfrontConfigSchema,
} from "./config.schema.ts";

import {
  validateVeryfrontConfig as validateBaseVeryfrontConfig,
  type VeryfrontConfig as BaseVeryfrontConfig,
} from "./config.schema.ts";
// Type-only reference — keeps the config layer free of a runtime dependency
// on the extensions module. The schema stores `extensions` as `unknown[]`
// at runtime; this type assertion tightens it at the TS layer.
import type { ExtensionConfigEntry } from "#veryfront/extensions/types.ts";

/**
 * Project configuration. The underlying runtime schema stores `extensions` as
 * `unknown[]`; this tightened alias surfaces the expected
 * `ExtensionConfigEntry[]` shape to TypeScript consumers.
 */
export type VeryfrontConfig =
  & Omit<BaseVeryfrontConfig, "extensions">
  & { extensions?: ExtensionConfigEntry[] };

/** Validate project config and expose the framework's public extension entry type. */
export function validateVeryfrontConfig(input: unknown): VeryfrontConfig {
  return validateBaseVeryfrontConfig(input) as VeryfrontConfig;
}
