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
(b) resolves whether the 16 tools must be dynamic against how the
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
    `salesforce__list_case_activity`, `salesforce__list_cases` with the v1
    open-case constraint. Fetches + PII-redacts.
  - `case-classify` - **no Salesforce access**. Tools: `search_knowledge`,
    `get_file`. Classifies against the checked-in `knowledge/case-triage-taxonomy.md`.
  - `case-dispose` - write. Current connector grant:
    `salesforce__add_case_comment` plus `salesforce__update_case`. That pair
    posts the triage comment and updates `Case.Reason`, but the Case-update
    scoping is **prompt-driven today**: the granted `update_case` can write every
    writable Case field, so the boundary is instructed, not enforced. §5.2/§6
    replace that grant with the hardened target grant:
    `salesforce__update_case_reason`, `salesforce__add_internal_case_comment`,
    and `salesforce__get_picklist_values_for_record_type`. `update_case_reason`
    admits only `caseId` and `Reason`; `get_picklist_values_for_record_type`
    performs the mandatory `Reason` preflight; `add_internal_case_comment` omits
    `IsPublished` and its server-owned request body always sets
    `IsPublished: false`. The target grant keeps separate fixed `Case` Update
    and `CaseComment` Create authorization checks.
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
is a static `connector.json` entry. `IntegrationEndpointSchema` accepts concrete
endpoint strings, literal params, and literal defaults - not computed defaults or
conditional endpoint composition. "Make the tools dynamic" is therefore not an
available knob. The available lever is **what those static entries declare**, plus
gated escape hatches such as `describe_object` and, after SOQL authorization is
fail-closed, `run_soql_query`.

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
   get_case                   search_knowledge          update_case_reason
   list_case_activity         get_file (taxonomy)       add_internal_case_comment
   list_cases (open-constrained)     │                   get_picklist_values_for_record_type
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
  │ metadata: describe_object │               └────────────────────────────────────┘
  │ deferred: run_soql_query  │                 generic CRUD + arbitrary-SOQL reads
  └──────────────────────────┘                 ship ONLY once per-object enforcement
                                                parses every referenced object
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
   value must come from the org, via `describe`/`get_picklist_values_for_record_type`.
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
keep the tool out of the v1 discovery surface until the hosted integration
executor implements the typed Knowledge-disabled adapter in §8. The static
`connector.json` response transform cannot implement that non-2xx behavior.

### 4.4 Validation rules & required custom fields

`create_case` / `create_lead` fail on orgs with required custom fields or
validation rules (`FIELD_CUSTOM_VALIDATION_EXCEPTION`, `REQUIRED_FIELD_MISSING`).
Infer required create fields from `describe()` metadata where
`createable = true`, `nillable = false`, and `defaultedOnCreate = false`, then
exclude fields the platform or object-specific docs prove are system-supplied or
conditionally required. Validation rules and many managed-package requirements are
not discoverable through `describe()`, so a vanilla Developer org can still differ
from a customer org. This mostly affects the "create a case" prompt, less the
triage path.

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
present that service-account setup as the per-user connection path. Before the
template ships, update `templates/integrations/salesforce/connector.json`, the
generated setup page helpers, and generated `SETUP.md` copy so per-user OAuth
asks the Salesforce administrator to install and enable the packaged External
Client App, not to create a Connected App or set `SALESFORCE_CLIENT_ID` /
`SALESFORCE_CLIENT_SECRET`. The service-account path may mention only the
`SALESFORCE_SERVICE_ACCOUNT_*` variables and must stay separated from the
fork-to-run connection path. See **Open Question A** for the package's
production distribution and upgrade contract.

### 4.7 Housekeeping: API version drift

`connector.json` pins `v61.0`; the legacy generated-project client
`files/lib/salesforce-client.ts:3` pins `v59.0`. Reconcile to one version.

### 4.8 The PII-redaction boundary must be specified before open-sourcing

`case-ingest` redacts PII before handing off to `case-classify`, but the current
policy is prompt-driven and denies nothing structurally. Before this is a public
template, define it explicitly, and **fail closed**:

- **Which fields** are passed downstream - an *allowlist* of non-PII operational
  fields (`Id`, `CaseNumber`, `Status`, `Priority`, `Reason`, `Origin`,
  `CreatedDate`, `RecordTypeId`) plus the explicit sanitized classification
  fields below, not a denylist of PII patterns. Custom `__c` fields and any
  newly appearing activity fields must default to *excluded*, not forwarded raw.
- **Failure mode** - if redaction is uncertain or errors, stop rather than forward
  raw case data.
- **Blast radius** - the same policy must cover child-run payloads, tool-error
  messages, and telemetry/logs, or raw PII leaks around the redaction step.

The first redaction boundary is the hosted tool-result boundary, not the
`case-ingest` handoff. `get_case` and `list_case_activity` can return raw Case and
CaseComment payloads, including standard customer fields such as `SuppliedEmail`
and `SuppliedPhone`, free text, and custom `__c` fields; if the agent runtime
persists those tool results before `case-ingest` builds the sanitized child
payload, durable run history already contains customer text. V1 must either
return a hosted allowlisted projection before persistence or suppress persistence
of the raw tool result and persist only the sanitized projection. Redacting only
`Subject`, `Description`, and `CommentBody` is insufficient because unprojected
sObject responses can contain other customer data. Do not reveal the template
until tests prove every non-allowlisted field is dropped or redacted before stored
run messages, streaming tool-result history, errors, logs, or telemetry can
observe it.

`case-ingest` must construct a new downstream object rather than spread or rename
the Salesforce response. The only free-text fields accepted by `case-classify`
are `sanitizedSubject` (string, at most 512 characters), `sanitizedDescription`
(string, at most 16,384 characters), and `sanitizedComments` (at most 20 strings,
each at most 4,096 characters). Each value is Unicode-normalized, has every
detected PII span replaced with `<REDACTED>`, and is validated against those exact
types and bounds after redaction. Raw `Subject`, `Description`, `CommentBody`,
tool responses, and unknown keys are rejected at the child-run boundary. If the
redactor cannot classify a span, the validator rejects a value, or truncation
would split a redaction marker, `case-ingest` stops without invoking
`case-classify`. This preserves the text needed to classify a case without making
raw customer text part of the downstream contract.

