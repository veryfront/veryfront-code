# Veryfront Benchmark App

Veryfront's phase-1 benchmark app currently reuses the repo-root benchmark
harness instead of a separate checked-in fixture app.

Routes are provisioned dynamically by `tests/e2e/setup/server.ts` and exercised
through:

- `deno task bench:browser`
- `deno task bench:server`

This keeps the scenario contract local to the framework repo while the
comparison surface is still evolving.
