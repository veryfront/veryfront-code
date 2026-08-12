# RFC 0030 — Salesforce Case Triage: a fork-and-run integration template

| Field      | Value                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Status     | Draft — request for comment                                                                             |
| Author     | Matt Boon                                                                                               |
| Created    | 2026-08-12                                                                                              |
| Branch     | `mattboon/phoenix`                                                                                      |
| Affects    | `templates/integrations/salesforce/connector.json`, `src/integrations/schema.ts`, the hosted tools API, the `salesforce-test` studio project, and the public `veryfront/agentic-case-processing` example repo |
| Related    | RFC 0001 (adapters), the `update_case` `Type` fix (`598a26d`)                                            |

## 1. Summary

We want to open-source **Salesforce Case Triage** as the flagship "fork it and it
just works" template: a four-agent pipeline (Ingest → Classify → Dispose) that
reads a Salesforce support case, PII-redacts it, classifies it against a
checked-in taxonomy, then writes a `Reason` and a triage comment back to the
case. The promise in the blog post is a straight line:

> fork the template (or clone `veryfront/agentic-case-processing`) → sign in to
> Veryfront → connect **your own** Salesforce org over OAuth → run "Triage latest
> open cases" → it runs green.

**The pipeline works today.** Against the reference org it ingests, redacts,
classifies, and disposes a case end-to-end — `case-dispose` writes `Reason` and
posts the triage comment successfully. This RFC is **not** a bug report; it is a
hardening + generalisation plan so the *same green run* survives (a) a different
person's org and (b) examples beyond triage.

The seams that would break "just works" for *those* cases are not in our code —
they are in the **shape of the connecting org**. The canonical illustration is the
`Type` incident (§3), which surfaced while exercising `update_case` *outside* the
triage happy path (dispose only ever writes `Reason`): the agent tried to set a
field that wasn't in the tool's static parameter schema, the tool silently
returned an empty string, and the model theorised about Field-Level Security. That
single field was patched by hand, but the class of problem it represents —
**per-field static enumeration versus a live, customer-specific Salesforce
schema** — is the thing this RFC is really about.

This RFC (a) catalogues every reason a *standard* org would not "just work",
(b) resolves the "should the 16 tools be dynamic?" question against how the
platform actually loads tools, and (c) proposes a concrete design: a
**comprehensive-but-safe static tool surface + passthrough writes +
describe-driven preflight + a documented reference-org baseline + graceful,
teaching error messages**.

## 2. What we are actually shipping

Two artefacts that must stay 1:1:

- **Studio project** `salesforce-test-d4d57dcb` ("Salesforce Case Triage"). Four
  agents, least-privilege by design:
  - `case-triage` — orchestrator, tool: `invoke_agent`.
  - `case-ingest` — read-only. Tools: `salesforce__get_case`,
    `salesforce__list_case_activity`, `salesforce__list_cases`. Fetches + PII-redacts.
  - `case-classify` — **no Salesforce access**. Tools: `search_knowledge`,
    `get_file`. Classifies against the checked-in `knowledge/case-triage-taxonomy.md`.
  - `case-dispose` — write. Tools: `salesforce__add_case_comment`,
    `salesforce__update_case`. Sets **only** `Case.Reason` and posts a comment.
- **GitHub repo** `veryfront/agentic-case-processing` (currently private). Mirrors
  the four agents as `agents/*.ts`, ships the taxonomy in `knowledge/`, ships
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
  `requiresWrite` gating all happen in the hosted API — there is no local code in
  `src/` that reads `transform`, interpolates `{{…}}`, or enforces `requiresWrite`
  (confirmed by grep). The SDK only *declares* these in the schema.
- Tool **discovery is dynamic per project**: `src/integrations/remote-tools.ts`
  fetches the authorised tool list per request (`POST /integrations/tools/list`,
  `remote-tools.ts:560-600`) and maps each to `{ name, description, parameters }`
  where `parameters` is a JSON Schema the **server** built from each param's
  `type`/`in`/`required`/`default` (`remote-tools.ts:782-788`).

