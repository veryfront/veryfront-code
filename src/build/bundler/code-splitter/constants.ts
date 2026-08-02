/** On-disk schema version for code-splitter manifests. */
export const CHUNK_MANIFEST_VERSION = "1.0";

/** Maximum encoded size accepted for an on-disk chunk manifest. */
export const MAX_CHUNK_MANIFEST_BYTES = 5 * 1024 * 1024;

/** Maximum number of records or list items in one chunk manifest collection. */
export const MAX_CHUNK_MANIFEST_ENTRIES = 10_000;

/** Maximum source-module size accepted by the browser code-splitting transform. */
export const MAX_CODE_SPLITTER_MODULE_BYTES = 32 * 1024 * 1024;
