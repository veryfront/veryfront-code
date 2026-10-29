# Calendar list pagination

## Problem and result

Calendar list tools hide later pages. A caller must be able to see Google's continuation token and submit it to retrieve the next page without changing the query.

## Scope

- Add optional `pageToken` query parameters to list events and list calendars.
- Return the native provider page, including `items`, optional `nextPageToken` and existing provider metadata. Do not invent a total count.
- Preserve compact collection identities and page tokens in historical tool summaries.
- Keep page limits, write tools, free/busy, agent prompts and models unchanged.
- Document the correction from a transformed list to a page object and regenerate catalog metadata.

## Implementation and verification

1. Add failing tests using the actual catalog endpoints: two provider pages, empty final page, cursor forwarded unchanged, metadata retained and historical cursor retention.
2. Change only the Calendar connector metadata and regenerate its runtime/summary modules.
3. Verify both list tools through the standard local executor. Retain existing legacy-transform tests for unrelated connectors.
4. Run focused endpoint, catalog, schema and history tests plus formatting, lint and type checks. Review the exact head independently and merge only with CI passing.
5. In the connected demo, request a small first page, follow its actual token and confirm known later event IDs. Audit all run pages and preserve the original truncated result. Live verification and deployment remain separate from fixture success.

## Done

Both tools expose the native cursor, preserve it through result/history handling, and accept the next-page argument. Two-page fixtures pass. Required review and CI pass, and the change is merged to main. Record the remaining live deployment/proof step honestly if it is not yet available.

## Demo runbook

Prerequisites: current catalog installed in an authorized runtime and a normally connected demo Calendar account. Read calendars with page size one, follow the returned token, then read a bounded event window with page size one and follow its token. Pass when page two returns the next known ID and the result clearly distinguishes more pages from completion. No writes are needed. Keep the earlier truncated agenda as failure evidence.
