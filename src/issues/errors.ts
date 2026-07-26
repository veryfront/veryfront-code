/**
 * Structured errors for file-based issue storage.
 *
 * @module issues/errors
 */

import { defineError } from "#veryfront/errors/types.ts";

/** An issue file exists but does not satisfy the persisted issue contract. */
export const ISSUE_FILE_INVALID = defineError({
  slug: "issue-file-invalid",
  category: "RUNTIME",
  status: 422,
  title: "Issue file is invalid",
  suggestion: "Repair the issue frontmatter and ensure it matches the issue schema",
});

/** Issue storage could not allocate a unique identifier or serialize a mutation. */
export const ISSUE_STORAGE_CONFLICT = defineError({
  slug: "issue-storage-conflict",
  category: "RUNTIME",
  status: 409,
  title: "Issue storage conflict",
  suggestion:
    "Retry after the concurrent mutation completes; if no mutation is active, remove only the matching stale issues/.locks entry",
});
