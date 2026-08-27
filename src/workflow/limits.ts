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

/**
 * Maximum checkpoint history retained and accepted in one read. Built-in
 * backends evict the oldest entries by append order once this bound is reached.
 */
export const MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES = 1_000;

/**
 * Maximum per-run approval records retained. The per-run approval list is
 * append-only: decisions rewrite records in place, so decided approvals stay
 * in the list and dominate its growth. Once this bound is reached, built-in
 * backends evict the oldest decided records and reject the append when there
 * are not enough to make room. Expired records remain pending until the
 * expiration reconciler decides them, so a decidable approval a run is waiting
 * on is never silently dropped.
 */
export const MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES = 1_000;

/**
 * Maximum per-run event-wait records retained. The list is append-only for the
 * same reason the approval list is: delivering or expiring a wait rewrites its
 * record in place, so resolved waits stay in the list and dominate its growth.
 * At the bound, built-in backends evict the oldest resolved records and reject
 * the append when there are not enough to make room, so a wait a run is still
 * parked on is never silently dropped.
 */
export const MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES = 1_000;

/**
 * Maximum events buffered in one run's durable mailbox. The mailbox exists so
 * an event published before its wait parks is not lost, which means entries can
 * accumulate for a run that never consumes them. Every entry is unconsumed by
 * definition, since taking an event removes it, so none is safe to evict: at
 * the bound the publish is refused rather than dropping an event a wait has not
 * parked for yet.
 */
export const MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES = 1_000;

/**
 * Maximum run mailboxes an in-memory backend keeps at once. Publishing accepts
 * a run id that has no run yet, so a caller can reserve an id, publish, and
 * then start the run. That also means a caller publishing to ids that never
 * become runs would accumulate mailboxes forever, so past this bound the
 * backend drops the oldest mailboxes that belong to no run. A mailbox whose run
 * exists is never dropped: its events may still be claimed by a parked wait.
 */
export const MAX_WORKFLOW_RUN_EVENT_MAILBOXES = 10_000;
