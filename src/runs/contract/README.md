# Pinned Runs contract fixtures

`openapi.target.json` is copied byte for byte from the release in `pin.json`.
`runs-api.generated.ts` is the kit's generated TypeScript contract.

When updating the contract pin, copy both artifacts from the same kit, update the
release and archive hash, then regenerate the SDK fixtures:

```sh
deno task contracts:runs:fixtures
deno task test:file scripts/generate-runs-fixtures.test.ts
deno task test:file src/runs/target/client.test.ts tests/integration/contracts/runs-target-types.test.ts
```

The generator selects the first named request and success response example for
each operation, uses parameter examples for the input and URL, and applies
request schema defaults required by the generated types. It updates the generated-type, OpenAPI source
and fixture hashes in `pin.json`. The SDK, integration and CLI tests share the
generated fixture table through `client.test-helpers.ts`.

The contract integration test checks the pinned hashes and compares freshly
extracted fixtures with the table consumed by the SDK. Compatible example changes
therefore require regeneration and cannot leave the table stale.
