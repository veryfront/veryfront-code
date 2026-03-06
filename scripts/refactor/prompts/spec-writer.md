Analyze the module at src/{{MODULE}}/ and write an NLSpec behavioral specification.

This spec will guide refactoring — all behaviors documented here must be preserved
during code simplification. It must be precise enough for a separate Claude session
to understand what the module does without reading the source.

Read ALL files in the directory. Identify:
1. Public API — every export from the barrel file (index.ts/mod.ts)
2. Behaviors — what each export does, its inputs, outputs, side effects
3. Error handling — what errors can occur and how they're handled
4. Edge cases — boundary conditions, null handling, empty inputs
5. Dependencies — what other modules this one imports from
6. Invariants — things that must always be true
7. Constraints — refactoring rules (no API changes, no cross-module edits)

Write the spec to specs/{{MODULE}}/MODULE_SPEC.md using the NLSpec template at
scripts/refactor/prompts/SPEC_TEMPLATE.md.

Do NOT suggest improvements. Only document CURRENT behavior.
