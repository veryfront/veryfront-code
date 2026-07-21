# Issue 90 PRD

## Problem

Hosted sandbox aliases are advertised during agent setup but disappear before provider execution when their host definitions use external parser-backed schemas with precomputed JSON Schema.

## Solution

Allow `createToolsFromHostDefinitions` to materialize a host definition when it has:

- a description;
- an execute function;
- precomputed JSON Schema; and
- an input schema with a `parse` function.

Continue requiring a Veryfront contract schema when precomputed JSON Schema is absent.

## Implementation

1. Add a failing host-tool regression test using an external parser-backed schema and a generated provider ID.
2. Extend the runnable host-definition guard with the narrow precomputed-schema case.
3. Run focused host-tool, sandbox, and hosted-root tests.
4. Run formatting, type checking, and the broader relevant unit suite.
5. Rerun the live extraction framework eval against the patched runtime.

## Verification criteria

- The regression test fails before the implementation change and passes after it.
- The materialized tool is exposed under its public map key.
- Parser-like schemas without precomputed JSON Schema remain rejected.
- Existing sandbox and hosted-root tests pass.
- The live eval reaches `sandbox_write_file`, `bash`, and `sandbox_read_file`.

## Reference

- veryfront/veryfront-issue-inbox#90
