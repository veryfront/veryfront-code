# RFC 0002: Structured, minimal agent runtime context + caching

- **Status:** Draft (RFC for comment)
- **Owner:** @mattboon
- **Repo slice:** `veryfront-code` (the `veryfront/agent` framework runtime)
- **Companion RFCs:**
  - `veryfront-agent` — `docs/rfc-structured-minimal-agent-context.md` (branch `rfc/agent-context-and-prompt-slim`)
  - `veryfront-studio` — `docs/improvements/environment-context-structuring.md` (branch `rfc/structured-minimal-env-context`)
- **Related issues:** veryfront-agent #336 (slim prompt), #357 (suggestions), #5 (load_skill text)

---

## 1. Problem

A trivial turn to the platform agent (`hi`, `asdfasfd`) costs ~7,285 input
tokens at ~$0.94. The runtime assembly and caching policy live here, in
`src/agent/`. Three framework-level issues:

1. **The product agent's static prompt + tool schemas are re-billed at full
   price on sparsely-spaced turns.** `createRuntimeAgentSystemMessages`
   (`src/agent/runtime/agent-definition.ts:255`) already does the right thing —
   system message #1 (prompt + project block + skills) carries
   `cacheControl: { type: "ephemeral" }`, and the volatile `environment_context`
   is a *second, uncached* system message after it. But ephemeral cache is
   ~5-minute TTL; two test turns 38 minutes apart are both cache **misses** →
   full price every time. This is the dominant cost, and it is a TTL choice.

2. **`load_skill` leaks orchestration policy into its result/description** —
   "Keep the root assistant visibly owning the work…" — issue #5. This is
   framework-owned text (not in the agent repo), and the agent-prompt test
   asserts its presence, so it must be coordinated here.

3. **No structured contract for host-supplied context.** `environmentContext`
   is accepted as an opaque string (`agent-definition.ts` wraps it in an
   `environment_context` block verbatim). To let Studio send structured,
   minimal fields (companion RFC), the framework needs to accept and render a
   typed shape at the marker.

## 2. Corrected premise (important)

An earlier framing blamed a **millisecond timestamp busting the cache**. That is
**wrong for this architecture**: the timestamp rides in system message #2, which
is emitted *after* the cache breakpoint on message #1. Per Anthropic's caching
model (`tools → system → messages`, prefix-match), volatile content after the
last breakpoint invalidates nothing. Tools are also cached transitively (the
breakpoint on message #1 covers the tools that precede it in the request).

So the levers are **cache TTL** and **uncached-tail size**, not timestamp
placement. Do not defer `form_input`'s schema for cost reasons — it is already
inside the cached prefix.

## 3. Goals / non-goals

**Goals**
- Cut per-turn cost for the product agent via **cache TTL** + optional
  pre-warming.
- Accept **structured runtime context** and render one canonical block at the
  `<!-- veryfront-runtime-context -->` marker — uniformly for **all** project
  agents.
- Move #5's orchestration policy out of the `load_skill` result into the trusted
  runtime layer.

**Non-goals**
- The agent's own prompt slim (veryfront-agent).
- Studio's structured-emit + prose removal (veryfront-studio).

> **Constraint — project identity is load-bearing.** The framework already
> injects a project block (`cloud-runtime-system-messages.ts:38`,
> "Do NOT guess or invent project references"). *Every* project agent (not just
> the platform agent) needs `project_reference`/`branch_id` to call
> project-scoped tools, which fail without them. Structured injection must keep
> this guarantee — it is the reliable delivery path Studio depends on.

## 4. Design (veryfront-code slice)

### 4.1 Cache TTL for the product agent
Move system message #1's breakpoint to the **1-hour cache**
(`cacheControl: { type: "ephemeral", ttl: "1h" }`) for the product agent, so
turns minutes-to-tens-of-minutes apart still read cache. Anthropic's guidance:
1-hour TTL is for "bursty traffic with long idle gaps" — exactly the chat agent.
Economics: 1h write is 2× vs 1.25× for 5-min, breaking even at ~3 reads; worth
it when idle gaps routinely exceed 5 minutes.

Optionally add **pre-warming** (`max_tokens: 0` prefill on the cached prefix) at
session start for interactive latency.

### 4.2 Structured runtime-context render
Extend the marker-injection path (`createRuntimeAgentSystemMessages` /
`cloud-runtime-system-messages.ts`) to accept a typed `StudioContext`
(date, timezone, project{reference,branch}, panels, selection?, preview?,
homepage?) in addition to the legacy `environmentContext` string. Render it into
one canonical block after the marker. **Coarsen the date** to day/minute; no new
date tool — `bash` already covers exact time on demand.

Compat: accept **both** the legacy string and the structured field for one
release so Studio can migrate without agents losing context mid-deploy.

### 4.3 #5 — load_skill orchestration text
Remove "Keep the root assistant visibly owning the work…" and delegation policy
from the `load_skill` **result/description**. Keep that policy in the trusted
runtime/system layer (it is stable orchestration policy, not per-call skill
output). Document every field the `load_skill` result returns and its consumer.
Coordinate with the agent-prompt test that currently asserts the string.

### 4.4 tool_search → studio_suggestions — CONFIRMED WORKING (no framework change required)
The deferred-schema resolver **does** index Studio callback tools. Confirmed in
production (run `run_856ec7d6-5f3c-4d14-ba86-10230830e635`, opus-4-6): the agent
called `tool_search({query:"studio_suggestions"})` → `miss:false`, one match,
`status:"loaded"`, then called `studio_suggestions` with the correct
`{title,prompt,description}` schema and the chips rendered in Studio. So the
veryfront-agent #357 fix is **purely behavioral** (prompt rule: `tool_search`
then call, never markup) — the path is live, not a dead end.

The same run confirms #357's root cause: the bug reproduced only because the
model skipped `tool_search` and invented a wrong markup shape; with the schema
loaded via `tool_search`, it used the correct input shape.

**Optional hardening (not required):** promote `studio_suggestions` from
`VERYFRONT_STUDIO_PRODUCT_TOOLS` into the always-on bootstrap set so its schema
is in-context every turn and the model can call it with no `tool_search` hop.
Costs one always-on schema; removes any chance of markup invention. Belt-and-
suspenders on top of the prompt rule, not a dependency.

### 4.5 tool_search also emits an opaque `nextStep` (same family as #5)
`tool_search` results carry a `nextStep` string ("Continue to the next model
step. Loaded tool schemas will be available then."). Like `load_skill`'s
`nextStep` (#5), this is orchestration prose in a tool result. Fold it into the
#5 cleanup: document the field or move the signal to the trusted layer.

## 5. Plan
1. 1-hour cache TTL for the product agent (small, high-value, independent).
2. Structured-context accept + render at the marker (behind the compat window).
3. ~~Verify `tool_search` surfacing of Studio callback tools~~ — DONE, confirmed working (§4.4). Optional: bootstrap `studio_suggestions` as hardening.
4. #5: strip orchestration policy from `load_skill` result; document the schema;
   coordinate the agent-prompt test change.

## 6. Risks
- **Cache TTL** changes cost profile (2× write); validate on real traffic that
  read-hits recover it. Guard behind the product-agent path, not all agents.
- **Structured render** must not drop project identity — regression-test that
  project-scoped tools resolve for platform *and* user-built project agents.
- **#5** touches text an agent-repo test asserts; land the two together.

## 7. Expected impact
- Sparsely-spaced product-agent turns read cache instead of paying full Opus
  input price — the direct fix for the "$0.94 hi".
- Uncached tail shrinks once Studio sends structured minimal fields.
