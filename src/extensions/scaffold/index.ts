/**
 * Scaffold-provider contract and runtime trust-boundary helpers.
 *
 * @module extensions/scaffold
 */

export type {
  ScaffoldCatalog,
  ScaffoldCatalogEntry,
  ScaffoldEnvironmentVariable,
  ScaffoldFile,
  ScaffoldPackageContribution,
  ScaffoldPackageRecord,
  ScaffoldPlan,
  ScaffoldProvider,
  ScaffoldRequest,
  ScaffoldRuntime,
} from "./scaffold-provider.ts";
export { SCAFFOLD_PROVIDER_API_VERSION, ScaffoldProviderName } from "./scaffold-provider.ts";

export type { ScaffoldSnapshotErrorCode } from "./snapshot.ts";
export {
  captureScaffoldProvider,
  SCAFFOLD_MAX_CATALOG_ENTRIES,
  SCAFFOLD_MAX_ENVIRONMENT_VARIABLES,
  SCAFFOLD_MAX_FILE_BYTES,
  SCAFFOLD_MAX_FILES,
  SCAFFOLD_MAX_ID_LENGTH,
  SCAFFOLD_MAX_NOTICES,
  SCAFFOLD_MAX_PACKAGE_RECORDS,
  SCAFFOLD_MAX_SELECTION_IDS,
  SCAFFOLD_MAX_TEXT_BYTES,
  SCAFFOLD_MAX_TOTAL_FILE_BYTES,
  ScaffoldSnapshotError,
  snapshotScaffoldCatalog,
  snapshotScaffoldPlan,
  snapshotScaffoldRequest,
} from "./snapshot.ts";
