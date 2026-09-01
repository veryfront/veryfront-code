# Changelog

Behavior changes that need a decision from you before you upgrade. Released
versions are listed at
[github.com/veryfront/veryfront-code/releases](https://github.com/veryfront/veryfront-code/releases).

## Unreleased

### Breaking: Redis workflow `runTtl` no longer expires runs

`RedisBackendConfig.runTtl` is now a deprecated no-op. It previously started a
fixed expiry when a run was created. That expiry could remove an active or
approval-waiting run while leaving its checkpoints, approvals, and shared Redis
index memberships behind.

If you set `runTtl`, drain and stop old workers, deploy the new framework, then
call `RedisBackend.clearLegacyRunTtlExpirations()` before removing the option
from deployment configuration. The migration scans run keys incrementally and
removes existing TTLs from run hashes, observation streams, and approval
journals. It does not change lock or stalled-claim lease TTLs. You can run it
again safely; it returns the number of TTLs removed.

No Veryfront runtime or CLI entrypoint sets `runTtl` automatically. To remove a
run intentionally, call `RedisBackend.deleteRun(runId)` only after your
application has made the run ineligible for retry or resume. The option remains
in the public type so your existing configuration continues to compile while
you migrate.

### Breaking: workflow HTTP reads return summaries

The built-in workflow handler now returns `WorkflowRunSummary` from
`GET /runs`, `GET /runs/{runId}`, and the initial SSE `snapshot`. The
`useWorkflow` and `useWorkflowList` result and callback types use the same
summary contract.

These responses no longer contain run input, output, context, checkpoints,
source integration policy, node input and output, approval payloads and
decision metadata, or framework runtime metadata. List requests without an
explicit limit now read at most 100 runs.

`WorkflowClient` still returns the durable full run state for trusted
server-side code. If browser code reads a removed field, move that read to a
separately authorized server endpoint backed by `WorkflowClient`, and return
only the fields the application needs. Use `useApproval` or the dedicated
approval-by-ID route for approval payloads.

Operational error strings and approval request messages remain visible. Do not
place secrets, tokens, customer payloads, or private model output in those
developer-authored fields.

See [Workflows: loops, blob storage, React hooks](./docs/guides/workflows-advanced.md#understand-run-summaries)
for the exact summary shape and authorization guidance.

### Breaking: `veryfront dev` enforces CSRF

`security.csrf` now resolves the same way in every environment. Local
development runs the same double-submit check as a deployed build, so a
mutating request that does not send the CSRF cookie value back in the
`x-csrf-token` header receives `403` on your machine instead of passing
locally and failing on your first deploy.

HTTPS and loopback development use `__Host-vf_csrf`. Plain-HTTP LAN development
uses `vf_csrf`, because browsers discard `Secure` `__Host-` cookies there.

The `vf_csrf_names` cookie-name namespace is now reserved for origin-scoped
custom-name discovery. If your config already uses `vf_csrf_names` or a
`vf_csrf_names_*` name as `security.csrf.cookieName`, rename it before upgrading.

If you wrote a mutating `fetch` by hand, it starts failing locally. That is the
point of the change: the failure was already waiting for you in production.

Preview deployments change the same way. They resolved the default from the
environment too, so a preview URL used to accept a mutation that its production
URL rejected. All three now agree.

To fix a request, build its headers with `csrfMutationHeaders` from
`veryfront/index.client`:

```ts
import { csrfMutationHeaders } from "veryfront/index.client";

await fetch("/api/cases", {
  method: "POST",
  headers: csrfMutationHeaders("/api/cases", {
    headers: { "content-type": "application/json" },
  }),
  body: JSON.stringify({ title: "Example case" }),
});
```

Veryfront's own client hooks all send the header now. `useAgent`,
`useStreaming` and `useCompletion` did not before this release and were the
half of the hook family left behind when `csrfMutationHeaders` shipped; they
would have started answering `403` on your machine. Upgrade to pick that up.
The `agentic-workflow` template's approval button gained the same header.

A client that is not a browser satisfies the check by sending any matching
cookie/header pair alongside its real authentication, because the gate only
compares the two submitted values:

```bash
curl -X POST http://localhost:3000/api/cases \
  -H "Content-Type: application/json" \
  -H "Cookie: __Host-vf_csrf=local-check" \
  -H "x-csrf-token: local-check" \
  -d '{"title":"Example case"}'
```

That was already true of a deployed build and is unchanged here; local
development now matches it. Keep the route protected and send the pair, so
browser calls to the same endpoint stay covered.

To exempt individual routes, list them in `security.csrf.excludePaths`. To turn
the check off everywhere, set `security.csrf` to `false`. Both options work in
every environment.

`security.csrf` is also enforced when a request arrives before the project's
security configuration has finished loading. That window used to pass the
request through unchecked; it now rejects it, and the request succeeds on
retry once the configuration is in place.

The development warning this replaces is gone. A rejection answers with a body
naming the cookie and header your project has in effect only when the request
came from a loopback peer on your own machine, so a deployed runtime that
resolves a project directory on disk still serves the unchanged opaque body.

See [Security headers and CSP](./docs/guides/security-headers.md) for the full
contract.