For existing Case triage, the downstream object must also carry the source Case's
actual `RecordTypeId` when Salesforce returns it. `case-dispose` uses that value
when calling `get_picklist_values_for_record_type` before writing `Reason`; it
must not fall back to the connected user's default record type for an existing
Case. If `RecordTypeId` is absent and the org has multiple Case record types,
`case-dispose` fails closed or performs a constrained Case lookup that returns
only `Id` and `RecordTypeId`.

## 5. Static vs dynamic tools - the design decision

Given §2.1, tools **must** be static `connector.json` entries. The static entries
stay the public tool surface, but the v1 design is not executable through
`connector.json` alone. It depends on hosted integration-executor behavior that
owns immutable query binding, fixed-operation authorization, adapter responses,
and path validation. The design gets dynamic-*enough* behaviour from three levers:

1. **Read can be dynamic only after SOQL authorization is fail-closed.**
   `find_customer`, `list_cases`, `search_contacts`, etc. currently take an
   arbitrary SOQL `q`; `run_soql_query` is a universal read. Those surfaces give
   broad coverage, but they also move authorization from a known object path into
   parsed query text. In v1, ship only fixed-object defaults or constrained filters
   unless the server can parse every referenced object, relationship target, and
   subquery in a supplied `q`, authorize each object against the matrix, and deny
   unknown or unparseable queries fail-closed. Disabling agent-facing `q` overrides
   is not enough by itself: every retained `/query` tool uses one hosted
   curated-query adapter with a server-owned map from tool ID to fixed SOQL and
   optional typed filters. The adapter injects `q` after validating the filters;
   `q` is absent from the published tool schema, and a caller-supplied `q` or
   unknown filter is rejected.

   | Tool | Immutable query contract |
   | --- | --- |
   | `find_customer` | `Contact` fields from §A.3 only; optional escaped email, name, phone, or validated `AccountId` filters; limit at most 25 |
   | `search_accounts` | `Account` fields from §A.3 only; optional escaped name or validated owner filter; limit at most 50 |
   | `search_contacts` | `Contact` fields from §A.3 only; optional escaped name/email or validated `AccountId` filter; limit at most 50 |
   | `list_cases` | `Case` fields from §A.3 with mandatory `IsClosed = false`; optional validated Contact, Account, Owner, Priority, or CreatedDate filters; limit at most 50 |
   | `list_case_activity` | `CaseComment` fields from §A.3 with required validated `ParentId = caseId`; limit at most 50 |
   | `search_knowledge_articles` | the exact hosted Knowledge adapter and fixed query contract in §8 |
   | `list_opportunities` | `Opportunity` fields from §A.3 only; optional validated `AccountId`, owner, or closed-state filters; limit at most 50 |
   | `list_active_users` | `User` fields `Id, Name` only with mandatory `IsActive = true`; optional escaped name filter; limit at most 50 |
   | `list_case_queues` | `Group` fields `Id, Name, Type` only with mandatory `Type = 'Queue'` and server-owned `QueueSobject.SobjectType = 'Case'` semi-join; limit at most 50 |
   | `list_lead_queues` | `Group` fields `Id, Name, Type` only with mandatory `Type = 'Queue'` and server-owned `QueueSobject.SobjectType = 'Lead'` semi-join; limit at most 50 |

   Salesforce IDs use a dedicated exact 15-or-18-character validator. Text
   filters are bound through one SOQL-literal escaper and cannot contribute field,
   object, operator, ordering, or limit syntax. Direct sObject-by-ID tools such as
   `get_case`, `get_contact`, and `get_account` keep their validated path parameter
   and do not use this adapter, but each retained direct read still needs a fixed
   object/Read authorization check before execution (`Case` Read for `get_case`,
   `Contact` Read for `get_contact`, and `Account` Read for `get_account`). Do not
   infer Read from the legacy `dataAccess.objects` allow-list or from any write
   grant while per-CRUD enforcement is not live. If the hosted adapter is
   unavailable, the affected query tool stays hidden; the connector must not fall
   back to its current broad `endpoint.params.q.default` or expose `q` to restore
   functionality. The same referenced-object rule applies to static query defaults:
   a fixed `Contact` query that selects
   `Account.Name`, `Account.Type`, or `Account.Industry` also needs `Account` Read.
   Until that check exists for static defaults, remove relationship fields from the
   v1 `find_customer` and `search_contacts` defaults instead of relying on Contact
   Read alone. Likewise, the v1 `list_cases` default for the "latest open cases"
   flow must not be an unconstrained recent Case query: it needs a fixed
   `WHERE IsClosed = false` query or a required open-case filter the server cannot
   omit.
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
   field**, but ship it only with explicit fixed `Case` Update authorization before
   the call. Because per-CRUD arrays are persisted but not enforced yet (§16),
   object-level allowlisting or Contact/Case Read does not imply Update. The same
   fixed authorization rule applies to retained curated writes such as
   `add_internal_case_comment`, `create_case`, `create_lead`, and any temporary
   retained `update_case`; gate each write tool unless the server checks its concrete
   object/operation pair fail-closed. Reserve passthrough for the generic tier
   under the §16 matrix. An input-schema authorization test (§6) proves the scoping
   - a prompt cannot.
   Trade-off: passthrough's
   looser JSON Schema gives the LLM less guidance - mitigate with a strong tool
   `description` and a describe preflight. These tools must remain unshipped until
   the fail-closed per-CRUD matrix in §16 is enforced for every generic call.
3. **Describe-driven preflight.** Before a write, the agent learns *this org's*
   real picklist values / required fields via `describe_object`. For a
   classification field such as `Reason`, the agent writes only through a
   user-confirmed taxonomy-to-org mapping. If no mapping exists, report the
   allowed values and fail closed. It can be a prompt rule in `case-dispose`, or the
   curated `get_picklist_values_for_record_type` helper.

