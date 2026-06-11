# Multi-agent apps with per-agent skills and optional orchestration

## Problem

veryfront discovers multiple markdown agents from `agents/` today, but:

- A markdown agent **cannot declare its own skills** — `RuntimeAgentMarkdownDefinition`
  has no `skills` field, so every agent shares the single global skill catalog.
- There is **no per-agent `SKILL.md` namespacing** — the available-skills prompt block
  is built from the whole project catalog regardless of which agent is running.
- **Orchestration is hosted-only** (`invoke_agent`). There is no opt-in path that lets
  one app run either as independent specialists _or_ as a coordinator that delegates.

## Goal

Support an app with **one or many specialized agents**. Each agent has:

- its **own settings** (already: model/temperature/maxSteps/thinking/providerTools), and
- its **own `SKILL.md`** (new: colocated, agent-scoped skills), and
- **optional orchestration** — an agent may delegate to named specialists, or run alone.

## Capability ownership model

An agent owns its **capability surface** — instructions + skills (knowledge) +
tools (actions). Those are colocated under the agent. **Workflows** orchestrate
agents and live a layer above them, so they stay global (`workflows/`); the
agent-level orchestration primitive is `delegates:`. `prompts/`, `resources/`,
and `tasks/` also remain global until there is a concrete per-agent need.

## File layout (colocated per-agent dirs)

A directory layout is added alongside the existing flat `agents/{id}.md`:

```
agents/
  researcher/
    AGENT.md            # settings + instructions (frontmatter, same schema as {id}.md)
    SKILL.md            # this agent's own primary skill
    skills/
      cite/SKILL.md     # additional agent-scoped skills
    tools/              # this agent's own tools (.ts)
      fetch-paper.ts
  writer/
    AGENT.md
    SKILL.md
    tools/format.ts
  lead.md               # flat form still works (no own skills/tools)
```

- `agents/{id}/AGENT.md` — the agent definition (replaces `agents/{id}.md` for that agent).
- `agents/{id}/SKILL.md` — the agent's own primary skill (skill id = `{id}`).
- `agents/{id}/skills/<skillId>/SKILL.md` (+ `references/**`) — additional agent-scoped skills.
- `agents/{id}/tools/*.ts` — the agent's own tools, namespaced `{id}__{name}`.

The flat `agents/{id}.md` form is preserved for back-compat (agent with no own skills/tools).

## Frontmatter additions (`AGENT.md` / `{id}.md`)

```yaml
---
name: Researcher
model: anthropic/claude-3-5-sonnet
temperature: 0.2
skills: true # true = all colocated skills; or a list: [cite, search]
tools: [fetch-paper] # true = all colocated tools; or a list of short names
delegates: [writer] # opt-in orchestration; omit/empty = independent agent
---
Instructions…
```

- `skills`: `true | string[]`. Selects which of the agent's own skills are exposed in its
  available-skills block + `load_skill` tool. Own `SKILL.md` is referenced by the agent id.
- `tools`: `true | string[]`. Selects which of the agent's own `tools/*.ts` are bound. Short
  names in the selector; the agent sees them as `{id}__{name}` (provider-safe namespacing).
- `delegates`: `string[]`. When non-empty, the agent gets `agent_{id}` tools that invoke the
  named specialist agents (each with their own settings + skills + tools). When empty/absent,
  **no orchestration** — the agent runs standalone.

## Namespacing (why)

Tools and skills register in **global** registries. Two agents both shipping `tools/fetch.ts`
or `skills/cite/` would otherwise collide (last write wins). So colocated capabilities are
namespaced per agent: `{sanitizedAgentId}__{name}` (own skill keeps the bare agent id).
`skills: true` for a colocated agent resolves to its explicit own-skill id **list**, never the
registry-wide `true`, so one agent never sees another's skills.

## Implementation slices (all landed)

1. **Schema + parser** (`agent-definition.ts`): `skills`, `tools`, `delegates` frontmatter.
2. **Directory discovery** (`runtime-agent-markdown-handler.ts`, `file-discovery.ts`):
   `agents/{id}/AGENT.md` + flat `agents/{id}.md`; records the agent's root dir.
3. **Colocated capabilities** (`agent-scoped-capabilities.ts`): load `tools/*.ts` as a
   namespaced Tool record; register `SKILL.md` / `skills/**` as `Skill` objects.
4. **Per-agent skill catalog** (`agent-scoped-skill-catalog.ts`): `RuntimeSkillDefinition[]`
   loader for the hosted runtime path.
5. **Wire into the runtime agent** (`agent-markdown-adapter.ts`): resolved skill ids →
   `config.skills`; colocated + delegate tools → `config.tools`.
6. **Delegation** (`agent-delegation.ts`): opt-in `agent_{id}` tools gated on `delegates`.

## Back-compat / "without orchestration"

- Apps with a single flat `agents/{id}.md` and global `skills/` behave exactly as today.
- An app with several `agents/{id}/` dirs and no `delegates` runs N independent specialists,
  each scoped to its own SKILL.md — selected by `agentId` at invocation. That is the
  "no orchestration" mode. Adding `delegates` to one agent turns it into a coordinator.
