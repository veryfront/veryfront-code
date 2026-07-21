# Issue 90 research

## Finding

Hosted source agents select sandbox tools by public map key, for example `bash`, `sandbox_read_file`, and `sandbox_write_file`. The sandbox shell extension supplies external Zod schemas plus precomputed JSON Schema. `createToolsFromHostDefinitions` currently rejects those definitions because the external schemas do not carry Veryfront's contract brand, even though `dynamicTool` supports parser-backed schemas with precomputed JSON Schema.

This creates a split inventory: hosted setup reports the public sandbox aliases as available, but materialization drops them before the provider step. The runtime then suppresses the model's sandbox calls as unavailable.

## Evidence

- Framework eval `<RUN_ID>` loaded `extract-submission` and reported the sandbox aliases as available, then suppressed `sandbox_write_file` and `bash`.
- A direct materialization probe produced all sandbox host definitions but retained only background-command tools after `createToolsFromHostDefinitions`.
- `dynamicTool` already validates any schema with `parse()` and uses `inputSchemaJson` for provider registration.

## Chosen direction

Accept an external parser-backed schema only when the host also supplies precomputed JSON Schema. Keep rejecting arbitrary parser-like schemas without JSON Schema. This is the smallest boundary repair and preserves input validation.

## Verification

- Focused host-tool, sandbox-shell, and hosted-root suites pass: 8 tests, 16 steps.
- Live Veryfront eval `<RUN_ID>` completed with a 1.0 pass rate and exercised `sandbox_write_file`, `bash`, and `sandbox_read_file` before writing the validated extraction result.

## Alternatives

- Rebuild third-party schemas with Veryfront's schema DSL: duplicates each provider schema and increases drift.
- Make host schemas universally permissive: weakens validation.
- Remove sandbox parsing from the agent: avoids the defect instead of restoring the advertised framework capability.
