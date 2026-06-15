/**
 * Declare source-backed Work definitions for business process observability.
 *
 * @module work
 *
 * @example
 * ```ts
 * import { work } from "veryfront/work";
 *
 * export default work({
 *   id: "supplier-invoice-processing",
 *   name: "Supplier invoice processing",
 *   outcome: "Resolve all open supplier invoices.",
 *   acceptanceCriteria: [
 *     {
 *       id: "invoices_discovered",
 *       description: "Open supplier invoices have been discovered.",
 *     },
 *   ],
 * });
 * ```
 */

export type {
  WorkAcceptanceCriterion,
  WorkConfig,
  WorkDefinition,
  WorkReference,
} from "./types.ts";
export { work } from "./factory.ts";
export { workRegistry } from "./registry.ts";
