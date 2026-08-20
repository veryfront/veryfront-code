# Local Integration Credentials Implementation Plan

> Execute this plan with strict RED -> GREEN TDD. Do not merge until full CI is green and every
> review thread is addressed and resolved.

**Goal:** Let local and single-project self-hosted Veryfront projects materialize an explicit
allowlist of catalog integration tools with project-owned credentials, including Salesforce
service accounts, without contacting Veryfront.

**Architecture:** Add a `RemoteToolSource` backed by the generated connector catalog. Keep the
public surface to a canonical tool allowlist plus an optional name-only credential provider.
Split admission/schema generation, credential resolution, and guarded endpoint execution into
small internal modules behind that source. Reuse existing remote-tool materialization and egress
guard boundaries.

**Tech stack:** TypeScript, Deno tests, Veryfront schemas/errors, `guardedEgressFetch`, generated
connector catalog.

**Design:**
`docs/superpowers/specs/2026-08-18-local-integration-credentials-design.md`

---

## Task 1: Lock source admission and model metadata

**Files:**

- Create: `src/integrations/local-tool-source.test.ts`
- Create: `src/integrations/local-tool-source.ts`
- Modify: `src/integrations/index.ts`
- Modify: `src/integrations/limits.ts`

### RED

Add focused tests for:

1. An exact allowlist of Vercel tools returns only those canonical definitions.
2. Definitions contain endpoint input fields and safe exposed defaults, but no credential names.
3. Malformed, duplicate, unknown, endpoint-less, GraphQL, enrichment, query-secret, and
   interactive-OAuth tool requests fail with typed safe errors.
4. Mutating the caller's `tools` array after construction cannot widen the source.
5. Hosted and proxy modes reject listing.
6. `executeTool()` rejects names that were not admitted even when they exist in the catalog.

Run:

```bash
deno test --no-check --allow-all src/integrations/local-tool-source.test.ts
```

Expected: fail because `createLocalIntegrationToolSource` does not exist.

### GREEN

Implement only catalog admission, option snapshotting, stable source ID, definition generation,
and an internal admitted-tool record. Use `parseIntegrationToolIdentity()` and the declared
generated connector catalog directly so explicit Salesforce tools do not depend on catalog
visibility flags. Keep `executeTool()` as the next task's typed unimplemented boundary.

Add deterministic ceilings for configured tool count and credential length to
`src/integrations/limits.ts`.

Export the function and public types from `src/integrations/index.ts`.

Run the focused test until green, then run:

```bash
deno check src/integrations/local-tool-source.ts src/integrations/index.ts
deno fmt --check src/integrations/local-tool-source.ts \
  src/integrations/local-tool-source.test.ts src/integrations/index.ts \
  src/integrations/limits.ts
deno lint src/integrations/local-tool-source.ts \
  src/integrations/local-tool-source.test.ts src/integrations/index.ts \
  src/integrations/limits.ts
```

Commit with Lore trailers describing the explicit grant boundary.

## Task 2: Resolve credentials without leaking them

**Files:**

- Create: `src/integrations/local-credential-auth.test.ts`
- Create: `src/integrations/local-credential-auth.ts`
- Modify: `src/integrations/local-tool-source.ts`
- Modify: `src/integrations/local-tool-source.test.ts`

### RED

Add table-driven tests for:

1. Vercel API-key header resolution.
2. Sendcloud HTTP Basic resolution.
3. PayPal client ID/secret discovery and token-request construction.
4. Salesforce's three service-account variable names.
5. Missing values report only sorted variable names.
6. A custom credential provider receives only expected canonical names.
7. Empty, overlong, accessor-backed, or non-string credential values fail closed.
8. Query-string credentials, URL-token templates, non-fixed client-credential token URLs, and
   ordinary authorization-code OAuth are rejected.
9. Sentinel secret values never appear in errors or serialized auth-plan metadata.

Run:

```bash
deno test --no-check --allow-all src/integrations/local-credential-auth.test.ts \
  src/integrations/local-tool-source.test.ts
```

Expected: fail because local credential resolution is absent.

### GREEN

Implement a closure-internal auth plan that separates safe credential names from short-lived
secret values. Default reads use the active project-scoped `getEnv()` accessor. Validate missing
credentials during `listTools()`, but resolve values again during execution. Do not cache raw
credentials or tokens.

Implement Salesforce My Domain normalization and a token plan distinct from the catalog's
interactive OAuth config. Do not attach provider errors as causes.

Run the focused tests and static checks until green. Commit with Lore trailers documenting why
credentials remain name-addressed and closure-internal.

## Task 3: Execute bounded REST endpoints through the egress guard

**Files:**

- Create: `src/integrations/local-endpoint-executor.test.ts`
- Create: `src/integrations/local-endpoint-executor.ts`
- Modify: `src/integrations/limits.ts`

### RED

Add transport-injected tests for:

1. Path encoding, query parameters, catalog-declared headers, and safe defaults.
2. JSON object and passthrough JSON bodies.
3. Unknown fields, missing required fields, and wrong primitive shapes fail before transport.
4. Dotted response transforms return the expected result.
5. Redirects use `redirect: "error"` and are never followed.
6. Initial and dynamic hosts pass an exact authorization callback and the existing egress guard.
7. Timeout and caller abort signals cancel the request.
8. Oversized, non-2xx, empty, and invalid JSON responses produce typed bounded errors.
9. Sentinel authorization headers, response bodies, query data, and provider URLs do not appear in
   errors, logs, or causes.

Run:

```bash
deno test --no-check --allow-all src/integrations/local-endpoint-executor.test.ts
```