**Recommendation: hybrid.** Keep a comprehensive, ergonomic **static core** of
curated tools (they make the demo legible and the agent fast, and stay
field-scoped for least-privilege agents), add a **passthrough generic tier** for
breadth, and lean on `describe_object` plus fixed-object curated reads for v1.
`run_soql_query`, SOSL `search`, and curated arbitrary `q` overrides become
completeness escape hatches only after §16 query parsing and authorization are
enforced fail-closed. Do **not** pursue runtime-registered/dynamic tools - out of
platform scope and unnecessary. **Precondition (§16):** the generic tier ships only
once the per-operation authorization matrix is *enforced* server-side
(fail-closed) against the runtime `sobjectType` - not before. Until then every
generic CRUD tool, including `get_record`, stays out of the shipped surface.

**Hosted dependency inventory and sequencing.** Treat these as implementation
dependencies, not static-schema details:

| Dependency | Owner boundary | Needed before |
| --- | --- | --- |
| Curated-query adapter that maps tool IDs to server-owned SOQL plus typed filters | Hosted integration executor / tools API | Retaining `find_customer`, `list_cases`, `list_case_activity`, `search_accounts`, `search_contacts`, `list_opportunities`, or Knowledge search after agent-facing `q` is hidden |
| Fixed object/Read authorization for retained direct reads | Hosted integration executor, using the Configure permission policy | Retaining direct sObject tools such as `get_case`, `get_contact`, and `get_account` while per-CRUD arrays are not generally enforced |
| Fixed object/operation authorization for curated writes | Hosted integration executor, using the Configure permission policy | Shipping `update_case_reason`, `add_internal_case_comment`, retained `create_case`, retained `create_lead`, or any temporary retained `update_case` |
| Fixed owner lookup adapters for `User`, Case queues, and Lead queues | Hosted integration executor / tools API, using server-owned SOQL and typed filters | Discovering owner candidates for Case and Lead while arbitrary `run_soql_query` and `q` remain hidden. Opportunity uses `User` candidates only. Lead and Opportunity assignment writes remain gated until scoped write tools or generic CRUD enforcement exist |
| Pre-persistence PII redaction or raw-result persistence suppression | Hosted integration executor plus agent runtime persistence/streaming boundary | Revealing `get_case`, `list_case_activity`, or the case-ingest template against customer text |
| Fixed metadata-helper authorization | Hosted integration executor, using the Configure permission policy | Retaining `describe_object` or `get_picklist_values_for_record_type` for an object while per-CRUD arrays are not generally enforced |
| Referenced-object parser/enforcer for arbitrary SOQL/SOSL | Hosted integration executor and authorization layer | Re-enabling `run_soql_query`, SOSL `search`, or any arbitrary curated `q` override |
| Per-CRUD enforcement against runtime `sobjectType` | Configure policy storage plus hosted authorization enforcement | Shipping any generic CRUD tool |
| Server-side path validators for API names, Salesforce IDs, and encoded path segments | Hosted integration executor before URL interpolation | Shipping generic CRUD, picklist helpers, or any future path-composed static endpoint |
| Write-status, Knowledge-disabled, and normalized-result adapters | Hosted integration executor response/error adapter layer | Returning `{ success: true }` for successful 204 writes, the RFC's Knowledge fallback shape, or normalized picklist result shape instead of raw Salesforce responses |

Sequence v1 conservatively: first land the hosted curated-query adapter, fixed
direct-read authorization, fixed owner lookup adapters, fixed curated-write
authorization, pre-persistence PII redaction or raw-result persistence
suppression, fixed metadata-helper authorization, path validators, and
write-status plus Knowledge/picklist adapter contracts with fail-closed tests;
then reveal the curated v1 tool surface. Keep generic CRUD and arbitrary
SOQL/SOSL hidden until the per-CRUD matrix and referenced-object query parser are
enforced. The companion template and Studio project must not advertise a tool or
assignment workflow before the hosted dependency that makes its contract
fail-closed is live.

## 6. Proposed comprehensive tool surface

Reorganise the 16 into three tiers. Once the §16 enforcement gate is satisfied,
the generic tier alone gives complete standard+custom coverage; the curated tier
exists for ergonomics and blog readability.

**Tier 1 - Curated triage happy path (keep, ergonomic wrappers):**
`find_customer`, `list_cases`, `get_case`, `list_case_activity`,
`add_case_comment` (general curated wrapper, not granted to `case-dispose`),
`update_case` (curated standard Case update; incl. `Type` per
#3638; **not** passthrough, §5.2), `update_case_reason` (future field-scoped tool
that writes `Case.Reason` only - the sole Case-update tool granted to
`case-dispose`), `add_internal_case_comment` (future internal-only CaseComment
helper granted to `case-dispose`), plus `search_accounts`, `get_account`, `search_contacts`,
`get_contact`, `list_opportunities`, `create_case`, `create_lead`.

`update_case` is **not** the structural least-privilege boundary today. Its current
schema can write the standard writable Case fields listed in §3, so the present
`case-dispose` scoping is a prompt rule. The hardened template must remove
`update_case` from `case-dispose` and grant only `update_case_reason` for the Case
update once that field-scoped tool exists. It must also replace the generic
`add_case_comment` grant with `add_internal_case_comment`. The helper accepts only
the case ID and comment text, and the hosted adapter constructs the Salesforce
body with `IsPublished: false`; callers cannot override or supply that field.
`update_case_reason` still needs a fixed `Case` Update
authorization check before execution; if that check is not available, the helper
stays out of v1. Retained curated write tools also need fixed checks for their
concrete operation (`CaseComment` Create, `Case` Create/Update, `Lead` Create).
Do not infer those writes from `dataAccess.objects` or from a Read grant while the
per-CRUD arrays are not enforced.

Retained direct reads need the same concrete-operation treatment for Read:
`get_case`, `get_contact`, and `get_account` stay in v1 only if the hosted
executor denies each call without the matching object Read grant. A project with
Case Update but no Case Read must not be able to call `get_case`.

