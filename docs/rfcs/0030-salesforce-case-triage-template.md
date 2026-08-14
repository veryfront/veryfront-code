# RFC 0030 - Salesforce Case Triage: a fork-and-run integration template

| Field      | Value                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Status     | Draft - request for comment                                                                             |
| Author     | Matt Boon                                                                                               |
| Created    | 2026-08-12                                                                                              |
| Branch     | `mattboon/phoenix`                                                                                      |
| Affects    | `templates/integrations/salesforce/connector.json`, `src/integrations/schema.ts`, the hosted tools API, the reference Studio project, and the companion example repository |
| Related    | RFC 0001 (adapters); PR #3638 (merged) - expands curated `create_case`/`update_case` fields incl. `Type`; studio PR #6364 - Salesforce Configure permission matrix |

## 1. Summary

This RFC proposes open-sourcing **Salesforce Case Triage** as the flagship "fork it and it
just works" template: a four-agent pipeline (Ingest → Classify → Dispose) that
reads a Salesforce support case, PII-redacts it, classifies it against a
checked-in taxonomy, then writes a `Reason` and a triage comment back to the
case. The promise in the blog post is a straight line:

> fork the template (or clone the companion example repository **once it is
> published**, Open Question E) → sign in to Veryfront → connect
> **your own** Salesforce org over OAuth → run "Triage latest open cases" → it
> runs green.

**The pipeline works today.** Against the reference org it ingests, redacts,
classifies, and disposes a case end-to-end - `case-dispose` writes `Reason` and
posts the triage comment successfully. This RFC is **not** a bug report; it is a
hardening + generalisation plan so the *same green run* survives (a) a different
person's org and (b) examples beyond triage.

The seams that would break "just works" for *those* cases are not in Veryfront's code -
they are in the **shape of the connecting org**. The canonical illustration is the
`Type` incident (§3), which surfaced while exercising `update_case` *outside* the
triage happy path (dispose only ever writes `Reason`): the agent tried to set a
field that wasn't in the tool's static parameter schema, so the value never left
the client - and the model then *mis*-diagnosed the update's empty response
(a normal `204 No Content` for a PATCH) as evidence of a dropped field. That
single field was patched by hand, but the class of problem it represents -
**per-field static enumeration versus a live, customer-specific Salesforce
schema** - is the thing this RFC is really about.

This RFC (a) catalogues every reason a *standard* org would not "just work",
(b) resolves the "should the 16 tools be dynamic?" question against how the
platform actually loads tools, and (c) proposes a concrete design: a
**comprehensive-but-safe static tool surface + passthrough writes +
describe-driven preflight + a documented reference-org baseline + graceful,
teaching error messages**.

## 2. What the proposal ships

Two artefacts that must stay 1:1:

- **Studio project** `<PROJECT_ID>` ("Salesforce Case Triage"). Four agents,
  least-privilege by design:
  - `case-triage` - orchestrator, tool: `invoke_agent`.
  - `case-ingest` - read-only. Tools: `salesforce__get_case`,
    `salesforce__list_case_activity`, `salesforce__list_cases`. Fetches + PII-redacts.
  - `case-classify` - **no Salesforce access**. Tools: `search_knowledge`,
    `get_file`. Classifies against the checked-in `knowledge/case-triage-taxonomy.md`.
  - `case-dispose` - write. Tools: `salesforce__add_case_comment`,
    `salesforce__update_case`. Sets **only** `Case.Reason` and posts a comment -
    but that scoping is **prompt-driven today**: the granted `update_case` can write
    every writable Case field, so the boundary is instructed, not enforced. §5.2/§6
    replace the grant with a field-scoped `update_case_reason` tool that makes it
    structural.
- **Companion example repository** (currently private). Mirrors the four agents
  as `agents/*.ts`, ships the taxonomy in `knowledge/`, ships
  **evals** (`evals/*.eval.ts` + `evals/mock-tools.ts`), and runs locally via
  `npx veryfront push` + `npm run dev` on `http://veryfront.me:3000`, with
  `invoke_agent` child runs executing on the hosted control plane.

The integration itself is `templates/integrations/salesforce/connector.json`: 16
static tools over OAuth2, served verbatim by `GET /integrations/salesforce`.

### 2.1 How a `connector.json` tool actually becomes a runnable tool

This matters for every recommendation below, so state it precisely (verified in
`phoenix`):

- Tools are a **required, statically-declared array**: `tools: v.array(...)` on
  the connector (`src/integrations/schema.ts:468`), each entry validated by
  `getIntegrationToolSchema` (`schema.ts:407-416`). There is **no runtime
  self-registration** and no describe→tool generation.
- At build, `scripts/build/generate-integrations-module.ts` validates each
  `connector.json` (`:86`), namespaces ids to `integration__tool_id` (`:98`), and
  compiles `src/integrations/_data.ts`.
- **Execution is server-side.** Interpolation of `{{oauth.raw.instance_url}}`,
  path params like `{caseId}`, `response.transform` extraction, and
  `requiresWrite` gating all happen in the hosted API - there is no local code in
  `src/` that reads `transform`, interpolates `{{…}}`, or enforces `requiresWrite`
  (confirmed by grep). The SDK only *declares* these in the schema.
- Tool **discovery is dynamic per project**: `src/integrations/remote-tools.ts`
  fetches the authorised tool list per request (`POST /integrations/tools/list`,
  `remote-tools.ts:560-600`) and maps each to `{ name, description, parameters }`
  where `parameters` is a JSON Schema the **server** built from each param's
  `type`/`in`/`required`/`default` (`remote-tools.ts:782-788`).

**Takeaway:** the *set* of tools a project sees is already dynamic, but each tool
is a static `connector.json` entry. "Make the tools dynamic" is therefore not a
available knob - the available lever is **what those static entries declare**, plus
the escape-hatch tools (`describe_object`, `run_soql_query`) and the agent prompts.

### 2.2 At a glance

The working triage pipeline (`invoke_agent` fans out to three least-privilege
children):

