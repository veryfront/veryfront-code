# Changelog

Behavior changes that need a decision from you before you upgrade. Released
versions are listed at
[github.com/veryfront/veryfront-code/releases](https://github.com/veryfront/veryfront-code/releases).

## Unreleased

### Changed: `veryfront up` pushes committed work again

`veryfront up` now pushes the local source to main whenever the checkout no
longer matches the last push to the same project and branch on the same
control plane, including commits made after that push. It previously refused
with "The latest push came from a different commit. Run veryfront push again."
and left the preview on the older upload until you ran `veryfront push`
yourself. A push receipt for another project, branch, or control plane is
still refused, and so is a receipt written by a CLI older than 0.1.1258, which
did not record the pushed paths. Run `veryfront push` once to replace such a
receipt.

`veryfront deploy` is unchanged. It still refuses a stale push receipt instead
of uploading committed work, so run `veryfront push` before promoting new
commits.

### Breaking: push, up, deploy, and pull respect Git ignore rules

`veryfront push`, `up`, `deploy`, and `pull` now skip untracked files that Git
ignores, whether the rule comes from a `.gitignore` at any level,
`.git/info/exclude`, or `core.excludesFile`. Previously only the built-in
defaults and `.vfignore` applied, so local-only files such as tooling scratch
directories were uploaded. Remote paths Git ignores are treated like paths
`.vfignore` ignores even when no local copy exists: pull does not write them and
`push --prune` does not delete them. Pull into a directory that does not exist
yet applies the enclosing repository's rules, and files inside a checked-out
submodule or another nested Git repository follow that repository's own rules.
Tracked files are never skipped by a Git ignore rule, and a directory outside
Git behaves as before.

A supported file that Git ignores and earlier versions uploaded, such as
generated source, is now skipped. To keep uploading it, re-include it in
`.vfignore` with a `!` rule, for example `!dist` or `!generated/data.json`; the
rule also reaches a file inside a directory Git ignores as a whole. The first
`veryfront up` or `deploy` after upgrading re-pushes a project whose uploaded
file set changes. Remote copies of newly ignored paths are preserved, not
pruned; delete them in Studio if they should go.

Git ignore rules are read when a command scans the project, so a rule changed
during a push or pull applies from the next run. Nested Git repositories other
than checked-out submodules and repositories created inside the project are a
known limitation: a nested repository inside a directory the enclosing
repository ignores stays ignored, and other layouts may not follow the nested
repository's rules. Use `.vfignore` for exact control there. See
[Git ignore limitations](./docs/guides/deploy-from-ci.md#git-ignore-limitations).

If the enclosing repository ignores the project directory itself, Git ignore
rules are not applied for that project and the CLI prints a warning; with
`--json` it emits a `warning` line with code `git-ignore-rules-not-applied`. The
defaults and `.vfignore` still apply.

`.context` is now ignored by default, and a `.vfignore` negation can re-include
it.

If Git fails while reading ignore rules inside a repository, push (and so `up`
and `deploy`) stops with an error instead of uploading files the checkout
ignores. Pull stops the same way. Fix the Git error, then run the command
again.
### Added: `veryfront eval` progress, `--concurrency`, and `--record-timeout`

`veryfront eval` now shows which eval and case is running, finished cases, and
elapsed time while cases run, and prints a notice when a model request is
retried. `--concurrency <count>` runs several cases of one eval at the same
time (default 1). `--record-timeout <seconds>` fails a case that runs too long,
including its metrics and checks, with the `eval-record-timeout` error (default
600, `0` disables it), so a stalled model stream can no longer hold the run
open. The failed case keeps its target output, trace, and usage.

`runEval()` from `veryfront/eval` accepts matching `concurrency`,
`recordTimeoutMs`, and `onProgress` options. Target adapters, metric
`evaluate()` contexts, check contexts, and LLM judge inputs receive a `signal`
that aborts at the record deadline, and the built-in LLM judges pass it to the
model request. With `LOG_LEVEL=DEBUG`, provider requests log their start,
status, duration, and retries.

### Changed: `runEval()` rejects when the model gateway refuses model access

`runEval()` from `veryfront/eval` now rejects with the
`eval-model-access-denied` error when a target or metric model request returns
HTTP 402 from the model gateway for an account-wide denial (insufficient AI
credits or the AI provider spend limit). Request-scoped limits, such as a
resource limit or an agent run credit limit, still fail only the affected
record. Built-in LLM judges stop the eval the same way, and so does the agent service
adapter when the service returns the gateway's 402 problem body. A credit code
carried only by an AG-UI run error still fails just that record, because the
stream does not show whether the Veryfront gateway or another provider raised
it.

An AI provider spend limit rejects with `eval-model-spend-limit-exceeded`
instead, because buying credits does not clear it.

It also rejects with `eval-project-required` when the gateway returns HTTP 400
with code `gateway_project_required` because the model request named no
project. It previously recorded the refusal on every
record, ran checks against the empty output, and resolved with a report.
`veryfront eval` stops at the first refusal and prints one error. If you call
`runEval()` directly, handle the rejection where you previously inspected
failed records for credit errors.

It also rejects with `eval-model-unauthorized` when the Veryfront Cloud gateway
returns HTTP 401 for the credential, and with `eval-model-project-access-denied`
when it returns HTTP 403 for the linked project. A 401 or 403 from a
third-party provider, or from an agent service used through
`createAgentServiceEvalAdapter`, still fails only the affected record.

It rejects with `eval-model-egress-blocked` when the host egress policy blocks a
model gateway request to the configured Veryfront API because its host resolves
to a private network address. The error points to the
`VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS` setting that allows a trusted
private API, without naming the private host. A block of any other request, such as a local provider or a tool or
custom metric endpoint, still fails only the affected record. A refusal thrown by an
eval `check` now stops the eval too.

### Deprecated: the `event` key on conversation-scoped run event rows

The Veryfront API now serves every run event row keyed `payload`, on the
conversation-scoped events route, GraphQL `agentRunEvents`, and the MCP
`get_agent_run_events` tool as well as the run-scoped route and the SSE
streams. `getConversationTypedRunEventRowSchema` from `veryfront/run-events`
previously required the pre-cutover `event` key and rejected every row those
surfaces serve now.

The schema reads `payload` as canonical and accepts `event` as a transitional
alias: at least one must be present, and a row with both parses as `payload`
without looking at the alias.
The parsed `ConversationTypedRunEventRow` exposes the payload as `payload` and,
until Phase F removes the alias, as the deprecated `event`. Move reads from
`row.event` to `row.payload` before Phase F.

`ConversationTypedRunEventRow` now describes the parsed row, so `payload` is
required on it. A row you build by hand keyed only by `event` no longer type
checks as `ConversationTypedRunEventRow`; annotate it with the new
`ConversationTypedRunEventRowInput` and parse it instead.

Stop sending `format=typed` to any run event surface. The API accepts and
ignores it, and refuses every other value, including `format=raw`.

### Breaking: eval exports omit the dataset content hash

`EvalReportExporterRegistry.export()` now strips `dataset.hash` from the report
copy every exporter receives, alongside `dataset.path`. The hash is an unsalted
digest over each example's id, input, reference, and metadata, so an exporter
denied inputs and references could still fingerprint a private dataset and
correlate it across projects and runs. Dataset kind and example count still
reach exporters, so grouping runs by dataset continues to work.

If a destination is trusted to correlate dataset content, set
`redaction: { includeDatasetHash: true }` on the export context to opt back in.

`EvalReportDatasetMetadata.hash` is now optional, because a redacted report can
lack it. Reports you create locally still always carry the hash: `runEval` and
`createEvalReport` return `LocalEvalReport`, whose `dataset.hash` stays
required. Code that types a report read back from an artifact or from storage as
`EvalReport` and reads `report.dataset.hash` no longer compiles. Either narrow
the read with `report.dataset?.hash` and handle the missing case, or type a
locally produced report as `LocalEvalReport`.

### Breaking: project API URLs no longer steer ambient credentials

Veryfront no longer sends a shell, `.env`, or stored CLI credential to the
`apiUrl` in a project's `veryfront.json` during login, `whoami`, or an
authentication preflight. Those credentials use the API URL selected by your
environment, or the default Veryfront API URL when you do not set one. A token
defined in the same `veryfront.json` still uses that file's `apiUrl`.

If you use a self-hosted control plane with an ambient credential, set
`VERYFRONT_API_URL` or `VERYFRONT_API_BASE_URL` in your trusted environment.

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
