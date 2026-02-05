/**
 * Shared schemas module
 *
 * This module provides common validation schemas used across multiple modules
 * in the veryfront codebase. All types are inferred from Zod schemas to ensure
 * runtime and compile-time consistency.
 *
 * Usage:
 * ```typescript
 * import { CommonSchemas, nonEmptyString } from '#veryfront/schemas';
 *
 * const emailSchema = CommonSchemas.email;
 * const nameSchema = nonEmptyString;
 * ```
 */

export * from "./common.ts";
export * from "./primitives.ts";