**Caveat - `list_cases` must be open-case constrained once `q` overrides are
disabled.** The current default is `SELECT ... FROM Case ORDER BY LastModifiedDate
DESC LIMIT 50`, with no `WHERE IsClosed = false`. That contradicts the public
"Triage latest open cases" promise because closed cases can appear in the default
result and flow into triage/dispose. Retain a v1 case-listing tool only if it is a
static open-case tool: either replace it with `list_open_cases` or make
`list_cases` require an open-case input such as `openOnly = true`, then compose a
fixed query that includes `WHERE IsClosed = false` plus optional safe filters such
as Contact, Account, Owner, Priority, CreatedDate, and limit. If the server cannot
force that open predicate, gate the general `list_cases` tool until the SOQL
parser/enforcer can prove the supplied query is open-case constrained
fail-closed.

**Caveat - `list_case_activity` must be case-scoped once `q` overrides are
disabled.** The current tool is a broad CaseComment SOQL query with an optional
instruction to add `WHERE ParentId = '<caseId>'`. When arbitrary `q` is disabled,
v1 must not keep a broad recent-comments default for a single-case triage flow.
Replace it with a static tool that requires a `caseId` path or query parameter and
uses a fixed `WHERE ParentId = '{caseId}'` query, or gate the tool until the SOQL
parser/enforcer can authorize and constrain the supplied query fail-closed.

**Caveat - fixed Contact queries with Account relationship fields.** The current
`find_customer` default selects `Account.Name`, `Account.Type`, and
`Account.Industry` through Contact, and `search_contacts` selects `Account.Name`.
Contact Read alone is not enough for those fields because the query exposes Account
data. V1 must either authorize every referenced object in static defaults
fail-closed, or remove those relationship fields from the fixed defaults. The
fixed-default v1 path removes them and keeps only Contact fields such as
`AccountId`; Account details come from an Account-scoped tool after Account Read is
granted.

