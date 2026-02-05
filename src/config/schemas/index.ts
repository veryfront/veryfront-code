/**
 * Config module schemas
 *
 * Single source of truth for config types and validation.
 * All types are inferred from Zod schemas.
 */

export {
  findUnknownTopLevelKeys,
  validateVeryfrontConfig,
  type VeryfrontConfig,
  type VeryfrontConfigInput,
  veryfrontConfigSchema,
} from "./config.schema.ts";
