/**
 * OpenAPI Route Types
 *
 * Types for defining OpenAPI-documented routes with Zod schema validation.
 *
 * @module routing/api/openapi/types
 */
/**
 * Symbol for storing OpenAPI metadata on handler functions.
 * Using a Symbol ensures the metadata doesn't conflict with other properties.
 */
export const OPENAPI_METADATA = Symbol.for("veryfront.openapi.metadata");