**Caveat - `create_case` static picklist defaults.** The curated `create_case`
still hard-defaults `Status = "New"` and `Origin = "Web"` (`connector.json`,
unchanged by #3638). On an org that restricts those picklists - or scopes them by
record type - a blind `New`/`Web` write fails, contradicting the describe-first
rule (§5.3, §A.1 rule 2). Drop both defaults so Salesforce applies the org default
when the field is omitted (or make `get_picklist_values_for_record_type` preflight
mandatory before create), and add a restricted-picklist fixture proving create
succeeds without assumed values.

**Tier 2 - Universal escape hatches (partly gated):** keep `describe_object` only
with fixed metadata-helper authorization for the requested object, and keep
fixed-object curated read defaults in v1. Add fixed lookup helpers
`list_active_users`, `list_case_queues`, and `list_lead_queues` for owner
candidate discovery; these helpers use server-owned SOQL and typed filters, not
caller `q`. They do not by themselves make every owner assignment executable:
Case owner assignment can use a retained, separately authorized Case update path,
but Lead and Opportunity owner assignment stay out of v1 until scoped
`update_lead_owner` and `update_opportunity_owner` helpers or the §16 generic CRUD
gate exists. Gate or remove `run_soql_query`, SOSL
`search`, and any curated arbitrary `q` override until the server can parse and
authorize every referenced object, relationship target, and subquery fail-closed
(§16). Keep `salesforce__search_knowledge_articles` only if it uses a fixed
Knowledge query and degrades gracefully when Knowledge is disabled (§8). Add
**`get_picklist_values_for_record_type`** so `case-dispose` can validate `Reason`
before writing; it must deny without the same object Read grant required by the
target object's metadata lookup.

**Tier 3 - Generic sObject CRUD (specified, held until §16 enforcement):**
`get_record`, `create_record`, `update_record`, `upsert_record`, and
`delete_record` (Appendix B has the full spec), which cover **any** standard or
custom object. The entire generic tier is **deferred out of v1** until fail-closed
per-CRUD enforcement is live for Read, Create, Update, and Delete. `upsert_record`
requires both Create and Update grants for the target `sobjectType`; if the matrix
cannot enforce both grants for one call, remove `upsert_record` from the shipped
surface.

**Tool tally (single source of truth; Appendix B is canonical):** The connector
has 16 tools today, but v1 removes or hides existing `run_soql_query` until the
SOQL authorization gate is live. The other curated tools stay in v1 with
arbitrary `q` overrides disabled, relationship fields removed from fixed Contact
query defaults unless referenced-object authorization exists, and fixed
object/operation authorization enforced before every curated write. `list_cases`
also requires the fixed open-case query/filter above before it counts as retained
in v1; otherwise it moves to the deferred read escape-hatch bucket with the other
arbitrary SOQL surfaces.

| | Tools | Count |
| --- | --- | --- |
| **Existing curated v1 baseline** | the 16 in `connector.json` today, minus existing `run_soql_query` while it is gated; `list_cases` counts only after the fixed open-case query/filter is in place | 15 |
| **Add - helpers (v1)** | `update_case_reason` (`Reason`-only Case update for `case-dispose`), `add_internal_case_comment` (server-fixed `IsPublished: false`), `get_picklist_values_for_record_type`, `list_active_users`, `list_case_queues`, `list_lead_queues` | +6 |
| **Read escape hatches (deferred)** | existing `run_soql_query`, curated arbitrary `q` overrides, `search` (SOSL), pending fail-closed query parsing and authorization | - |
| **Add - generic CRUD (deferred)** | `get_record`, `create_record`, `update_record`, `upsert_record`, `delete_record` (pending fail-closed per-CRUD enforcement) | +5 |
| **v1 total** | after fixed direct-read authorization, fixed write authorization, owner lookup adapters, and static-query relationship-field gates above | **21** |
| **Optional curated wrappers** | `create_contact`, `update_account`, `create/update_opportunity`, `create_task`, `convert_lead` - sugar, not counted in core | - |

**Authorization tests (acceptance gate).** Every least-privilege grant needs an
input-schema test, because the schema *is* the authorization boundary:
`update_case_reason`'s schema must reject any body key other than `caseId`/`Reason`
(so `case-dispose` cannot write `Status`/`OwnerId`/etc. even when prompted to), and
the server must deny `update_case_reason` unless fixed `Case` Update authorization
is present. `add_internal_case_comment` must reject `IsPublished` and every body
key other than `caseId` and comment text, while its server-owned Salesforce body
must include `IsPublished: false`. Tests must prove that prompts, model output,
and caller input cannot publish the comment. `case-dispose` must not receive the
generic `add_case_comment` tool, and the internal helper still needs an independent
`CaseComment` Create grant and denial test. Retained curated writes need the same
fixed object/operation denial tests. Successful `204 No Content` writes, including
`update_case_reason`, must return an explicit `{ success: true }` adapter result
instead of an empty string, and tests must prove the agent-visible result cannot be
misread as failure. Every immutable-query adapter entry must prove that `q` is
absent from the published schema, a supplied `q` and unknown filters are rejected,
and the exact fixed object, field list, predicates, ordering, and limit reach
Salesforce. Retained direct reads must prove the hosted executor denies `get_case`
without Case Read, `get_contact` without Contact Read, and `get_account` without
Account Read, even when the project has a write grant or legacy
`dataAccess.objects` includes the object. Metadata helpers must prove
`describe_object` and `get_picklist_values_for_record_type` deny without Read for
the target object, even if the project has a write grant or legacy
`dataAccess.objects` includes that object. Static Contact query defaults must
also prove they either omit Account relationship fields or deny the query when
Account Read is absent. Each generic CRUD tool must be denied for an un-granted
`sobjectType` (§16). `list_cases`
needs a closed-case exclusion test: seed at least one recently modified closed
Case and assert the v1 open-case listing cannot return it, and assert any missing
or false open-case constraint fails closed rather than falling back to the
unfiltered connector default. Owner assignment needs fixed lookup acceptance gates:
`list_active_users` must return only active `User.Id`/`Name` values and must be
denied without `User` Read; `list_case_queues` and `list_lead_queues` must use
server-owned `QueueSobject.SobjectType` values, seed one Case-only queue and one
Lead-only queue, assert each lookup excludes the queue for the other object, and
reject a queue `OwnerId` unless the selected `Group.Id` has a matching
`QueueSobject` row for the target object. The fixed queue lookup requires Read
authorization for both `Group` and `QueueSobject` and fails closed when either
grant is absent. Opportunity owner candidate lookup must use `list_active_users`
and must reject queue Group IDs. Lead and Opportunity owner write acceptance
criteria stay unmet in v1 unless the implementation adds scoped owner-write
helpers with fixed `Lead` Update and `Opportunity` Update authorization.

The PII gate needs fixture coverage too: raw `Subject`, `Description`,
`CommentBody`, `SuppliedEmail`, `SuppliedPhone`, and a representative custom
field containing email, phone, and customer identifiers must not appear in
persisted tool results, stored run memory, streaming tool-result history,
child-run payloads, errors, logs, or telemetry; the corresponding bounded
`sanitizedSubject`, `sanitizedDescription`, and `sanitizedComments` values must
remain available to `case-classify`, and `RecordTypeId` must remain available to
`case-dispose` for record-type-scoped picklist validation. Unknown fields,
over-limit text, and redactor or post-redaction validation failures must prevent
persistence of raw tool output and prevent the child run. Add a non-default Case
record-type fixture that proves `case-dispose` calls
`get_picklist_values_for_record_type` with the Case's actual `RecordTypeId` and
does not use the connected profile default.

Coverage of the standard objects a "get-going" support/CRM demo needs:
Account, Contact, Lead, Case, CaseComment, Opportunity - plus User through
`list_active_users` for every owner lookup and Group plus QueueSobject through
`list_case_queues`/`list_lead_queues` only for queue-supported objects such as
Case and Lead. These are fixed, object-scoped lookup tools, not arbitrary SOQL.
Opportunity ownership accepts User IDs, not queue Group IDs.
Task/Event (activities) become reachable through the generic tier after the §16
enforcement gate is satisfied.
`salesforce__search_knowledge_articles` stays but is documented as "requires
Knowledge enabled" only after the hosted error-adapter gate in §8 passes.

## 7. Reference org & seed data - "just works" needs *data*

A fresh org has no cases to triage, and its `Reason` picklist won't match the
taxonomy. Ship a **reproducible baseline** so fork→run has something to act on:

These are **two different environments** and must not be conflated - an SFDX
scratch-org definition cannot seed an existing connected org, and automatically
editing `Case.Reason` in a customer org mutates admin-owned picklists and
record-type behaviour.

- **Disposable orgs (Developer Edition / scratch org) - the golden path.** Ship
  two explicit setup phases because metadata installation does not create sample
  records. First create or authenticate the disposable org and deploy the Case
  `Reason` picklist metadata aligned to `case-triage-taxonomy.md` v5 (or install
  the equivalent unmanaged metadata package). Then run a committed data loader,
  for example
  `sf data import tree --plan data/case-triage-plan.json`, that creates the known
  Accounts, Contacts, and Cases used by the demo. The import plan must include at
  least one open Case for triage and one recently modified closed Case for the
  open-case exclusion test. A checked-in setup script must run metadata deployment
  before data import and stop on either failure. Taxonomy, metadata, and seed data
  are versioned together, never independently.
- **Existing / customer orgs - no automatic schema changes.** The fork must *not*
  silently alter picklists. Require an explicit admin-run deploy, or (preferred)
  the "adapt to my org" step (§15) that maps the taxonomy to the org's *existing*
  `Reason` values. Fail closed with a clear message if no mapping exists.
- Until a seed artefact ships, the **"runs green"** claim is conditional - say so
  in the blog. The evals (`evals/mock-tools.ts`) already let CI pass without a real
  org; the seed closes the gap between "evals green" and "real org green."

## 8. Graceful degradation - make errors teach, not stall

Every known failure must return an actionable message instead of a raw
4xx/empty string. Some of this is the hosted API's job (it owns execution); some
is promptable in the agents.

| Condition | Today | Proposed |
| --- | --- | --- |
| Write result | empty string (mis-read as failure in §3) | status-based: POST → `{ id, success, errors }`; PATCH/DELETE `204` → `{ success: true }`. Empty body ≠ failure |
| API disabled for edition | raw 403 | "This Salesforce edition has no API access. Use a free Developer Edition org: <link>." |
| Restricted picklist bad value | raw `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` | catch → describe → retry only after the user confirms a taxonomy-to-org mapping; otherwise report the allowed set and fail closed |
| Case listing not open-constrained | default `list_cases` can return recently modified closed cases | "The latest-open-cases tool is not open-case constrained. Add a fixed `IsClosed = false` query/filter before triage." |
| Knowledge not enabled | raw `INVALID_TYPE` | The hosted integration executor recognizes only the fixed Knowledge query's Salesforce `INVALID_TYPE`, then returns `{ "records": [], "warning": { "code": "knowledge-not-enabled", "message": "Salesforce Knowledge is not enabled for this org." } }`; other non-2xx responses remain errors |
| FLS Edit missing on Reason | silent drop / raw error | name the exact profile toggle |

The Knowledge-disabled result is a hosted execution adapter, not a
`connector.json` `response.transform`. The adapter applies only when the tool uses
the server-owned fixed query with no `q` override and Salesforce returns
`errorCode: "INVALID_TYPE"` for `KnowledgeArticleVersion`. The enabled and
disabled paths must share the response shape: enabled searches return
`{ "records": [...], "warning": null }`, and the disabled path returns the empty
records plus warning object above. This is an intentional v1 tool-result contract;
the generated description must tell callers to read `records`. An acceptance test
must exercise a Knowledge-disabled org, assert that exact payload, and prove
authentication, authorization, rate-limit, and malformed-query failures still
fail. Until the hosted adapter and test exist, hide
`salesforce__search_knowledge_articles` from v1 tool discovery.

## 9. The fork → run flow the blog narrates

1. Fork the template in Veryfront **or** clone the companion example repository
   (`cp .env.example .env.local`, set `VERYFRONT_API_TOKEN`, `npx veryfront push`,
   `npm run dev`).
2. Sign in to Veryfront.
3. A Salesforce administrator installs the **Veryfront Salesforce Integration**
   package in the target org and verifies that the packaged app is enabled.
4. For the disposable-org golden path, run the checked-in setup script. It deploys
   the taxonomy-aligned metadata, imports the committed Account/Contact/Case data
   plan, and verifies that the known open and closed Case records exist. Existing
   customer orgs skip this step and use their own records.
5. The Integrations panel shows **Salesforce → Connect**. The user authorizes
   against the same org where the package is installed.
6. Run **"Triage latest open cases"** through the v1 open-case constrained listing
   tool, not a general recent-cases default.
7. Pipeline runs green against seeded data; a `Reason` + triage comment land on
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
  the blog must say so plainly rather than over-promise on arbitrary orgs.

## 13. Open questions

- **A. Package distribution.** What production distribution and upgrade path
  replaces the current beta **Veryfront Salesforce Integration** package? The
  per-user OAuth contract remains an org-scoped packaged External Client App;
  service-account client credentials remain a separate customer-managed path.
- **B. Seed ownership.** Which release owner updates the data-import plan whenever
  the taxonomy, Case `Reason` metadata, or golden-path assertions change?
- **C. Knowledge dependency.** Keep `case-classify` on the project-local taxonomy
  (current, robust), or offer an optional Salesforce-Knowledge variant behind a
  "Knowledge enabled" check?
- **D. API version.** Reconcile `v61.0` (connector) vs `v59.0` (legacy client).
- **E. Repo parity.** Publish the companion example repository and enforce 1:1
  parity with the Studio project (a drift check in CI?). Until it is public,
  the clone-and-run path is documented as *future* (§1, §9).
- **F. Per-CRUD enforcement.** The entire generic tier is blocked until the #6364
  `permissions` arrays are *enforced* fail-closed server-side (§16). Who owns that,
  and what's the acceptance test?
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
> `required`/restricted flags must come from `describe()` at run time (the #6364
> matrix already surfaces `queryable`/`createable`/`updateable`/`deletable`), not
> from a hard-coded list. Treat a create field as metadata-required when
> `createable = true`, `nillable = false`, and `defaultedOnCreate = false`, then
> apply object-specific documented exceptions for fields that Salesforce supplies or
> requires conditionally. Validation rules are not discoverable through `describe()`.

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
   `describe`/`get_picklist_values_for_record_type` first and send a value the org actually has.
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
| **QueueSobject** (queue/object support) | any (read-only for lookups) | - | *(don't create)* | - |

¹ `Lead.Company` is marked `Nillable` in metadata but the Object Reference labels
it *Required*; a null `Company` with a person-account record type converts the lead
to a Person Account (out of baseline, §A.5). Treat it as required.
² `Event`'s duration/time fields are `Nillable` in metadata; the requirement is
conditional (duration+start **or** start+end), enforced by the app, not a hard
API flag - so supply a valid pair rather than assuming one field is required.

### A.3 Standard read-field sets (safe default `SELECT`s)

Curated tools must default to these standard-only field lists. Extend them via
the tool's `q`/`fields` argument only after the SOQL authorization gate exists;
never bake in a `__c`:

- **Account** - `Id, Name, Type, Industry, Phone, Website, BillingCity, BillingState, BillingCountry, OwnerId, CreatedDate, LastModifiedDate`
- **Contact** - `Id, FirstName, LastName, Email, Phone, Title, AccountId, OwnerId, CreatedDate, LastModifiedDate`
- **Lead** - `Id, FirstName, LastName, Company, Email, Phone, Status, LeadSource, IsConverted, OwnerId, CreatedDate`
- **Case** - `Id, CaseNumber, Subject, Status, Priority, Origin, Reason, Type, ContactId, AccountId, OwnerId, IsClosed, ClosedDate, CreatedDate, LastModifiedDate`
- **CaseComment** - `Id, ParentId, CommentBody, IsPublished, CreatedById, CreatedDate` *(never select `Body`)*
- **Opportunity** - `Id, Name, StageName, Amount, CloseDate, Probability, Type, AccountId, IsClosed, IsWon, OwnerId, CreatedDate`
- **User** - `Id, Name, Email, Username, IsActive`
- **Group** - `Id, Name, Type` *(filter `Type = 'Queue'` and semi-join `QueueSobject` for the target object before presenting owner choices)*
- **QueueSobject** - `QueueId, SobjectType` *(filter `SobjectType` to the fixed target `Case` or `Lead`; never present this mapping record as an owner)*

Do not include relationship fields such as `Account.Name`, `Account.Type`, or
`Account.Industry` in fixed Contact defaults unless the server authorizes the
referenced Account object for Read. Use Account-scoped tools for Account detail
when the Account grant is present.

### A.4 Object → owner/queue lookups

Every owner candidate lookup needs a real ID, not a name. Case and Lead can use
an active `User.Id` or a supported queue `Group.Id`; Opportunity must use an
active `User.Id` and must reject Group IDs. These lookup tools only identify
eligible candidates; Lead and Opportunity owner writes stay gated until scoped
write tools or generic CRUD enforcement exist. The baseline must ship
`list_active_users` for all three objects, backed by:

```sql
SELECT Id, Name
FROM User
WHERE IsActive = true
```

For Case and Lead, the baseline must ship object-specific fixed queue lookup tool
IDs: `list_case_queues` and `list_lead_queues`. `list_case_queues` uses this form
(`list_lead_queues` uses `Lead` instead of `Case`):

```sql
SELECT Id, Name
FROM Group
WHERE Type = 'Queue'
AND Id IN (
  SELECT QueueId
  FROM QueueSobject
  WHERE SobjectType = 'Case'
)
```

Build `SobjectType` from the fixed `Case`/`Lead` owner lookup path, never from an
arbitrary query fragment. Before any scoped owner-write tool writes `OwnerId`,
validate the selected `Group.Id` against that same object-specific result. A
`Type = 'Queue'` Group without the matching `QueueSobject` row is not an eligible
owner and must fail closed.

### A.5 What "standard" deliberately excludes (v1)

The baseline seed excludes Person Accounts (Contact fields move onto Account),
custom record-type or picklist metadata beyond the Case `Reason` record-type
preflight required for existing Case disposal, multi-currency (`CurrencyIsoCode`),
localised picklist labels, and Knowledge (`KnowledgeArticleVersion`). Examples
that need these are out of the baseline and must be labelled as requiring org
setup.

## 15. Customization path - the baseline is a floor, not a ceiling

The baseline exists so the fork runs green on day one; **customization is how the
user makes it theirs**. The design must make that a config edit, not a fork of the
code. Four extension points, in the order a user hits them:

1. **Extend field coverage without touching tool code.** After the §16 SOQL gate is
   satisfied, curated read tools can safely accept custom `q` overrides, so adding a
   custom column is `SELECT ..., Priority_Score__c FROM Case`. Until then, v1 read
   tools use fixed-object defaults or constrained filters. After the generic CRUD
   enforcement gate is satisfied, the generic tier can take a `fields` list and its
   passthrough write tools (§5) can accept any field key, so writing `Region__c` or
   a custom `Type` value needs no new tool. Until then, custom writes need a
   curated, scoped tool or remain out of the public template.
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
4. **Swap objects entirely.** Once the §16 enforcement gate is satisfied, the
   generic `get_record`, `create_record`, and `update_record` tier, plus the
   existing `run_soql_query` and `describe_object` surfaces, lets a user
   retarget the pipeline at a *custom* object (e.g. `Ticket__c`) or a different
   standard object without waiting for Veryfront to add a curated tool.

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
   `describe()` and appear in the matrix automatically. After fail-closed per-CRUD
   enforcement is live, custom objects are exercised through the **generic tool
   tier** (Appendix B), never through curated standard-object tools. Until then a
   custom-object write needs a curated, scoped tool or stays out of the shipped
   surface. Custom-object reads through arbitrary SOQL are also held until the SOQL
   authorization gate can parse every referenced object, relationship, and subquery.
2. **Capability (tools) and authorization (matrix) are separate layers - but the
   fence must actually be *enforced* before the generic tools ship.** Today only
   `dataAccess.objects` (object-level) is enforced; the per-CRUD `permissions`
   arrays are persisted but **not yet enforced**. So a generic tool shipped now
   would allow the wrong operation under that coarser grant: `get_record` could read
   an object that only had object-level access, `create_record` and `update_record`
   could ignore their specific grants, `upsert_record` could bypass either its
   Create or Update half, and `delete_record` could delete without a real Delete
   fence. Precondition: define a **fail-closed precedence** (`permissions` denies
   beat `dataAccess.objects` grants; unknown → deny), enforce it against the runtime
   `sobjectType` before *every* generic CRUD call, and honour `allowExpertSoql`.
   `upsert_record` must require both Create and Update grants for the target
   `sobjectType`, or it must not ship. The entire generic tier stays out of v1
   until per-CRUD enforcement is verified live. **Read escape hatches have their
   own gate:** server-side parse and allowlist every object referenced by
   `run_soql_query`, SOSL `search`, and the curated tools that accept an arbitrary
   `q` - including relationship targets (`Account.Name`, `__r`) and subqueries.
   Authorize each referenced object for Read, authorize the `sobjectType` for
   `describe_object` and picklist tools, and deny unknown or unparseable requests
   fail-closed. Until that parser/enforcer exists, v1 must remove or hide
   `run_soql_query`, hide SOSL `search`, and disable arbitrary `q` overrides on
   curated reads. Static curated query defaults have the same referenced-object
   obligation: if a default Contact query selects Account relationship fields, the
   server must authorize Account Read or the default must remove those fields.
   V1 uses the removal path for fixed defaults. Static defaults also need
   flow-specific predicates: `list_cases` is retained for "latest open cases" only
   if the server forces `WHERE IsClosed = false` through a fixed query or required
   open-case filter. A missing open predicate must deny the call, not fall back to
   the current broad recent-Case default. Retained direct sObject reads are not
   query escape hatches, but they still need concrete Read enforcement: `get_case`,
   `get_contact`, and `get_account` must deny without `Case`, `Contact`, and
   `Account` Read respectively, regardless of legacy `dataAccess.objects` entries
   or write grants.
3. **Curated writes need their own fixed authorization before per-CRUD arrays are
   enforced.** A fixed-path curated write is safer than generic CRUD because its
   object and operation are known, but it is still a write. Do not infer
   `Case` Update, `Case` Create, `CaseComment` Create, or `Lead` Create from
   `dataAccess.objects` or from any Read grant. V1 may ship `update_case_reason`
   and retained curated writes only if the server checks the concrete
   object/operation pair fail-closed before execution; otherwise those write tools
   stay gated until the per-CRUD matrix is enforced.
4. **"Tools are static" still holds** (§2.1) - but *objects* and *permissions* are
   dynamically discovered and enforced. The static generic tools are the fixed
   *execution surface*; the Configure matrix is the dynamic *policy surface* over
   whatever objects the org actually has.
5. Known gap to track: with a **project-only** connection (no personal user
   connection) object discovery returns `400 "not connected for this user"` - the
   fork→run flow must establish the right connection identity before Configure
   works.

## Appendix B - proposed generic tool spec

Modeled on the shipped ServiceNow passthrough pair
(`servicenow__create_table_record` / `update_table_record`), which is the proven
`bodyMode: "passthrough"` shape. Five tools would give complete CRUD over **any**
object - standard or custom - governed by the §16 matrix. **Two hard preconditions
gate the entire generic tier (do not ship any generic tool without both):** (1)
per-operation authorization is *enforced* server-side, fail-closed, against the
runtime `sobjectType` (§16), including both Create and Update grants for
`upsert_record`; and (2) server-side path validation (below).

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
| `delete_record` | DELETE | `/sobjects/{sobjectType}/{recordId}` | - | true |
| `upsert_record` | PATCH | `/sobjects/{sobjectType}/{externalIdField}/{externalIdValue}` | `{ record: object }` | true - requires both Create and Update grants |

Full `create_record` entry:

```json
{
  "id": "salesforce__create_record",
  "name": "Create Record",
  "description": "Create a record in any Salesforce object (standard or custom). Governed by the project's Salesforce data-access grants. Call describe_object / get_picklist_values_for_record_type first for required fields and restricted picklists.",
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
response. All five entries are specification-only until the §16 enforcement gate
is satisfied. Additional non-CRUD tools complete the future surface:

- **`get_picklist_values_for_record_type`** - returns the picklist values
  *applicable to a write*, which is **record-type-scoped**, not the object-wide set.
  Object `describe` only exposes each field's full `fields[].picklistValues`; the
  values actually valid for a given record type come from the UI API. Contract:
  - **Static endpoint:** one concrete `connector.json` entry with required path
    params `sobjectType`, `recordTypeId`, and `fieldApiName`, mapped directly to
    `GET /services/data/v61.0/ui-api/object-info/{sobjectType}/picklist-values/{recordTypeId}/{fieldApiName}`.
    `IntegrationEndpointSchema` supports this because all path values are supplied
    by the caller; it does **not** support a computed default `recordTypeId`, an
    optional `fieldApiName` that changes the path shape, or an automatic fallback to
    `describe_object`.
  - **Caller contract:** for create preflight, first read the object-info/default
    record-type separately or pass a known `recordTypeId`; for update preflight,
    read the target record and pass its actual `RecordTypeId`. Do not use the
    connected profile default for an existing record.
  - **Composite alternative:** if one public tool must support "default record type"
    or "all picklist fields", implement it as hosted server behavior behind a
    dedicated static endpoint. Do not describe that behavior as plain
    `connector.json` interpolation.
  - **Path safety and authorization:** validate `sobjectType` and `fieldApiName` as
    Salesforce API names and `recordTypeId` as a Salesforce ID; require Read on the
    canonical target `sobjectType`; reject traversal plus query/fragment delimiters;
    and encode each path segment exactly once before composing the UI API endpoint.
  - **Response:** a plain static endpoint returns the raw Salesforce UI API
    picklist-values response. If the public tool contract must return a normalized
    shape such as `{ sobjectType, fieldApiName, recordTypeId, values: [...] }`, add
    hosted response-adapter behavior behind the dedicated static endpoint; do not
    claim `connector.json` response metadata can reshape the UI API object. In both
    shapes, `value` (the API name) is what a write must send.
  - **Test:** a record type whose allowed `Reason`/`Status` set is a strict subset of
    the object-wide set, asserting the tool returns the record-type set, not the
    superset (§4.1, §5.3, §A.5), plus a denial case proving Case Update without
    Case Read cannot call the Case picklist helper.
- **`list_active_users`**, **`list_case_queues`**, and **`list_lead_queues`** -
  fixed hosted lookup helpers for owner candidate discovery. They are not generic
  query tools and their published schemas must not expose `q` or `sobjectType`.
  `list_active_users` returns active `User` owner candidates from
  `SELECT Id, Name FROM User WHERE IsActive = true`; it may accept only typed safe
  filters such as escaped name text and a bounded limit, and it requires `User`
  Read. `list_case_queues` and `list_lead_queues` return queue `Group` owner
  candidates through the fixed `QueueSobject` semi-join in §A.4; the target object
  is encoded in the tool ID, not supplied by the caller. They require `Group` Read
  and `QueueSobject` Read. Tests must prove Case queues never appear in
  `list_lead_queues`, Lead queues never appear in `list_case_queues`, inactive
  users are excluded, and Opportunity owner candidate lookup rejects every queue
  `Group.Id`. These helpers do not ship Lead or Opportunity owner writes.
- **`search`** (SOSL, deferred) - `GET /search/?q=FIND {...} IN ALL FIELDS ...` for
  cross-object keyword lookup, distinct from the SOQL that `find_customer` uses.
  Ship only after the same fail-closed referenced-object authorization gate covers
  SOSL. Require an explicit parsed `RETURNING Object(Field, ...)` clause and
  authorize every returned object for Read before execution. Deny SOSL without
  `RETURNING` fail-closed instead of trying to infer all searchable objects.

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
`templates/integrations/salesforce/files/lib/salesforce-client.ts:3`,
`templates/integrations/_base/files/app/setup/page-helpers.tsx`, and generated
`SETUP.md` setup copy.
