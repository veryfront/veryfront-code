/** Default bounded page size for workflow-run list operations. */
export const DEFAULT_WORKFLOW_RUN_LIST_LIMIT = 100;

/** Maximum workflow-run page size accepted by built-in backends and schemas. */
export const MAX_WORKFLOW_RUN_LIST_LIMIT = 1_000;

/** Maximum public offset, bounding ordered-index work performed per request. */
export const MAX_WORKFLOW_RUN_LIST_OFFSET = 10_000;

/** Maximum code-unit length for workflow and node identities. */
export const MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS = 1_024;

/** Maximum code-unit length for human-readable definition metadata. */
export const MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS = 65_536;

/** Maximum recursive static definition/configuration nesting. */
export const MAX_WORKFLOW_DEFINITION_DEPTH = 64;

/** Maximum number of statically captured nodes in one definition batch. */
export const MAX_WORKFLOW_DEFINITION_NODES = 10_000;

/** Maximum number of entries accepted in one declarative array/map/set. */
export const MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES = 10_000;

/** Maximum total values inspected while snapshotting one definition batch. */
export const MAX_WORKFLOW_DEFINITION_STATIC_VALUES = 100_000;

/** Maximum aggregate static binary/string payload admitted per definition batch. */
export const MAX_WORKFLOW_DEFINITION_STATIC_BYTES = 16 * 1024 * 1024;