```
                       ┌──────────────────────────┐
     "Triage latest    │        case-triage        │
      open cases"  ───▶ │      (orchestrator)      │  tool: invoke_agent
                       └────────────┬─────────────┘
                                    │ invoke_agent → hosted child runs
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
   ┌──────────────┐  redacted ┌──────────────┐  verdict ┌──────────────┐
   │  case-ingest │  payload  │ case-classify│  JSON    │ case-dispose │
   │  READ-only   │──────────▶│ NO SF access │─────────▶│   WRITE      │
   └──────┬───────┘           └──────┬───────┘          └──────┬───────┘
   get_case                   search_knowledge          update_case (Reason)
   list_case_activity         get_file (taxonomy)       add_case_comment
   list_cases                        │                         │
          │                          ▼                         │
          ▼                  project taxonomy .md              ▼
      Salesforce            (NOT Salesforce Knowledge)     Salesforce
```

Static tools, dynamic policy - capability and authorization are separate layers:

```
  CAPABILITY  (static connector.json)        AUTHORIZATION (dynamic, studio #6364)
  what a tool CAN do                          what a project MAY do, per object
  ┌──────────────────────────┐               ┌────────────────────────────────────┐
  │ curated: get_case,        │               │  Object      R   C   U   D          │
  │          update_case, …   │   governed    │  Account     ✔   ✔   ✔   ✗          │
  │ generic: get_record,      │ ────by──────▶ │  Case        ✔   ✔   ✔   ✗          │
  │          create_record,   │               │  Ticket__c   ✔   ✗   ✗   ✗  (custom)│
  │          update_record,   │               │                                    │
  │          delete_record,   │               │  discovered via describe()         │
  │          upsert_record    │               │  deny-by-default · searchable      │
  │ escape:  run_soql_query,  │               └────────────────────────────────────┘
  │          describe_object  │                 generic tools ship ONLY once per-CRUD
  └──────────────────────────┘                 enforcement is live (today: object-level
                                                only) - until then delete_record is held
```

One tool call, end to end (interpolation/transform/gating all server-side, §2.1):

```
 connector.json        remote-tools.ts         hosted API (api.veryfront)      Salesforce org
 (static entry)        (per-req discovery)     (execute)                       (REST)
 ┌────────────┐  build ┌───────────────┐ list  ┌──────────────────────┐       ┌────────────┐
 │ update_case│───────▶│ /tools/list   │──────▶│ interpolate {{url}}  │       │ PATCH      │
 │ create_    │        │ /tools/call   │ call  │ {caseId} path param  │──────▶│ /sobjects/ │
 │  record    │        │ (JSON schema  │◀──────│ transform: records   │◀──────│  Case/{id} │
 │ passthrough│        │  from server) │       │ dataAccess grants +  │       │ /query     │
 └────────────┘        └───────────────┘       │ requiresWrite gate   │       └────────────┘
                                               └──────────────────────┘
```

Fork → run (the blog's happy path; per-user OAuth requires the packaged
Veryfront External Client App to be installed in the target org first, while
the org-config gates in §4 are handled by the baseline + describe):

```
  fork template          sign in       install packaged app      connect Salesforce
  ─ or clone ──────────▶ Veryfront ──▶ in the target org ──────▶ (per-user OAuth)
  agentic-case-          set API token          │                         │
  processing             npx veryfront push     ▼                         ▼
                                         verify app enabled      run "Triage latest cases"
                                                                 writes Reason + comment
```

## 3. The `Type` incident (a worked illustration, not a triage failure)

Triage itself completes without this field. The incident surfaced while probing
`update_case` beyond the pipeline. The model incorrectly treated the empty
response as evidence that the tool had dropped `Type` because the field was not
present in its parameter schema.

Root cause: `update_case`'s `body` statically enumerated
`Status`/`Priority`/`OwnerId`/`Reason`/`SuppliedEmail`/`Description`. `Type` was
absent, so the LLM could not pass it - the value was dropped **client-side, before
the request**. Note the model's inference was itself wrong: a Salesforce
`PATCH /sobjects/Case/{id}` returns `204 No Content` on success, so the empty
result was *not* a signal that `Type` was dropped. PR #3638 (merged) added `Type`
(and more) to the body. That fixes *one* field.

The lesson is the general one:

1. **Static per-field enumeration always lags the org.** Custom `__c` fields,
   record types, and standard fields the implementation didn't list are all unreachable until
   someone edits `connector.json`.