Expected: fail because the local endpoint executor does not exist.

### GREEN

Implement the smallest REST executor described by the design. Its default transport must call
`guardedEgressFetch()`. Expose an internal injected transport only for tests; do not add an
unguarded public fetch override.

Use bounded response reading and typed Veryfront errors. Apply response transforms after the JSON
body is admitted. Never include raw provider content in diagnostic state.

Run the focused tests and static checks until green. Commit with Lore trailers documenting the
redirect and response-redaction constraints.

## Task 4: Wire authentication and Salesforce end to end

**Files:**

- Modify: `src/integrations/local-tool-source.ts`
- Modify: `src/integrations/local-tool-source.test.ts`
- Modify: `src/integrations/local-credential-auth.ts`
- Modify: `src/integrations/local-endpoint-executor.ts`

### RED

Add source-level integration tests for:

1. Vercel executes a GET with its bearer API key.
2. Sendcloud executes with HTTP Basic.
3. PayPal mints a client-credentials token, then calls the endpoint with the returned bearer token.
4. Salesforce mints a service-account token, validates `instance_url`, substitutes only the
   instance origin, and executes `salesforce__find_customer`.
5. Salesforce rejects generic login hosts, private hosts, paths, ports, userinfo, malformed token
   payloads, and non-Salesforce instance hosts before an endpoint call.
6. A tool omitted from the source allowlist cannot borrow another admitted connector credential.
7. Source-policy narrowing still rejects a locally materialized canonical integration tool.
8. The API-backed remote integration functions make the same requests as before when this source
   is unused.

Run:

```bash
deno test --no-check --allow-all \
  src/integrations/local-tool-source.test.ts \
  src/integrations/remote-tools.test.ts \
  src/agent/runtime/tool-helpers.test.ts
```

Expected: the new end-to-end cases fail before the source delegates to authentication and endpoint
execution.

### GREEN

Wire the admitted tool record to credential resolution, token minting, endpoint URL resolution,
and the guarded executor. Combine the execution abort signal with the local deadline. Keep every
secret in function-local state.

Run the focused tests and static checks until green. Commit with Lore trailers documenting the
Salesforce specialization and hosted-path compatibility.

## Task 5: Document the account-free usage contract

**Files:**

- Modify: `docs/guides/integrations.md`
- Modify: `docs/guides/integrations/salesforce.md`
- Modify: `docs/guides/self-hosting.md`
- Modify: relevant guide contract tests if present
- Regenerate: `docs/api-reference/veryfront/integrations.md`

### RED

Add or strengthen documentation contract tests to require:

1. The `createLocalIntegrationToolSource()` and `loadRemoteToolsFromSource()` account-free example.
2. The exact Salesforce service-account variables.
3. A statement that local source construction is the grant and `integrations.allow` only narrows.
4. Explicit unsupported authorization-code and query-secret behavior.
5. A statement that local credentials never go to Veryfront.

Run the focused docs test and confirm it fails before copy changes.

### GREEN

Update the integration, Salesforce, and self-hosting guides. Replace the stale claim that remote
integrations have no standalone credential path with the supported subset and limitations.
Regenerate API reference using the repository-pinned Deno version.

Run:

```bash
deno task docs:public:validate
deno task docs:api-reference:check
deno fmt --check docs/guides/integrations.md \
  docs/guides/integrations/salesforce.md docs/guides/self-hosting.md
```

Commit with Lore trailers documenting the compatibility limits.

## Task 6: Full verification and adversarial review

**Files:** all changed files

Run focused tests first, then repository gates:

```bash
deno test --no-check --allow-all \
  src/integrations/local-tool-source.test.ts \
  src/integrations/local-credential-auth.test.ts \
  src/integrations/local-endpoint-executor.test.ts \
  src/integrations/remote-tools.test.ts \
  src/tool/remote-source-tools.test.ts \
  src/agent/runtime/tool-helpers.test.ts
deno task check
deno task lint:ci
deno task test
deno task build:npm
git diff --check origin/main...HEAD
```

Inspect every output. Fix failures and rerun the exact failed gate plus the full affected matrix.

Run independent Spec and Standards reviews plus a security review focused on:

- credential exfiltration through errors, logs, URLs, metadata, context, and provider redirects;
- SSRF/DNS rebinding and Salesforce dynamic-host validation;
- capability widening through environment presence, aliases, source policy, or unsupported tools;
- hosted/proxy-mode bypass;
- primordial/accessor execution at the project-code trust boundary;
- Node, Bun, and Deno package behavior.

Address every actionable finding with another RED -> GREEN cycle.

## Task 7: PR, CI, comments, and merge

Push the branch and open a PR linked to inbox issue #495. The PR body must include:

- exact account-free public usage;
- supported and unsupported auth/endpoint modes;
- credential/redaction threat model;
- RED and GREEN evidence;
- focused and full verification commands;
- sample follow-up status.

Monitor all checks and review threads. For each actionable comment:

1. Reproduce it.
2. Add a failing regression test.
3. Implement the minimal fix.
4. Rerun focused and full affected gates.
5. Reply with evidence and resolve the thread.

Do not merge until:

- every required CI check is green on the exact head;
- CodeQL/security checks are green;
- every non-outdated review thread is addressed and resolved;
- independent Spec, Standards, and security reviews approve;
- the merge queue replacement checks are green.

After merge, verify main CI. Update issue #495 with the merge commit, exact supported contract,
remaining sample work, and release status. Keep the issue open until the Salesforce sample runs
account-free with the real local source or explicitly track that remaining acceptance separately.
