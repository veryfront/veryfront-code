/** Default bounded page size for workflow-run list operations. */
export const DEFAULT_WORKFLOW_RUN_LIST_LIMIT = 100;

/** Maximum workflow-run page size accepted by built-in backends and schemas. */
export const MAX_WORKFLOW_RUN_LIST_LIMIT = 1_000;

/** Maximum public offset, bounding ordered-index work performed per request. */
export const MAX_WORKFLOW_RUN_LIST_OFFSET = 10_000;
