# Pinned Runs contract fixtures

`pin.json` records the released 0.8.9 base and maintained revisions. These are not published contract releases:

- `taskInputEvents` records the two event discriminants and four payload schemas from API #6512.
- `agentFinalization` records [API #6924](https://github.com/veryfront/veryfront-api/pull/6924), which lets text-only agent runtimes omit completed finalization output. Explicit null remains valid.

Both revisions record their exact source commit and OpenAPI hash. The newer released base remains intact.

`runs-api.generated.ts` is generated from the resulting OpenAPI document with the API's `renderRunsTargetArtifacts(document)` generator (openapi-typescript 7.13.0).

For a released contract update, copy both artifacts from the same kit and update the release and archive hash. For the maintained event revision, export the source document from the API commit and path in `taskInputEvents`, then run:

```sh
deno run --allow-read --allow-write scripts/generate-runs-task-input-contract.ts <API_OPENAPI_FILE>
```

The generator verifies the source hash before applying the event definitions. Regenerate the TypeScript artifact with the API's `renderRunsTargetArtifacts(document)`, passing this checkout's updated `openapi.target.json` as `document`; retain its `runs-api.types.ts` output as `runs-api.generated.ts`. This preserves request input-shape generation and the newer base contract instead of replacing it with the companion branch's older base.

For the finalization revision, copy only `FinalizeRunRequest`'s completed `output` description and optionality from the source recorded in `agentFinalization`. Regenerate the TypeScript artifact against this checkout's document with the same API generator. Do not replace the document with the API branch's older base.

Regenerate the SDK fixtures and verify the pin:

```sh
deno task contracts:runs:fixtures
deno task test:file scripts/generate-runs-fixtures.test.ts
deno task test:file tests/integration/integrations/runs-target-sdk/client.test.ts tests/integration/contracts/runs-target-types.test.ts tests/integration/contracts/runs-task-input-types.test.ts
```

The generator selects the first named request and success response example for
each operation, uses parameter examples for the input and URL, and applies
request schema defaults required by the generated types. It updates the generated-type, OpenAPI source
and fixture hashes in `pin.json`. The SDK, integration and CLI tests share the
generated fixture table through `client.test-helpers.ts`.

The contract integration test checks the pinned hashes and compares freshly
extracted fixtures with the table consumed by the SDK. Compatible example changes
therefore require regeneration and cannot leave the table stale.

The released base is contract 0.8.9. Heartbeat renews execution authority across
REST, GraphQL and MCP. Dispatch acceptance is an HTTP executor bootstrap option:
use the literal `"true"` value in `x-veryfront-run-dispatch-acceptance` with the
issued execution credential. It does not grant ordinary user or API-key access.
The CLI exposes this option as `project runs heartbeat --accept-dispatch`.
