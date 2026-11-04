# PR 5379 review status incident

The merge commit's CI/CD run 39918211486 passed. Its Automated review status changed from success at 07:09:57 UTC to failure at 07:11:07 and 07:11:24 UTC, before merging at 07:30:26 UTC.

The latest clean receipt 6359548188 was created at 07:10:49 UTC. Summary 6358953525 was updated at 07:10:53 UTC and reported completed code review with has_any_findings=true and has_unresolved_findings=false. The parser treats either boolean being true as a new finding, so the later summary supersedes both clean receipts. Replaying the real evidence returns no accepted review, while each receipt alone passes.

Chosen direction: only unresolved or indeterminate findings block an independent clean receipt. Historical findings with explicitly false unresolved state do not block it. Keep the existing strict clean-summary requirements: resolved history alone must never grant approval. Keep unresolved findings, unknown states, account identity, exact commit, freshness and lifecycle checks intact.

The active ruleset 'Require automated review with admin PR exception' has an empty required_status_checks list. 'Require Main Checks' does not include Automated review. Consequently the merge queue did not enforce the failing status. No evidence establishes an admin bypass was used.

References:
- https://github.com/veryfront/veryfront-code/pull/5379
- https://github.com/veryfront/veryfront-code/actions/runs/39918211486
- https://github.com/veryfront/veryfront-code/pull/5379#issuecomment-6359548188
- https://github.com/veryfront/veryfront-code/pull/5379#issuecomment-6358953525
