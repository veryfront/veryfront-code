# Single tool output envelope on replay

Problem: provider-to-agent conversion treats the typed tool output envelope as raw tool data. A later provider conversion wraps it again.

Fix: consume exactly one owned provider output envelope at that adapter. Keep raw payloads and opaque values unchanged; use the existing child-fork error representation. No prompts, models, recursive parsing or provider-specific rules.

Tests first: synthetic native object, JSON string, plain string, nested user type/value object and error output; provider→agent→runtime→Anthropic/Google round trip has one envelope and identical payload. Existing adapter/runtime/history tests stay green. Preserve the observed live failure and rerun a fresh connected continuation after a reviewed candidate rollout. A fixture pass does not prove model behavior.

Done: narrow tests/types/lint pass, independent exact-head review90+, CI and merge pass; live follow-up evidence is recorded separately with all run/tool/child errors.
