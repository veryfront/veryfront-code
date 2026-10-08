# PR4977 review repair research

Pinned source9a1751f2. Five retained REST comments identify interacting defects: upgraded tool output excluded from ordered fallback; denied result encoder drops ownership; appended reasoning IDs restart at0; repeated fallback texts cross-match persisted blocks; detached reconciliation appends reasoning but its durable fallback builder emits none.

Reuse the existing chunk encoder, final-step parser and mirrored chunk recorder. Keep public reasoning metadata out of AGUI lifecycle frames. Durable reasoning-end chunks retain signature/redacted metadata. Never infer provider ownership from tool name and never override explicit ownership.

Chosen direction: emit changed tool parts in selected final order; preserve denied provider marker exactly as successful/error results do; record actual mirrored reasoning IDs in optional existing-state set and remap recovery IDs to unused IDs; consume multiple final text blocks monotonically, preserving latest-match single-block behavior; select newly appended detached reasoning by reference to prior mirrored parts and emit it through existing ordered chunk builder.

## Independent review follow-up: fragmented append-only replay

The twice-applied case with persisted `Sec` and provider blocks `First`, `Second`
reproduced a duplicate `Second` on replay. After the first pass, physical durable
order is `Sec`, `First`, `ond`. Matching contiguous slices cannot recognize
`Sec` + `ond` once `First` has been consumed by the earlier provider block.
Match ordered unconsumed indices instead, retaining the backwards-prefix guard
and exact completed-block reuse. The regression preserves the first-pass parts
and asserts exact equality after the second pass. Existing `Done`/`Do` monotonic
matching and reversed physical-order tests remain unchanged.

Focused verification passed 46 cases/200 steps; frozen checks passed for both
changed files. No public contract or generated API-reference change is needed.

## Symmetric occurrence-assignment follow-up

The symmetric `Fi`, `Second` case still duplicated `rst` after recovery because
an earlier fragmented block encountered a later completed block before that
later block was consumed. The repair now assigns complete occurrences first,
including ordered fragments separated by other occurrences, and reserves their
indices before partial matching. Partial matching cannot steal a reserved
complete occurrence. Complete matches are used directly rather than competing
with a shorter earlier prefix. Single-block latest-prefix behavior is unchanged.

A 36-combination permutation matrix covers missing, partial, and exact blocks
in both physical orders for `First`/`Second` and repeated-prefix
`Done`/`Done later`. Each case asserts exact twice-applied idempotence, and the
symmetric reported case also asserts the exact first-pass durable sequence.
Original monotonic recovery and append-only assertions remain unchanged.
