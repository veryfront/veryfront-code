# Post-deploy staging verification

- veryfront-code PR #1507 merged and published `veryfront@0.1.439`.
- veryfront-agent PR #1254 merged and staging deployed image `ghcr.io/veryfront/veryfront-agent:sha-e89bd858c0d486dc35dfbc851b9de2a14e9800a1-run-25594917886-attempt-1`.
- Kubernetes rollout evidence: `kubectl --context tomcode -n veryfront-staging rollout status deploy/veryfront-agent --timeout=120s` -> successfully rolled out.
- Browser: `agent-browser` opened the original staging conversation as `kentaro@codersociety.com` and clicked `Regenerate`.
- Result: the regenerated answer correctly identifies the upload as a `SAP Process Forensics` web-app/landing-page screenshot with the visible headline “From raw SAP data to root-cause clarity.” It no longer describes an unrelated animal.
- DB: new assistant message seq `3`, run `bbeaa44c-bf7d-49bd-880b-d66137421535`, model `veryfront-cloud/anthropic/claude-opus-4-6`, status `completed`, `terminal_error_code` empty.
