You are refactoring src/{{MODULE}}/ in the veryfront-code Deno TypeScript codebase.

Read the behavioral spec at specs/{{MODULE}}/MODULE_SPEC.md first. This is your
guide — all behaviors documented there must be preserved.

Refactoring dimensions (in priority order):
1. Dead code removal — unused imports, unreachable branches, unused variables
2. Naming clarity — rename unclear variables/functions to be self-documenting
3. Nesting reduction — early returns over nested if/else
4. Type safety — replace `any` with proper types, fix type-only imports
5. Module hygiene — barrel file only re-exports public API

Rules:
- PRESERVE all behavior documented in the NLSpec
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/{{MODULE}}/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Do NOT add comments, docstrings, or type annotations to unchanged code
- Keep changes minimal and focused

Validation (run both, both must pass):
- deno task verify:quick
- deno test --no-check --allow-all src/{{MODULE}}/

Commit your changes with message: "refactor: simplify src/{{MODULE}}/"