**Takeaway:** the *set* of tools a project sees is already dynamic, but each tool
is a static `connector.json` entry. "Make the tools dynamic" is therefore not a
knob we have — the lever we do have is **what those static entries declare**, plus
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

Static tools, dynamic policy — capability and authorization are separate layers:

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
  │          describe_object  │                 delete_record is safe un-fenced:
  └──────────────────────────┘                 the matrix denies Delete by default
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

Fork → run (the blog's happy path; the one seam is the Connected App, Open Q A):

```
  fork template          sign in            connect Salesforce         run "Triage
  ─ or clone ──────────▶ Veryfront ───────▶  (OAuth)          ───────▶ latest cases" ──▶ ✅ green
  agentic-case-          set API token           ▲                     writes Reason +
  processing             npx veryfront push      │                     triage comment
                                          Connected App:
                                       shared, or BYO id/secret?
```

## 3. The `Type` incident (a worked illustration, not a triage failure)

Triage itself completes without this field. The incident surfaced while probing
`update_case` beyond the pipeline. From that conversation, the model's own words:

> "The `update_case` returned an empty string as data … a successful Salesforce
> API update normally returns the record ID or a success boolean. An empty string
> suggests the tool processed `Reason` but didn't even attempt `Type` because
> `Type` isn't in its parameter schema. … more likely, this is a Veryfront
> integration tool limitation."

Root cause: `update_case`'s `body` statically enumerated
`Status`/`Priority`/`OwnerId`/`Reason`/`SuppliedEmail`/`Description`. `Type` was
absent, so the LLM could not pass it, and the tool dropped it silently. Commit
`598a26d` added `Type` to the body. That fixes *one* field.

The lesson is the general one:

1. **Static per-field enumeration always lags the org.** Custom `__c` fields,
   record types, and standard fields we didn't list are all unreachable until
   someone edits `connector.json`.
2. **Even a listed field can fail on its value.** `Type`, `Status`, `Priority`,
   `Origin`, and `Reason` are **picklists with org-defined values**. Per the
   Object Reference these Case fields are *not* API-`Restricted picklist` by
   default (the only restricted Case picklists are `Language`/`ArticleLanguage`),
   so a vanilla org may *accept* an off-list value — but the moment an admin turns
   on "Restrict picklist to the values defined in the value set" (common), or a
   record-type/dependency scopes the values, sending `Type = "Question"` returns
   `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` ("bad value for restricted picklist
   field"), case-sensitive. Either way an off-list value is bad triage data — the
   value must come from the org, via `describe`/`get_picklist_values`.
3. **Silent empty returns read as success.** The tool should surface the write
   result (id / errors), not an empty string.

## 4. What "just works" has to survive on a standard org

This is the deep-research core. Ranked by how likely each is to break a *fresh*
fork.

### 4.1 Case.Reason picklist ↔ taxonomy mismatch — the #1 breaker for *this* pipeline

`case-dispose` is instructed to set `Case.Reason` to the taxonomy's
`reason_api_name` (`agents/case-dispose.ts`). `Reason` is a picklist whose values
are org-defined (createable + updateable, and commonly *restricted* by the admin
setting above). The shipped `knowledge/case-triage-taxonomy.md` (v5) maps
categories to specific `reason_api_name` values. **If the forker's org's `Reason`
picklist doesn't contain those values, dispose writes either fail (restricted org)
or silently create mismatched data (unrestricted org) — both break the demo.**
Salesforce's *default* Case Reason values (Installation, Equipment Complexity,
Performance, Breakdown, Equipment Design, Feedback, Other) are themselves an
oddity most orgs have already customised.

This is the sharpest edge and it is entirely ours to design around (§5, §6, §7).

### 4.2 Edition & API access — the hard gate

REST API is **not available in every edition**:

- **Free / Starter Suite** — no API access at all.
- **Pro Suite** — API allowed, but call caps well below Enterprise.
- **Professional Edition** — API not enabled by default; requires an add-on or a
  partner security-review grant.
- **Enterprise / Unlimited / Performance / Developer** — full REST API.

A "common Salesforce plan" can therefore be *physically unable* to run the
integration (calls return `API_DISABLED_FOR_ORG` / 403). The only fully
controllable golden path is a **free Developer Edition org**, which has full API.
The blog and README must name it explicitly.

### 4.3 Salesforce Knowledge — a trap the pipeline already avoids (keep it that way)

Note: `case-classify` uses **project** `search_knowledge` + `get_file` against the
checked-in taxonomy, **not** `salesforce__search_knowledge_articles`. That is a
good decision — it sidesteps the fact that Lightning Knowledge is **off by
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
field with only *Visible* (not *Edit*) FLS fails — exactly what the model
speculated about in §3. The connected user needs **Edit** FLS on `Case.Reason` and
read on every queried field.

### 4.6 Connected App / OAuth friction — the "auth with Salesforce" step

The most failure-prone step in the blog's happy path. To get
`SALESFORCE_CLIENT_ID` / `SALESFORCE_CLIENT_SECRET` the user creates a Connected
App (or the newer External Client App), which carries: a 2–10 minute activation
delay, mandatory **My Domain**, `login.salesforce.com` vs `test.salesforce.com`
for sandboxes, an exact callback-URL match, and IP/OAuth relaxation policies. See
**Open Question A** — whether Veryfront ships a *shared* Connected App decides
whether "just works" is literally true or a ten-minute detour.

### 4.7 Housekeeping: API version drift

`connector.json` pins `v61.0`; the legacy generated-project client
`files/lib/salesforce-client.ts:3` pins `v59.0`. Reconcile to one version.

## 5. Static vs dynamic tools — the design decision

Given §2.1, tools **must** be static `connector.json` entries. We get
dynamic-*enough* behaviour from three levers that need no new platform machinery:

1. **Read is already dynamic.** `find_customer`, `list_cases`, `search_contacts`,
   etc. take an arbitrary SOQL `q`; `run_soql_query` is a universal read.
   Read coverage of standard *and* custom objects is effectively total already.
2. **Passthrough writes.** The schema already supports
   `bodyMode: "passthrough"` — and `src/integrations/schema.ts` cites *"Salesforce
   sObject … writes"* as its motivating case. A passthrough `update_case` /
   `create_case` / generic `update_record` accepts an **arbitrary field map**, so
   `Type`, custom `__c` fields, and record types flow through without being
   enumerated one-by-one. This is the real fix for §3, not adding fields by hand.
   Trade-off: the LLM gets a looser JSON Schema and less inline guidance — mitigate
   with a strong tool `description` and a describe preflight.
3. **Describe-driven preflight.** Before a write, the agent learns *this org's*
   real picklist values / required fields via `describe_object`, then only sends
   valid values. This turns "guess and fail" into "look, then write." It can be a
   prompt rule in `case-dispose`, or a curated `get_picklist_values` convenience
   tool (a filtered describe).

**Recommendation: hybrid.** Keep a comprehensive, ergonomic **static core** of
curated tools (they make the demo legible and the agent fast), make every write
tool **passthrough-capable**, and lean on `describe_object` + `run_soql_query` as
the completeness escape hatch. Do **not** pursue runtime-registered/dynamic tools —
it is out of platform scope and unnecessary.

## 6. Proposed comprehensive tool surface

Reorganise the 16 into three tiers. The generic tier alone gives complete
standard+custom coverage; the curated tier exists for ergonomics and blog
readability.

**Tier 1 — Curated triage happy path (keep, ergonomic wrappers):**
`find_customer`, `list_cases`, `get_case`, `list_case_activity`,
`add_case_comment`, `update_case` (now incl. `Type`, and passthrough), plus
`search_accounts`, `get_account`, `search_contacts`, `get_contact`,
`list_opportunities`, `create_case`, `create_lead`.

**Tier 2 — Universal escape hatches (keep):** `describe_object`,
`run_soql_query`. Add **`get_picklist_values`** (describe filtered to picklist
fields) so `case-dispose` can validate `Reason` before writing.

**Tier 3 — Generic sObject CRUD (add, for completeness):**
`get_record` (sObjectType + id), `create_record` (sObjectType + passthrough body),
`update_record` (sObjectType + id + passthrough body). With Tier 2 + Tier 3 you
have ~6 tools that cover **any** standard or custom object; Tier 1 is the
readable, low-friction surface on top.

Coverage of the standard objects a "get-going" support/CRM demo needs:
Account, Contact, Lead, Case, CaseComment, Opportunity — plus User/Group (owner &
queue lookup) reachable via SOQL, and Task/Event (activities) reachable via the
generic tier. `salesforce__search_knowledge_articles` stays but is documented as
"requires Knowledge enabled" and degrades gracefully (§8).

## 7. Reference org & seed data — "just works" needs *data*

A fresh org has no cases to triage, and its `Reason` picklist won't match the
taxonomy. Ship a **reproducible baseline** so fork→run has something to act on:

- **Golden path: a documented Developer Edition setup** (free, full API), plus
- **A seed artefact** — an SFDX scratch-org definition **or** an unmanaged
  package **or** a first-run seed step — that: creates a handful of Accounts /
  Contacts / Cases with known subjects; and **installs a Case `Reason` picklist
  that matches `case-triage-taxonomy.md` v5** (or, inversely, ship the taxonomy
  aligned to Salesforce's default Reason set). The taxonomy and the org's picklist
  must be authored together, not independently.
- The evals (`evals/mock-tools.ts`) already let CI pass without a real org; the
  seed closes the gap between "evals green" and "real org green."

## 8. Graceful degradation — make errors teach, not stall

Every known failure should return an actionable message instead of a raw
4xx/empty string. Some of this is the hosted API's job (it owns execution); some
is promptable in the agents.

| Condition | Today | Proposed |
| --- | --- | --- |
| Write result | empty string (looked like failure in §3) | return `{ id, success, errors }` |
| API disabled for edition | raw 403 | "This Salesforce edition has no API access. Use a free Developer Edition org: <link>." |
| Restricted picklist bad value | raw `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` | catch → describe → retry with a valid value, or report the allowed set |
| Knowledge not enabled | raw `INVALID_TYPE` | `search_knowledge_articles` returns `[]` + a one-line hint |
| FLS Edit missing on Reason | silent drop / raw error | name the exact profile toggle |

## 9. The fork → run flow the blog narrates

1. Fork the template in Veryfront **or** clone `veryfront/agentic-case-processing`
   (`cp .env.example .env.local`, set `VERYFRONT_API_TOKEN`, `npx veryfront push`,
   `npm run dev`).
2. Sign in to Veryfront.
3. Integrations panel shows **Salesforce → Connect** (per the screenshot). OAuth.
   → **Front-load the Connected App caveats, or ship a shared app (Open Question A).**
4. Run **"Triage latest open cases."**
5. Pipeline runs green against seeded data; a `Reason` + triage comment land on
   the case.

The single biggest seam is step 3: BYO Connected App turns a one-click promise
into a ten-minute Salesforce-admin detour.

## 10. Non-goals

- Managed-package install into arbitrary customer production orgs.
- Person Accounts and non-English / localised picklist labels (v1).
- Runtime-registered or self-describing dynamic tools (out of platform scope, §2.1).
- Replacing the curated tools wholesale with generic CRUD (we keep both).

## 11. Alternatives considered

- **(a) Keep enumerating every field statically.** Rejected — §3 proves it does
  not scale past the first custom field.
- **(b) Full dynamic MCP-from-`describe`.** Rejected — no platform mechanism
  (§2.1), and describe-as-preflight gets the same safety with far less machinery.
- **(c) Point every demo at a Veryfront-owned seeded org.** Rejected as the
  primary path (it breaks the "your own Salesforce" story), but worth keeping as a
  **"try it without connecting"** fallback mode.

## 12. Risks

- Passthrough writes reduce inline schema guidance → the model may send bad
  fields. Mitigated by describe preflight + a strong tool description.
- A shared Connected App concentrates OAuth-client trust in Veryfront and pulls in
  Salesforce app-review and org-wide rate limits.
- "Just works" is inherently org-dependent (edition, picklists, FLS, validation
  rules). The Developer-Edition golden path is the only fully controllable target;
  the blog should say so plainly rather than over-promise on arbitrary orgs.

## 13. Open questions

- **A. Shared vs BYO Connected App.** Does Veryfront ship a shared Salesforce
  Connected App (making step 3 one-click), or must the forker supply
  `CLIENT_ID`/`SECRET`? This decides whether the blog promise is literally true.
- **B. Seed mechanism.** SFDX scratch org, unmanaged package, or a first-run agent
  step — and who owns keeping the taxonomy and the `Reason` picklist in lockstep?
- **C. Knowledge dependency.** Keep `case-classify` on the project-local taxonomy
  (current, robust), or offer an optional Salesforce-Knowledge variant behind a
  "Knowledge enabled" check?
- **D. API version.** Reconcile `v61.0` (connector) vs `v59.0` (legacy client).
- **E. Repo parity.** Make `veryfront/agentic-case-processing` public and enforce
  1:1 parity with the studio project (a drift check in CI?).

## 14. Appendix A — Baseline standard-object & field coverage

The point of a baseline is to let *many* example agents (not just triage) run
against a vanilla org with **no custom fields and no schema edits**. The way to
guarantee that is to constrain every default SOQL query and every write tool to
**standard fields on standard objects** — those cannot be deleted, so they exist
on every org — while treating picklist *values* and FLS as run-time unknowns.

> Field flags below are verified against the Salesforce **Object Reference** PDF
> (§Sources). Note the API's `Restricted picklist` flag is *narrow*: on Case, only
> `Language`/`ArticleLanguage` carry it — `Status`/`Priority`/`Origin`/`Reason`/
> `Type` do **not** by default. But orgs routinely enable "restrict to defined
> values," and off-list values are bad data regardless — so treat every picklist
> as describe-first. The authoritative per-field `createable`/`updateable`/
> `required`/restricted flags should come from `describe()` at run time (the #6364
> matrix already surfaces `queryable`/`createable`/`updateable`/`deletable`), not
> from a hard-coded list.

### A.1 The three baseline rules

1. **Read only standard fields.** A standard field always *exists*, so a `SELECT`
   never throws `No such column` for schema reasons. (It can still be hidden by
   FLS for a weak profile — rule 3.)
2. **Never blind-write a picklist value.** `Status`, `Priority`, `Origin`,
   `Reason`, `Type` (Case), `Status` (Lead), `StageName` (Opp), `Rating`,
   `Industry`, etc. carry **org-specific values** — not API-restricted by default,
   but frequently restricted by admins and always meaningful. Either omit them, or
   `describe`/`get_picklist_values` first and send a value the org actually has.
   Safe blind-write targets are **text, textarea, number, date, checkbox, and
   lookup-Id** fields.
3. **Assume nothing about FLS or edition.** A standard field can be invisible to
   the connected profile; a whole object (`Case`, `Opportunity`, `Lead`) can be
   absent below the required edition/cloud. Degrade with a clear message (§8), do
   not stall.

### A.2 Baseline objects (the "get-going" set)

| Object | Cloud / edition needs | Required on create | Safe blind-write fields (non-picklist) | Picklists — validate via describe |
| --- | --- | --- | --- | --- |
| **Account** | any | `Name` | `Name`, `Phone`, `Website`, `Billing*`, `Shipping*`, `NumberOfEmployees`, `AnnualRevenue`, `Description`, `AccountNumber` | `Type`, `Industry`, `Rating`, `Ownership` |
| **Contact** | any | `LastName` | `FirstName`, `LastName`, `Email`, `Phone`, `MobilePhone`, `Title`, `Department`, `AccountId`, `Mailing*`, `Description` | `LeadSource`, `Salutation` |
| **Lead** | Sales | `LastName`, `Company` ¹ | `FirstName`, `LastName`, `Company`, `Email`, `Phone`, `Title`, `Website`, `Street/City/State/PostalCode/Country`, `NumberOfEmployees`, `Description` | `Status`, `LeadSource`, `Industry`, `Rating` |
| **Case** | Service | *(none system-required)* | `Subject`, `Description`, `SuppliedName/Email/Phone/Company`, `ContactId`, `AccountId`, `ParentId` | `Status`, `Priority`, `Origin`, `Reason`, `Type` |
| **CaseComment** | Service | `ParentId` (CommentBody effectively required) | `CommentBody` (createable **and** updateable), `IsPublished` (bool) | — |
| **Opportunity** | Sales | `Name`, `StageName`, `CloseDate` | `Name`, `Amount`, `CloseDate`, `AccountId`, `Description`, `NextStep`, `Probability` | `StageName`, `Type`, `LeadSource` (`ForecastCategory` is **read-only**, derived from `StageName`) |
| **Task** (activity) | any | *(none — `Status`/`Priority` defaulted)* | `Subject`, `ActivityDate`, `WhoId`, `WhatId`, `Description`, `OwnerId` | `Status`, `Priority`, `TaskSubtype` (restricted) |
| **Event** (activity) | any | conditional: `DurationInMinutes`+`ActivityDateTime` **or** `StartDateTime`+`EndDateTime` ² | `Subject`, `WhoId`, `WhatId`, `Location`, `Description`, `OwnerId` | `ShowAs`, `EventSubtype` |
| **User** | any (read-only for lookups) | — | *(don't create)* | — |
| **Group** (queues) | any (read-only for lookups) | — | *(don't create)* | — |

¹ `Lead.Company` is marked `Nillable` in metadata but the Object Reference labels
it *Required*; a null `Company` with a person-account record type converts the lead
to a Person Account (out of baseline, §A.5). Treat it as required.
² `Event`'s duration/time fields are `Nillable` in metadata; the requirement is
conditional (duration+start **or** start+end), enforced by the app, not a hard
API flag — so supply a valid pair rather than assuming one field is required.

### A.3 Standard read-field sets (safe default `SELECT`s)

Curated tools should default to these standard-only field lists (extend via the
tool's `q`/`fields` argument, never bake in a `__c`):

- **Account** — `Id, Name, Type, Industry, Phone, Website, BillingCity, BillingState, BillingCountry, OwnerId, CreatedDate, LastModifiedDate`
- **Contact** — `Id, FirstName, LastName, Email, Phone, Title, AccountId, Account.Name, OwnerId, CreatedDate, LastModifiedDate`
- **Lead** — `Id, FirstName, LastName, Company, Email, Phone, Status, LeadSource, IsConverted, OwnerId, CreatedDate`
- **Case** — `Id, CaseNumber, Subject, Status, Priority, Origin, Reason, Type, ContactId, AccountId, OwnerId, IsClosed, ClosedDate, CreatedDate, LastModifiedDate`
- **CaseComment** — `Id, ParentId, CommentBody, IsPublished, CreatedById, CreatedDate` *(never select `Body`)*
- **Opportunity** — `Id, Name, StageName, Amount, CloseDate, Probability, Type, AccountId, IsClosed, IsWon, OwnerId, CreatedDate`
- **User** — `Id, Name, Email, Username, IsActive`
- **Group** — `Id, Name, Type` *(filter `Type = 'Queue'` for case ownership)*

### A.4 Object → owner/queue lookups

Owner assignment (`OwnerId` on Case/Lead/Opportunity) needs a real `User.Id` or
`Group.Id`, not a name. The baseline should ship the two lookup queries
(`SELECT Id, Name FROM User WHERE IsActive = true` and
`SELECT Id, Name FROM Group WHERE Type = 'Queue'`) so any assignment example
works without the model guessing Ids.

### A.5 What "standard" deliberately excludes (v1)

Person Accounts (Contact fields move onto Account), record-type-scoped picklists,
multi-currency (`CurrencyIsoCode`), localised picklist labels, and Knowledge
(`KnowledgeArticleVersion`). Examples that need these are out of the baseline and
should be labelled as requiring org setup.

## 15. Customization path — the baseline is a floor, not a ceiling

The baseline exists so the fork runs green on day one; **customization is how the
user makes it theirs**. The design must make that a config edit, not a fork of our
code. Four extension points, in the order a user hits them:

1. **Extend field coverage without touching tool code.** Curated read tools take a
   SOQL `q` (and the generic tier takes a `fields` list), so adding a custom column
   is `SELECT …, Priority_Score__c FROM Case`. The passthrough write tools (§5)
   accept any field key, so writing `Region__c` or a custom `Type` value needs no
   new tool — this is the whole reason to prefer passthrough over per-field
   enumeration.
2. **Map the taxonomy to their picklists.** The one file a forker almost always
   edits is `knowledge/case-triage-taxonomy.md`: point each category's
   `reason_api_name` at *their* `Case.Reason` values (and add categories). Because
   `case-classify` reads the taxonomy at run time via `get_file`, editing the file
   *is* the customization — no redeploy of agent logic.
3. **Adapt to the org automatically.** Ship a one-shot **"adapt to my org"**
   onboarding step (an agent run or a script) that calls `describe_object` on
   `Case`/`Account`/etc., writes the org's real picklist values and any custom
   fields into a project config/knowledge file, and lets the user confirm the
   taxonomy mapping. This turns §4.1 (picklist mismatch) from a silent failure into
   a guided setup — and is the mechanism that makes "customize" self-serve.
4. **Swap objects entirely.** The generic `get/create/update_record` + `run_soql`
   + `describe` tier means a user can retarget the pipeline at a *custom* object
   (e.g. `Ticket__c`) or a different standard object without waiting on us to add a
   curated tool.

Design implication: keep org-specific values (picklist mappings, field lists,
target objects) in **editable project files** (taxonomy + a small config), never
hard-coded in agents or `connector.json`. The template ships the baseline; the
user edits data files to fit their org.

## 16. Permission & dynamic-object model (prior art: `veryfront-studio` #6364)

Two capabilities this RFC leans on **already exist** and must not be reinvented —
they live studio/server-side, not in `connector.json`:

**Dynamic object discovery.** The project-level *Integrations → Salesforce →
Configure* view fetches the org's objects at runtime via `describe()`
(`listSalesforceObjects({ projectId })`, query key
`connections-panel:salesforce-objects:${projectId}:list`) and renders **every
object in the org — standard and custom** — each carrying real capability flags
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
2. **Capability (tools) and authorization (matrix) are separate layers.** A
   generic `delete_record` is safe to ship because Delete is **deny-by-default**
   per object in the matrix — the permission model fences it, not the tool.
   Likewise `run_soql_query` should respect the `allowExpertSoql` guardrail.
3. **"Tools are static" still holds** (§2.1) — but *objects* and *permissions* are
   dynamically discovered and enforced. The static generic tools are the fixed
   *execution surface*; the Configure matrix is the dynamic *policy surface* over
   whatever objects the org actually has.
4. Known gap to track: with a **project-only** connection (no personal user
   connection) object discovery returns `400 "not connected for this user"` — the
   fork→run flow must establish the right connection identity before Configure
   works.

## Appendix B — proposed generic tool spec

Modeled on the shipped ServiceNow passthrough pair
(`servicenow__create_table_record` / `update_table_record`), which is the proven
`bodyMode: "passthrough"` shape. Five tools give complete CRUD over **any** object
— standard or custom — governed by the §16 matrix.

**`bodyMode: "passthrough"` is production-proven, not speculative.** 16 passthrough
write tools ship across 9 live integrations today — ServiceNow
(`create_table_record`, `update_table_record`), QuickBooks (`create_invoice`,
`create_bill`, `create_purchase`), Xero (`create_invoice`, `create_bill`,
`create_purchase_order`), Shopware (`create_product`, `update_product`), plus
Apify/Axiom/fal/Azure-Blob/GCS. ServiceNow's `POST /table/{tableName}` with a
single `{ record: object }` body is the *same* semantic Salesforce needs
(`POST /sobjects/{sobjectType}`), so the server-side unwrap-`record`-to-raw-body
behaviour is already exercised. Residual risk: near-zero.

| Tool | Method | URL (after `{{oauth.raw.instance_url}}/services/data/v61.0`) | Body (`passthrough`) | `requiresWrite` |
| --- | --- | --- | --- | --- |
| `get_record` | GET | `/sobjects/{sobjectType}/{recordId}` (opt. `?fields=`) | — | false |
| `create_record` | POST | `/sobjects/{sobjectType}` | `{ record: object }` | true |
| `update_record` | PATCH | `/sobjects/{sobjectType}/{recordId}` | `{ record: object }` | true |
| `delete_record` | DELETE | `/sobjects/{sobjectType}/{recordId}` | — | true (Delete deny-by-default in matrix) |
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

- **`get_picklist_values`** — a thin wrapper over `describe_object` returning only
  `fields[].picklistValues` for a `sobjectType` (+ optional record type), so writes
  can validate restricted fields before sending (§4.2, §5.3).
- **`search`** (SOSL) — `GET /search/?q=FIND {…} IN ALL FIELDS …` for cross-object
  keyword lookup, distinct from the SOQL that `find_customer` uses.

Curated per-object write wrappers (`create_contact`, `update_account`,
`create_opportunity`/`update_opportunity`, `create_task`) and `convert_lead`
remain **optional ergonomics** on top of this tier — `convert_lead` is the only
one that is *not* plain passthrough (Lead conversion is a dedicated action, not an
sObject write) and needs its own endpoint.

**SOQL note for custom objects:** relationship traversal on custom lookups uses
the `__r` suffix (e.g. `SELECT Ticket__r.Owner.Name FROM Case`); the agent needs
this in the tool description or it will guess `__c`.

## Sources

Standard object & field metadata (authoritative — createable/updateable/required/restricted flags in Appendix A were verified against this):
- [Object Reference for the Salesforce Platform (PDF)](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf) — Account, Contact, Lead, Case, CaseComment, Opportunity, Task, Event field tables

Salesforce edition / API access:
- [Supported Editions & Required Permissions — REST API Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_rest_compatible_editions.htm)
- [Salesforce editions with API access (Help)](https://help.salesforce.com/s/articleView?id=000385436&language=en_US&type=1)
- [Accessing REST API in Group and Professional Editions](https://developer.salesforce.com/docs/atlas.en-us.packagingGuide.meta/packagingGuide/dev_packages_rest_api_access.htm)
- [Salesforce 2025 Free / Starter / Pro Suites — limits](https://salesforcemonday.com/2025/11/18/salesforce-2025-free-starter-pro-suites-pricing-limits/)

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