2. **Even a listed field can fail on its value.** `Type`, `Status`, `Priority`,
   `Origin`, and `Reason` are **picklists with org-defined values**. Per the
   Object Reference these Case fields are *not* API-`Restricted picklist` by
   default (the only restricted Case picklists are `Language`/`ArticleLanguage`),
   so a vanilla org may *accept* an off-list value - but the moment an admin turns
   on "Restrict picklist to the values defined in the value set" (common), or a
   record-type/dependency scopes the values, sending `Type = "Question"` returns
   `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` ("bad value for restricted picklist
   field"), case-sensitive. Either way an off-list value is bad triage data - the
   value must come from the org, via `describe`/`get_picklist_values`.
3. **Write success must be judged by HTTP status, not response body.** POST
   (create) returns `{ id, success, errors }`; PATCH (update) and DELETE return
   `204 No Content` - an empty body **is** success. The tool/adapter must map
   status → an explicit result (`{ success: true, id? }`) and surface Salesforce's
   non-2xx error JSON; it must never let the agent infer failure from emptiness
   (as happened above). `id` is optional for update/delete.

**Landed fix (PR #3638, merged).** The curated `create_case`/`update_case` bodies
were expanded to the standard writable Case fields - `create_case` gains `Reason`,
`Type`, `SuppliedEmail`; `update_case` gains `Subject`, `Status`, `Priority`,
`Reason`, `Type`, `Origin`, `SuppliedEmail`, `ContactId`, `AccountId`, `OwnerId`,
`Description`. This closes the curated Case **field-coverage** gap (it does not
change write-result handling - see point 3) and is the **right** move for the
curated demo surface. It is also the clearest possible statement of the problem
this RFC generalises: it is per-field enumeration, **by hand, for one object**, and
it can never reach custom `__c` fields or other objects. The generic passthrough
tier (§5, Appendix B) does the same thing **once, for every object** - so the next
field or object doesn't need another PR. #3638 and this RFC are complementary:
keep the curated Case tools sharp; add the generic tier for breadth.

## 4. What "just works" has to survive on a standard org

This is the deep-research core. Ranked by how likely each is to break a *fresh*
fork.

### 4.1 Case.Reason picklist ↔ taxonomy mismatch - the #1 breaker for *this* pipeline

`case-dispose` is instructed to set `Case.Reason` to the taxonomy's
`reason_api_name` (`agents/case-dispose.ts`). `Reason` is a picklist whose values
are org-defined (createable + updateable, and commonly *restricted* by the admin
setting above). The shipped `knowledge/case-triage-taxonomy.md` (v5) maps
categories to specific `reason_api_name` values. **If the forker's org's `Reason`
picklist doesn't contain those values, dispose writes either fail (restricted org)
or silently create mismatched data (unrestricted org) - both break the demo.**
Salesforce's *default* Case Reason values (Installation, Equipment Complexity,
Performance, Breakdown, Equipment Design, Feedback, Other) are themselves an
oddity most orgs have already customised.

This is the sharpest edge, and the design must address it (§5, §6, §7).

### 4.2 Edition & API access - the hard gate

REST API is **not available in every edition**:

- **Free / Starter Suite** - no API access at all.
- **Pro Suite** - API allowed, but call caps well below Enterprise.
- **Professional Edition** - API not enabled by default; requires an add-on or a
  partner security-review grant.
- **Enterprise / Unlimited / Performance / Developer** - full REST API.

A "common Salesforce plan" can therefore be *physically unable* to run the
integration (calls return `API_DISABLED_FOR_ORG` / 403). The only fully
controllable golden path is a **free Developer Edition org**, which has full API.
The blog and README must name it explicitly.

### 4.3 Salesforce Knowledge - a trap the pipeline already avoids (keep it that way)

Note: `case-classify` uses **project** `search_knowledge` + `get_file` against the
checked-in taxonomy, **not** `salesforce__search_knowledge_articles`. That is a
good decision - it sidesteps the fact that Lightning Knowledge is **off by
default**, needs enabling (irreversibly), needs a Knowledge User permission and at
least one published article, and that `SELECT … FROM KnowledgeArticleVersion` on a
fresh org errors with `sObject type 'KnowledgeArticleVersion' is not supported`.
The `salesforce__search_knowledge_articles` **tool still ships in the connector**
and will break out-of-box if any agent calls it. Keep the pipeline off it, and
have the tool degrade gracefully (§8).

### 4.4 Validation rules & required custom fields

`create_case` / `create_lead` fail on orgs with required custom fields or
validation rules (`FIELD_CUSTOM_VALIDATION_EXCEPTION`, `REQUIRED_FIELD_MISSING`).
A vanilla Developer org is clean; any real customer org may not be. This mostly
affects the "create a case" prompt, less the triage path.

### 4.5 Field-Level Security & profile ceiling

The OAuth user's profile is the ceiling. A read of a field the profile can't see
returns `No such column '<field>'` (or the field silently vanishes); a write to a
field with only *Visible* (not *Edit*) FLS fails - exactly what the model
speculated about in §3. The connected user needs **Edit** FLS on `Case.Reason` and
read on every queried field.

### 4.6 Packaged External Client App / OAuth setup

Per-user OAuth uses the **Veryfront Salesforce Integration** package documented
in `docs/guides/integrations/salesforce.md`. A Salesforce administrator must
install that package in every target org because External Client Apps are
org-scoped, then confirm that the packaged Veryfront app is enabled before a
user connects. The fork-to-run flow must present package installation as a
prerequisite, not ask the forker to create or supply a client ID and secret.

Service-account automation is a separate path. It uses a customer-managed
Connected App with client credentials, a dedicated Run As integration user,
and the environment variables documented in the Salesforce setup guide. Do not
present that service-account setup as the per-user connection path. See **Open
Question A** for the package's production distribution and upgrade contract.

### 4.7 Housekeeping: API version drift

`connector.json` pins `v61.0`; the legacy generated-project client
`files/lib/salesforce-client.ts:3` pins `v59.0`. Reconcile to one version.

### 4.8 The PII-redaction boundary must be specified before open-sourcing

`case-ingest` redacts PII before handing off to `case-classify`, but the current
policy is prompt-driven and denies nothing structurally. Before this is a public
template, define it explicitly, and **fail closed**:

- **Which fields** are passed downstream - an *allowlist* of non-PII operational
  fields (Id, CaseNumber, Status, Priority, Reason, Origin, CreatedDate…), not a
  denylist of PII patterns. Custom `__c` fields and any newly-appearing activity
  fields must default to *excluded*, not forwarded raw.
- **Failure mode** - if redaction is uncertain or errors, stop rather than forward
  raw case data.
- **Blast radius** - the same policy must cover child-run payloads, tool-error
  messages, and telemetry/logs, or raw PII leaks around the redaction step.

## 5. Static vs dynamic tools - the design decision

Given §2.1, tools **must** be static `connector.json` entries. The design gets
dynamic-*enough* behaviour from three levers that need no new platform machinery:

1. **Read is already dynamic.** `find_customer`, `list_cases`, `search_contacts`,
   etc. take an arbitrary SOQL `q`; `run_soql_query` is a universal read.
   Read coverage of standard *and* custom objects is effectively total already.
2. **Passthrough writes - on the *generic* tools, not the least-privilege curated
   ones.** The schema already supports `bodyMode: "passthrough"` - and
   `src/integrations/schema.ts` cites *"Salesforce sObject … writes"* as its
   motivating case. A passthrough `create_record` / `update_record` accepts an
   **arbitrary field map**, so `Type`, custom `__c` fields, and record types flow
   through without being enumerated one-by-one. This is the real fix for §3.
   **Caveat (security):** do *not* make the curated `update_case` passthrough -
   `case-dispose` is scoped to write only `Reason`, and a passthrough `update_case`
   would let it (and the connected user) write *every* writable Case field. A tool
   is authorization, a prompt is not. Give `case-dispose` a dedicated, field-scoped
   `update_case_reason(caseId, Reason)` tool whose input schema admits **no other
   field**, and reserve passthrough for the generic tier under the §16 matrix. An
   input-schema authorization test (§6) proves the scoping - a prompt cannot.
   Trade-off: passthrough's
   looser JSON Schema gives the LLM less guidance - mitigate with a strong tool
   `description` and a describe preflight.
3. **Describe-driven preflight.** Before a write, the agent learns *this org's*
   real picklist values / required fields via `describe_object`. For a
   classification field such as `Reason`, the agent writes only through a
   user-confirmed taxonomy-to-org mapping. If no mapping exists, report the
   allowed values and fail closed. It can be a prompt rule in `case-dispose`, or a
   curated `get_picklist_values` convenience tool (a filtered describe).

**Recommendation: hybrid.** Keep a comprehensive, ergonomic **static core** of
curated tools (they make the demo legible and the agent fast, and stay
field-scoped for least-privilege agents), add a **passthrough generic tier** for
breadth, and lean on `describe_object` + `run_soql_query` as the completeness
escape hatch. Do **not** pursue runtime-registered/dynamic tools - out of platform
scope and unnecessary. **Precondition (§16):** the generic tier ships only once the
per-operation authorization matrix is *enforced* server-side (fail-closed) against
the runtime `sobjectType` - not before. Until then the generic write/delete tools
stay out of the shipped surface.

## 6. Proposed comprehensive tool surface

Reorganise the 16 into three tiers. The generic tier alone gives complete
standard+custom coverage; the curated tier exists for ergonomics and blog
readability.

**Tier 1 - Curated triage happy path (keep, ergonomic wrappers):**
`find_customer`, `list_cases`, `get_case`, `list_case_activity`,
`add_case_comment`, `update_case` (**field-scoped**; incl. `Type` per #3638 -
**not** passthrough, §5.2), `update_case_reason` (writes `Case.Reason` only - the
sole write tool granted to `case-dispose`), plus `search_accounts`, `get_account`,
`search_contacts`, `get_contact`, `list_opportunities`, `create_case`,
`create_lead`.

**Caveat - `create_case` static picklist defaults.** The curated `create_case`
still hard-defaults `Status = "New"` and `Origin = "Web"` (`connector.json`,
unchanged by #3638). On an org that restricts those picklists - or scopes them by
record type - a blind `New`/`Web` write fails, contradicting the describe-first
rule (§5.3, §A.1 rule 2). Drop both defaults so Salesforce applies the org default
when the field is omitted (or make `get_picklist_values` preflight mandatory before
create), and add a restricted-picklist fixture proving create succeeds without
assumed values.

**Tier 2 - Universal escape hatches (keep):** `describe_object`,
`run_soql_query`, and `salesforce__search_knowledge_articles` (requires Knowledge
enabled and degrades gracefully, §8). Add **`get_picklist_values`** (describe
filtered to picklist fields) so `case-dispose` can validate `Reason` before
writing.

**Tier 3 - Generic sObject CRUD (add, gated on §16 enforcement):**
`get_record`, `create_record`, `update_record`, `upsert_record` (Appendix B has
the full spec), which cover **any** standard or custom object. `delete_record` is
specified but **deferred out of v1** until per-CRUD Delete enforcement is live.

**Tool tally (single source of truth; Appendix B is canonical):**

| | Tools | Count |
| --- | --- | --- |
| **Existing** (curated + escape) | the 16 in `connector.json` today | 16 |
| **Add - helpers** | `update_case_reason` (`Reason`-only `case-dispose` write), `get_picklist_values`, `search` (SOSL) | +3 |
| **Add - generic CRUD (v1)** | `get_record`, `create_record`, `update_record`, `upsert_record` | +4 |
| **Add - generic CRUD (deferred)** | `delete_record` (pending Delete enforcement) | +1 |
| **v1 total** | | **23** |
| **Optional curated wrappers** | `create_contact`, `update_account`, `create/update_opportunity`, `create_task`, `convert_lead` - sugar, not counted in core | - |

**Authorization tests (acceptance gate).** Every least-privilege grant needs an
input-schema test, because the schema *is* the authorization boundary:
`update_case_reason`'s schema must reject any body key other than `caseId`/`Reason`
(so `case-dispose` cannot write `Status`/`OwnerId`/etc. even when prompted to), and
each generic CRUD tool must be denied for an un-granted `sobjectType` (§16).

Coverage of the standard objects a "get-going" support/CRM demo needs:
Account, Contact, Lead, Case, CaseComment, Opportunity - plus User for every
owner lookup and Group only for queue-supported objects such as Case and Lead,
reachable via SOQL. Opportunity ownership accepts User IDs, not queue Group IDs.
Task/Event (activities) remain reachable via the generic tier.
`salesforce__search_knowledge_articles` stays but is documented as "requires
Knowledge enabled" and degrades gracefully (§8).

## 7. Reference org & seed data - "just works" needs *data*

A fresh org has no cases to triage, and its `Reason` picklist won't match the
taxonomy. Ship a **reproducible baseline** so fork→run has something to act on:

These are **two different environments** and must not be conflated - an SFDX
scratch-org definition cannot seed an existing connected org, and automatically
editing `Case.Reason` in a customer org mutates admin-owned picklists and
record-type behaviour.

- **Disposable orgs (Developer Edition / scratch org) - the golden path.** The template
  *may* fully automate: an SFDX scratch-org definition or unmanaged package that
  creates a few Accounts / Contacts / Cases with known subjects **and** installs a
  Case `Reason` picklist aligned to `case-triage-taxonomy.md` v5. Taxonomy and
  picklist are authored together, never independently.
- **Existing / customer orgs - no automatic schema changes.** The fork must *not*
  silently alter picklists. Require an explicit admin-run deploy, or (preferred)
  the "adapt to my org" step (§15) that maps the taxonomy to the org's *existing*
  `Reason` values. Fail closed with a clear message if no mapping exists.
- Until a seed artefact ships, the **"runs green"** claim is conditional - say so
  in the blog. The evals (`evals/mock-tools.ts`) already let CI pass without a real
  org; the seed closes the gap between "evals green" and "real org green."

## 8. Graceful degradation - make errors teach, not stall

Every known failure should return an actionable message instead of a raw
4xx/empty string. Some of this is the hosted API's job (it owns execution); some
is promptable in the agents.

| Condition | Today | Proposed |
| --- | --- | --- |
| Write result | empty string (mis-read as failure in §3) | status-based: POST → `{ id, success, errors }`; PATCH/DELETE `204` → `{ success: true }`. Empty body ≠ failure |
| API disabled for edition | raw 403 | "This Salesforce edition has no API access. Use a free Developer Edition org: <link>." |
| Restricted picklist bad value | raw `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` | catch → describe → retry only after the user confirms a taxonomy-to-org mapping; otherwise report the allowed set and fail closed |
| Knowledge not enabled | raw `INVALID_TYPE` | `search_knowledge_articles` returns `[]` + a one-line hint |
| FLS Edit missing on Reason | silent drop / raw error | name the exact profile toggle |

## 9. The fork → run flow the blog narrates

1. Fork the template in Veryfront **or** clone the companion example repository
   (`cp .env.example .env.local`, set `VERYFRONT_API_TOKEN`, `npx veryfront push`,
   `npm run dev`).
2. Sign in to Veryfront.
3. A Salesforce administrator installs the **Veryfront Salesforce Integration**
   package in the target org and verifies that the packaged app is enabled.
4. The Integrations panel shows **Salesforce → Connect**. The user authorizes
   against the same org where the package is installed.
5. Run **"Triage latest open cases."**
6. Pipeline runs green against seeded data; a `Reason` + triage comment land on
   the case.

The single biggest seam is step 3: package installation is an org-level admin
prerequisite, so "fork and run" is not one-click in a Salesforce org that has
not installed the integration.

## 10. Non-goals

- Managed-package install into arbitrary customer production orgs.
- Person Accounts and non-English / localised picklist labels (v1).
- Runtime-registered or self-describing dynamic tools (out of platform scope, §2.1).
- Replacing the curated tools wholesale with generic CRUD (the design keeps both).

## 11. Alternatives considered

- **(a) Keep enumerating every field statically.** Rejected - §3 proves it does
  not scale past the first custom field.
- **(b) Full dynamic MCP-from-`describe`.** Rejected - no platform mechanism
  (§2.1), and describe-as-preflight gets the same safety with far less machinery.
- **(c) Point every demo at a Veryfront-owned seeded org.** Rejected as the
  primary path (it breaks the "your own Salesforce" story), but worth keeping as a
  **"try it without connecting"** fallback mode.

## 12. Risks

- Passthrough writes reduce inline schema guidance → the model may send bad
  fields. Mitigated by describe preflight + a strong tool description.
- Package installation and upgrades require Salesforce administrator action in
  every connected org. Production distribution must define a supported upgrade
  path beyond the current beta package.
- "Just works" is inherently org-dependent (edition, picklists, FLS, validation
  rules). The Developer-Edition golden path is the only fully controllable target;
  the blog should say so plainly rather than over-promise on arbitrary orgs.

## 13. Open questions

- **A. Package distribution.** What production distribution and upgrade path
  replaces the current beta **Veryfront Salesforce Integration** package? The
  per-user OAuth contract remains an org-scoped packaged External Client App;
  service-account client credentials remain a separate customer-managed path.
- **B. Seed mechanism.** SFDX scratch org, unmanaged package, or a first-run agent
  step - and who owns keeping the taxonomy and the `Reason` picklist in lockstep?
- **C. Knowledge dependency.** Keep `case-classify` on the project-local taxonomy
  (current, robust), or offer an optional Salesforce-Knowledge variant behind a
  "Knowledge enabled" check?
- **D. API version.** Reconcile `v61.0` (connector) vs `v59.0` (legacy client).
- **E. Repo parity.** Publish the companion example repository and enforce 1:1
  parity with the Studio project (a drift check in CI?). Until it is public,
  the clone-and-run path is documented as *future* (§1, §9).
- **F. Per-CRUD enforcement.** The generic tier - especially `delete_record` - is
  blocked until the #6364 `permissions` arrays are *enforced* fail-closed
  server-side (§16). Who owns that, and what's the acceptance test?
- **G. PII policy.** Ratify the fail-closed allowlist and its blast radius (child
  runs, tool errors, logs) before open-sourcing (§4.8).

## 14. Appendix A - Baseline standard-object & field coverage

The point of a baseline is to let *many* example agents (not just triage) run
against a vanilla org with **no custom fields and no schema edits**. The way to
guarantee that is to constrain every default SOQL query and every write tool to
**standard fields on standard objects** - those cannot be deleted, so they exist
on every org - while treating picklist *values* and FLS as run-time unknowns.

> Field flags below are verified against the Salesforce **Object Reference** PDF
> (§Sources). Note the API's `Restricted picklist` flag is *narrow*: on Case, only
> `Language`/`ArticleLanguage` carry it - `Status`/`Priority`/`Origin`/`Reason`/
> `Type` do **not** by default. But orgs routinely enable "restrict to defined
> values," and off-list values are bad data regardless - so treat every picklist
> as describe-first. The authoritative per-field `createable`/`updateable`/
> `required`/restricted flags should come from `describe()` at run time (the #6364
> matrix already surfaces `queryable`/`createable`/`updateable`/`deletable`), not
> from a hard-coded list.

### A.1 The three baseline rules

1. **Read only standard fields - when the object is available.** A standard field
   always *exists* on its object, so a `SELECT` never throws `No such column` for
   schema reasons - *provided the object itself is present* (Case needs Service,
   Opportunity/Lead need Sales; below that edition/cloud the whole object is absent
   → handle as an unsupported-object case, rule 3). It can also be hidden by FLS
   for a weak profile - rule 3.
2. **Never blind-write a picklist value.** `Status`, `Priority`, `Origin`,
   `Reason`, `Type` (Case), `Status` (Lead), `StageName` (Opp), `Rating`,
   `Industry`, etc. carry **org-specific values** - not API-restricted by default,
   but frequently restricted by admins and always meaningful. Either omit them, or
   `describe`/`get_picklist_values` first and send a value the org actually has.
   Safe blind-write targets are **text, textarea, number, date, checkbox, and
   lookup-Id** fields.
3. **Assume nothing about FLS or edition.** A standard field can be invisible to
   the connected profile; a whole object (`Case`, `Opportunity`, `Lead`) can be
   absent below the required edition/cloud. Degrade with a clear message (§8), do
   not stall.

### A.2 Baseline objects (the "get-going" set)

| Object | Cloud / edition needs | Required on create | Safe blind-write fields (non-picklist) | Picklists - validate via describe |
| --- | --- | --- | --- | --- |
| **Account** | any | `Name` | `Name`, `Phone`, `Website`, `Billing*`, `Shipping*`, `NumberOfEmployees`, `AnnualRevenue`, `Description`, `AccountNumber` | `Type`, `Industry`, `Rating`, `Ownership` |
| **Contact** | any | `LastName` | `FirstName`, `LastName`, `Email`, `Phone`, `MobilePhone`, `Title`, `Department`, `AccountId`, `Mailing*`, `Description` | `LeadSource`, `Salutation` |
| **Lead** | Sales | `LastName`, `Company` ¹ | `FirstName`, `LastName`, `Company`, `Email`, `Phone`, `Title`, `Website`, `Street/City/State/PostalCode/Country`, `NumberOfEmployees`, `Description` | `Status`, `LeadSource`, `Industry`, `Rating` |
| **Case** | Service | *(none system-required)* | `Subject`, `Description`, `SuppliedName/Email/Phone/Company`, `ContactId`, `AccountId`, `ParentId` | `Status`, `Priority`, `Origin`, `Reason`, `Type` |
| **CaseComment** | Service | `ParentId` (CommentBody effectively required) | `CommentBody` (createable **and** updateable), `IsPublished` (bool) | - |
| **Opportunity** | Sales | `Name`, `StageName`, `CloseDate` | `Name`, `Amount`, `CloseDate`, `AccountId`, `Description`, `NextStep`, `Probability` | `StageName`, `Type`, `LeadSource` (`ForecastCategory` is **read-only**, derived from `StageName`) |
| **Task** (activity) | any | *(none - `Status`/`Priority` defaulted)* | `Subject`, `ActivityDate`, `WhoId`, `WhatId`, `Description`, `OwnerId` | `Status`, `Priority`, `TaskSubtype` (restricted) |
| **Event** (activity) | any | conditional: `DurationInMinutes`+`ActivityDateTime` **or** `StartDateTime`+`EndDateTime` ² | `Subject`, `WhoId`, `WhatId`, `Location`, `Description`, `OwnerId` | `ShowAs`, `EventSubtype` |
| **User** | any (read-only for lookups) | - | *(don't create)* | - |
| **Group** (queues) | any (read-only for lookups) | - | *(don't create)* | - |

¹ `Lead.Company` is marked `Nillable` in metadata but the Object Reference labels
it *Required*; a null `Company` with a person-account record type converts the lead
to a Person Account (out of baseline, §A.5). Treat it as required.
² `Event`'s duration/time fields are `Nillable` in metadata; the requirement is
conditional (duration+start **or** start+end), enforced by the app, not a hard
API flag - so supply a valid pair rather than assuming one field is required.

### A.3 Standard read-field sets (safe default `SELECT`s)

Curated tools should default to these standard-only field lists (extend via the
tool's `q`/`fields` argument, never bake in a `__c`):

- **Account** - `Id, Name, Type, Industry, Phone, Website, BillingCity, BillingState, BillingCountry, OwnerId, CreatedDate, LastModifiedDate`
- **Contact** - `Id, FirstName, LastName, Email, Phone, Title, AccountId, Account.Name, OwnerId, CreatedDate, LastModifiedDate`
- **Lead** - `Id, FirstName, LastName, Company, Email, Phone, Status, LeadSource, IsConverted, OwnerId, CreatedDate`
- **Case** - `Id, CaseNumber, Subject, Status, Priority, Origin, Reason, Type, ContactId, AccountId, OwnerId, IsClosed, ClosedDate, CreatedDate, LastModifiedDate`
- **CaseComment** - `Id, ParentId, CommentBody, IsPublished, CreatedById, CreatedDate` *(never select `Body`)*
- **Opportunity** - `Id, Name, StageName, Amount, CloseDate, Probability, Type, AccountId, IsClosed, IsWon, OwnerId, CreatedDate`
- **User** - `Id, Name, Email, Username, IsActive`
- **Group** - `Id, Name, Type` *(filter `Type = 'Queue'` for case ownership)*

### A.4 Object → owner/queue lookups

Every owner assignment needs a real ID, not a name. Case and Lead can use an
active `User.Id` or a supported queue `Group.Id`; Opportunity must use an active
`User.Id` and must reject Group IDs. The baseline should ship the user lookup
(`SELECT Id, Name FROM User WHERE IsActive = true`) for all three objects and the
queue lookup (`SELECT Id, Name FROM Group WHERE Type = 'Queue'`) only for
queue-supported Case/Lead assignment examples.

### A.5 What "standard" deliberately excludes (v1)

Person Accounts (Contact fields move onto Account), record-type-scoped picklists,
multi-currency (`CurrencyIsoCode`), localised picklist labels, and Knowledge
(`KnowledgeArticleVersion`). Examples that need these are out of the baseline and
should be labelled as requiring org setup.

## 15. Customization path - the baseline is a floor, not a ceiling

The baseline exists so the fork runs green on day one; **customization is how the
user makes it theirs**. The design must make that a config edit, not a fork of the
code. Four extension points, in the order a user hits them:

1. **Extend field coverage without touching tool code.** Curated read tools take a
   SOQL `q` (and the generic tier takes a `fields` list), so adding a custom column
   is `SELECT …, Priority_Score__c FROM Case`. The passthrough write tools (§5)
   accept any field key, so writing `Region__c` or a custom `Type` value needs no
   new tool - this is the whole reason to prefer passthrough over per-field
   enumeration.
2. **Map the taxonomy to their picklists.** The one file a forker almost always
   edits is `knowledge/case-triage-taxonomy.md`: point each category's
   `reason_api_name` at *their* `Case.Reason` values (and add categories). Because
   `case-classify` reads the taxonomy at run time via `get_file`, editing the file
   *is* the customization - no redeploy of agent logic.
3. **Adapt to the org automatically.** Ship a one-shot **"adapt to my org"**
   onboarding step (an agent run or a script) that calls `describe_object` on
   `Case`/`Account`/etc., writes the org's real picklist values and any custom
   fields into a project config/knowledge file, and lets the user confirm the
   taxonomy mapping. This turns §4.1 (picklist mismatch) from a silent failure into
   a guided setup - and is the mechanism that makes "customize" self-serve.
4. **Swap objects entirely.** The generic `get/create/update_record` + `run_soql`
   + `describe` tier means a user can retarget the pipeline at a *custom* object
   (e.g. `Ticket__c`) or a different standard object without waiting for Veryfront to add a
   curated tool.

Design implication: keep org-specific values (picklist mappings, field lists,
target objects) in **editable project files** (taxonomy + a small config), never
hard-coded in agents or `connector.json`. The template ships the baseline; the
user edits data files to fit their org.

## 16. Permission & dynamic-object model (prior art: `veryfront-studio` #6364)

Two capabilities this RFC leans on **already exist** and must not be reinvented -
they live studio/server-side, not in `connector.json`:

**Dynamic object discovery.** The project-level *Integrations → Salesforce →
Configure* view fetches the org's objects at runtime via `describe()`
(`listSalesforceObjects({ projectId })`, query key
`connections-panel:salesforce-objects:${projectId}:list`) and renders **every
object in the org - standard and custom** - each carrying real capability flags
mapped from `describe()`:

| Matrix column | `describe()` flag |
| --- | --- |
| Read | `queryable` |
| Create | `createable` |
| Edit | `updateable` |
| Delete | `deletable` |

Deprecated/hidden objects (`deprecatedAndHidden`) are filtered out. Orgs return
hundreds of objects, so the matrix is **searchable by name** and **deny-by-default**.

**Granular per-CRUD permissions.** Config persists as a **dual write**:
`dataAccess.objects: string[]` (the allow-list enforced today) **plus** per-CRUD
arrays `permissions: { read: [], create: [], update: [], delete: [] }` (granular
enforcement rolling out), alongside guardrails `allowExpertSoql: boolean`, a
max-rows cap, and customer mapping.

**Consequences for this RFC:**

1. **This answers "what if the user has custom objects."** They are discovered by
   `describe()` and appear in the matrix automatically; no tool or connector edit
   is needed. Custom objects are exercised through the **generic tool tier**
   (Appendix B), never through curated standard-object tools.
2. **Capability (tools) and authorization (matrix) are separate layers - but the
   fence must actually be *enforced* before the generic tools ship.** Today only
   `dataAccess.objects` (object-level) is enforced; the per-CRUD `permissions`
   arrays are persisted but **not yet enforced**. So a generic `delete_record`
   shipped now would let any object with *object-level* access be **deleted** under
   that coarser grant - Delete is not actually fenced yet. Precondition: define a
   **fail-closed precedence** (`permissions` denies beat `dataAccess.objects`
   grants; unknown → deny), enforce it against the runtime `sobjectType` before
   *every* generic CRUD call, and honour `allowExpertSoql`. `delete_record` stays
   out of v1 until Delete enforcement is verified live. **This applies to reads and
   metadata too, not just writes:** server-side parse and allowlist every object
   referenced by `run_soql_query`, SOSL `search`, and the curated tools that accept
   an arbitrary `q` - including relationship targets (`Account.Name`, `__r`) and
   subqueries - and authorize the `sobjectType` for `describe_object` and
   `get_picklist_values`. Deny unknown or unparseable requests (fail closed).
3. **"Tools are static" still holds** (§2.1) - but *objects* and *permissions* are
   dynamically discovered and enforced. The static generic tools are the fixed
   *execution surface*; the Configure matrix is the dynamic *policy surface* over
   whatever objects the org actually has.
4. Known gap to track: with a **project-only** connection (no personal user
   connection) object discovery returns `400 "not connected for this user"` - the
   fork→run flow must establish the right connection identity before Configure
   works.

## Appendix B - proposed generic tool spec

Modeled on the shipped ServiceNow passthrough pair
(`servicenow__create_table_record` / `update_table_record`), which is the proven
`bodyMode: "passthrough"` shape. Five tools give complete CRUD over **any** object
- standard or custom - governed by the §16 matrix. **Two hard preconditions gate
these tools (do not ship without both):** (1) per-operation authorization is
*enforced* server-side, fail-closed, against the runtime `sobjectType` (§16) -
`delete_record` waits for verified Delete enforcement and is **out of v1**; and
(2) server-side path validation (below).

**Server-side path validation (before URL interpolation).** Validate `sobjectType`
and `externalIdField` as Salesforce API names (`^[A-Za-z][A-Za-z0-9_]*$`, `__c`/`__r`
allowed) and `recordId` as a 15- or 18-char Salesforce ID; **authorize the
canonical `sobjectType` against the matrix first**, then URL-encode each path
segment exactly once (including `externalIdValue`). Reject query/fragment
delimiters and path-traversal. Add dedicated server-side validators that enforce
this contract exactly. Do not reuse the generated client's `validateSalesforceId`
(which also accepts 16- and 17-character values) or `validateFieldName` (which
allows dots).

**`bodyMode: "passthrough"` is production-proven, not speculative.** 16 passthrough
write tools ship across 9 live integrations today - ServiceNow
(`create_table_record`, `update_table_record`), QuickBooks (`create_invoice`,
`create_bill`, `create_purchase`), Xero (`create_invoice`, `create_bill`,
`create_purchase_order`), Shopware (`create_product`, `update_product`), plus
Apify/Axiom/fal/Azure-Blob/GCS. ServiceNow's `POST /table/{tableName}` with a
single `{ record: object }` body is the *same* semantic Salesforce needs
(`POST /sobjects/{sobjectType}`), so the server-side unwrap-`record`-to-raw-body
behaviour is already exercised. Residual risk: near-zero.

| Tool | Method | URL (after `{{oauth.raw.instance_url}}/services/data/v61.0`) | Body (`passthrough`) | `requiresWrite` |
| --- | --- | --- | --- | --- |
| `get_record` | GET | `/sobjects/{sobjectType}/{recordId}` (opt. `?fields=`) | - | false |
| `create_record` | POST | `/sobjects/{sobjectType}` | `{ record: object }` | true |
| `update_record` | PATCH | `/sobjects/{sobjectType}/{recordId}` | `{ record: object }` | true |
| `delete_record` | DELETE | `/sobjects/{sobjectType}/{recordId}` | - | true - **deferred out of v1** until Delete enforcement is live (§16) |
| `upsert_record` | PATCH | `/sobjects/{sobjectType}/{externalIdField}/{externalIdValue}` | `{ record: object }` | true |

Full `create_record` entry:

```json
{
  "id": "salesforce__create_record",
  "name": "Create Record",
  "description": "Create a record in any Salesforce object (standard or custom). Governed by the project's Salesforce data-access grants. Call describe_object / get_picklist_values first for required fields and restricted picklists.",
  "requiresWrite": true,
  "endpoint": {
    "method": "POST",
    "url": "{{oauth.raw.instance_url}}/services/data/v61.0/sobjects/{sobjectType}",
    "params": {
      "sobjectType": { "type": "string", "in": "path", "required": true,
        "description": "API name, e.g. Contact, Opportunity, or a custom object like Ticket__c" }
    },
    "bodyMode": "passthrough",
    "body": {
      "record": { "type": "object", "required": true,
        "description": "Field map, e.g. {\"LastName\":\"Doe\",\"AccountId\":\"001...\"}. Custom __c fields pass through unchanged." }
    }
  }
}
```

`update_record` / `delete_record` / `upsert_record` mirror this with the path
params above; `get_record` takes an optional `fields` query param to trim the
response. Two additional non-CRUD tools complete the surface:

- **`get_picklist_values`** - returns the picklist values *applicable to a write*,
  which is **record-type-scoped**, not the object-wide set. Object `describe` only
  exposes each field's full `fields[].picklistValues`; the values actually valid for
  a given record type come from the UI API. Contract:
  - **Inputs:** `sobjectType` (required); `recordTypeId` (optional - defaults to the
    connected profile's default record type for that object); `field` (optional -
    filter to one picklist field, e.g. `Reason`).
  - **Path safety:** validate `sobjectType` and `fieldApiName` as Salesforce API
    names and `recordTypeId` as a Salesforce ID; authorize the canonical
    `sobjectType`; reject traversal plus query/fragment delimiters; and encode each
    path segment exactly once before composing either UI API endpoint form.
  - **Endpoint:** `GET /services/data/v61.0/ui-api/object-info/{sobjectType}/picklist-values/{recordTypeId}/{fieldApiName}`
    (per field), or the `object-info` form for all fields; fall back to
    `describe_object` `fields[].picklistValues` **only** when the org has no record
    types for the object.
  - **Response:** `{ sobjectType, field, recordTypeId, values: [{ label, value, active, validFor }] }`
    - `value` (the API name) is what a write must send.
  - **Test:** a record type whose allowed `Reason`/`Status` set is a strict subset of
    the object-wide set, asserting the tool returns the record-type set, not the
    superset (§4.1, §5.3, §A.5).
- **`search`** (SOSL) - `GET /search/?q=FIND {…} IN ALL FIELDS …` for cross-object
  keyword lookup, distinct from the SOQL that `find_customer` uses.

Curated per-object write wrappers (`create_contact`, `update_account`,
`create_opportunity`/`update_opportunity`, `create_task`) and `convert_lead`
remain **optional ergonomics** on top of this tier - `convert_lead` is the only
one that is *not* plain passthrough (Lead conversion is a dedicated action, not an
sObject write) and needs its own endpoint.

**SOQL note for custom objects:** relationship traversal on custom lookups uses
the `__r` suffix (e.g. `SELECT Ticket__r.Owner.Name FROM Case`); the agent needs
this in the tool description or it will guess `__c`.

## Sources

Standard object & field metadata (authoritative - createable/updateable/required/restricted flags in Appendix A were verified against this):
- [Object Reference for the Salesforce Platform (PDF)](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf) - Account, Contact, Lead, Case, CaseComment, Opportunity, Task, Event field tables. **Note:** this is a mutable `latest/latest` URL. The exact artefact used for Appendix A was retrieved **2026-08-12**, 22,456,943 bytes, `sha256 d0a5d6db2b830e2b8e856597776a18061154e08544ea3b577b707f0e3f47d4a7`. Re-verify (or check in a snapshot) if the baseline is disputed, since Salesforce may update the file in place.

Salesforce edition / API access:
- [Supported Editions & Required Permissions - REST API Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_rest_compatible_editions.htm)
- [Salesforce editions with API access (Help)](https://help.salesforce.com/s/articleView?id=000385436&language=en_US&type=1)
- [Accessing REST API in Group and Professional Editions](https://developer.salesforce.com/docs/atlas.en-us.packagingGuide.meta/packagingGuide/dev_packages_rest_api_access.htm)
- [Salesforce 2025 Free / Starter / Pro Suites - limits](https://salesforcemonday.com/2025/11/18/salesforce-2025-free-starter-pro-suites-pricing-limits/)

Restricted picklists:
- [How to fix INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST](https://medium.com/@aleksej.gudkov/how-to-fix-the-invalid-or-null-for-restricted-picklist-error-in-salesforce-0a544e63e60b)
- ['Bad value for restricted picklist field' (Salesforce Help)](https://help.salesforce.com/s/articleView?id=000384095&language=en_US&type=1)

Salesforce Knowledge enablement:
- [Enable Lightning Knowledge (Help)](https://help.salesforce.com/s/articleView?id=knowledge_lightning_enable.htm&type=5&language=en_US)
- [The Ultimate Guide to Salesforce Knowledge (Salesforce Ben)](https://www.salesforceben.com/introduction-salesforce-knowledge/)

Code references (this repo): `src/integrations/schema.ts:407-416,468`,
`src/integrations/remote-tools.ts:560-600,782-788`,
`scripts/build/generate-integrations-module.ts:86,98`,
`templates/integrations/salesforce/connector.json`,
`templates/integrations/salesforce/files/lib/salesforce-client.ts:3`.
