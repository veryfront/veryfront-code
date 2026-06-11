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

## File layout (colocated per-agent dirs)

A directory layout is added alongside the existing flat `agents/{id}.md`:

```
agents/
  researcher/
    AGENT.md            # settings + instructions (frontmatter, same schema as {id}.md)
    SKILL.md            # this agent's own primary skill
    skills/
      cite/SKILL.md     # additional agent-scoped skills
  writer/
    AGENT.md
    SKILL.md
  lead.md               # flat form still works (no own skills)
```

- `agents/{id}/AGENT.md` — the agent definition (replaces `agents/{id}.md` for that agent).
- `agents/{id}/SKILL.md` — the agent's own primary skill (skill id = `{id}`).
- `agents/{id}/skills/<skillId>/SKILL.md` (+ `references/**`) — additional agent-scoped skills.

The flat `agents/{id}.md` form is preserved for back-compat (agent with no own skills).

## Frontmatter additions (`AGENT.md` / `{id}.md`)

```yaml
---
name: Researcher
model: anthropic/claude-3-5-sonnet
temperature: 0.2
skills: true # true = all colocated skills; or a list: [cite, search]
delegates: [writer] # opt-in orchestration; omit/empty = independent agent
---
Instructions…
```

- `skills`: `true | string[]`. Default when colocated skills exist: `true`. Selects which
  of the agent's own skills are exposed in its available-skills block + `load_skill` tool.
- `delegates`: `string[]`. When non-empty, the agent gets a `delegate_to_agent` tool that
  invokes the named specialist agents (each with their own settings + skills). When empty
  or absent, **no orchestration** — the agent runs standalone.

## Implementation slices

1. **Schema + parser** (`agent-definition.ts`): add optional `skills` and `delegates` to
   `getRuntimeAgentMarkdownDefinitionSchema` and parse them from frontmatter.
2. **Directory discovery** (`agent-definition-files.ts`, `runtime-agent-markdown-handler.ts`):
   resolve `agents/{id}/AGENT.md` in addition to `agents/{id}.md`; record the agent's root dir.
3. **Per-agent skill catalog** (`agent-scoped-skill-catalog.ts`): load `{dir}/SKILL.md` and
   `{dir}/skills/**` into `RuntimeSkillDefinition[]`, filtered by the `skills` selector.
4. **Wire into the runtime agent** (`agent-markdown-adapter.ts`): pass `skills`/scoped catalog
   and `delegates` through to the `AgentConfig`.
5. **Delegate tool** (`delegate-to-agent-tool.ts`): opt-in tool, gated on `delegates`, that
   runs a named specialist agent and returns its result. No-op when `delegates` is empty.

## Back-compat / "without orchestration"

- Apps with a single flat `agents/{id}.md` and global `skills/` behave exactly as today.
- An app with several `agents/{id}/` dirs and no `delegates` runs N independent specialists,
  each scoped to its own SKILL.md — selected by `agentId` at invocation. That is the
  "no orchestration" mode. Adding `delegates` to one agent turns it into a coordinator.
