# PR4977 review repairs PRD

## Problem and required behavior

Durable replay must preserve finalization's tool/text order, provider ownership, separate reasoning blocks and exact recovered text. Detached and response paths must retain existing streamed content without duplicating it. Signatures/redacted data stay in durable chunks; AGUI never exposes them.

## Implementation

1. RED upgraded-tool-before-later-text event order.
2. RED denied ownership encoder through version1 replay.
3. RED appended reasoning ID collision with actual mirrored IDs.
4. RED Done,Do + Done,Done later recovery (only ne later), retaining single-block latest-match regression.
5. RED detached additional signed/redacted reasoning beside streamed reasoning.
6. Minimal fixes in finalized-message/encoder/mirrored-state and detached call sites, then green narrow suites.

## Validation

Pinned Deno2.7.7 ordinary repository profile; backend relevant finalization/encoder/legacy-reader/mirrored-state suites; production frozen selected-file typechecks, fmt/diff and generated public documentation if changed. Preserve assertions, privacy and provider ownership. Freeze exact commit/tree for independent review before any normal push; parent owns publication/comment resolution. No target or runtime mutation.
