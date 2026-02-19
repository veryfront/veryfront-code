# Launch Plan: Veryfront Code

> CLI + full-stack React framework for agentic AI applications

## Current State

- **npm package**: `veryfront` (v0.1.7-rc.57, MIT)
- **CLI binary**: `veryfront` (init, dev, build, deploy, start)
- **Tagline**: "The simplest way to build AI-powered apps"
- **Domain**: veryfront.com (docs at `/code/guides/`)
- **GitHub**: github.com/veryfront/veryfront
- **Templates**: minimal, app, blog, ai
- **Composable features**: ai, workflows
- **20+ export paths**: routing, agents, tools, workflows, chat, MCP, OAuth, middleware, providers, prompts, resources
- **19 guide docs**: from quickstart through deployment
- **Deploy target**: Veryfront Cloud (`<slug>.production.veryfront.com`)

---

## Positioning

**"The full-stack React framework for AI applications"**

### Why this lane is open

| Competitor | What they are | Gap |
|-----------|--------------|-----|
| Vercel AI SDK | Library, not a framework — you wire up Next.js yourself | No conventions, no auto-discovery, no deploy |
| Mastra | Agent framework | No pages/routing/SSR story |
| LangChain JS | Toolkit | Not opinionated, no structure |
| CrewAI | Multi-agent framework | Python only |

### Unfair advantages

1. **Auto-discovery** — `agents/`, `tools/`, `workflows/`, `prompts/` directories just work. No registration boilerplate.
2. **Full-stack** — Routing + SSR + RSC + data fetching + AI in one framework. Competitors make you glue two things together.
3. **MCP built-in** — Any Veryfront app can be exposed as an MCP server. Forward-looking and unique.
4. **`workflow/claude-code`** — Deep Claude Code integration for Anthropic-heavy teams.
5. **One-command deploy** — `veryfront deploy` to managed cloud removes friction.

### What to de-emphasize at launch

- Don't lead with OAuth, middleware, MDX — table stakes, not differentiators.
- Don't lead with "React framework" — lead with "AI framework that happens to use React."
- Don't compete with Next.js for generic web apps — own the "AI app" niche.

---

## Launch Checklist

### Must-have before public launch

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | `npx veryfront init` works on Node 18+ | TODO | Most devs won't `npm i -g` first — npx is the entry point |
| 2 | `veryfront init` → `veryfront dev` → working AI chat app | TODO | End-to-end flow must be flawless |
| 3 | GitHub repo public at `veryfront/veryfront` | TODO | README is the landing page for devs |
| 4 | Landing page at `veryfront.com/code` | TODO | Hero: terminal demo of `npx veryfront init` |
| 5 | Version 0.1.0 stable (drop `-rc`) | TODO | Signals intentionality even if early |
| 6 | All 4 templates working end-to-end | TODO | Especially `ai` template — that's the hook |

### High-impact deliverables

#### 1. README.md

Structure:
- 3-line "what is this"
- Quick start: `npx veryfront init my-app` → `cd my-app` → `veryfront dev`
- Feature grid (6 items): Agents, Tools, Workflows, Chat UI, MCP, Deploy
- Code snippet showing the AI template (agent + tool + chat route)
- Links to docs

#### 2. Hero example

A working AI app that goes beyond "calculator" — something like a **research assistant** with:
- Agent with system prompt
- Web search tool
- Streaming chat UI
- Conversation memory

This becomes the `ai` template default AND the landing page demo.

#### 3. "Why Veryfront" comparison page

Direct, honest comparison table:

| Feature | Veryfront | AI SDK + Next.js | Mastra | LangChain JS |
|---------|-----------|-----------------|--------|-------------|
| Auto-discovery (`agents/`, `tools/`) | Yes | No | No | No |
| File-based routing | Yes | Yes (Next.js) | No | No |
| SSR / RSC | Yes | Yes (Next.js) | No | No |
| Multi-agent composition | Yes | Manual | Yes | Yes |
| DAG workflows | Yes | No | Yes | Yes (LangGraph) |
| MCP server | Yes | No | No | No |
| Chat UI components | Yes | Yes | No | No |
| OAuth (37 providers) | Yes | Manual | No | No |
| One-command deploy | Yes | Vercel | No | No |
| Managed cloud | Yes | Vercel | No | No |

---

## Launch Channels

### Tier 1 (launch day)

1. **Hacker News — Show HN**
   - Title: `Show HN: Veryfront – full-stack React framework for AI apps`
   - Link to GitHub README
   - HN loves opinionated frameworks with clean APIs

2. **Twitter/X thread**
   - 60-second video: `veryfront init` → working AI chat app
   - Show the file structure, auto-discovery, streaming
   - Tag AI dev tooling people

### Tier 2 (launch week)

3. **Reddit**
   - `r/reactjs` — angle: RSC/SSR + AI primitives built-in
   - `r/typescript` — angle: Zod-validated tools, type-safe agents
   - `r/LocalLLaMA` — angle: provider abstraction (swap models with one line)

4. **Dev.to / blog post**
   - Tutorial: "Building an AI agent app in 5 minutes with Veryfront"
   - Step-by-step with screenshots

### Tier 3 (post-launch)

5. **YouTube** — longer walkthrough video (10-15 min)
6. **Conference lightning talks** — AI/React meetups
7. **Discord / community** — for early adopters

---

## Naming

| Context | Name |
|---------|------|
| npm package | `veryfront` (keep as-is) |
| CLI command | `veryfront` (keep short) |
| Product / marketing | **Veryfront Code** |
| Docs URL | `veryfront.com/code` |
| Cloud platform | Veryfront Cloud |

---

## Tagline Options

Current: *"The simplest way to build AI-powered apps"*

Alternatives to consider:
- **"Build AI apps, not infrastructure"** — emphasizes convention-over-config
- **"The full-stack framework for agentic AI"** — clearer positioning
- **"Agents, tools, workflows. One framework."** — concrete, scannable
- **"From agent to production in minutes"** — speed + completeness

---

## Success Metrics (first 30 days)

| Metric | Target |
|--------|--------|
| GitHub stars | 500+ |
| npm weekly downloads | 200+ |
| `veryfront init` completions (telemetry) | 100+ |
| Discord / community members | 50+ |
| Show HN points | 100+ |
| External blog posts / tweets about Veryfront | 5+ |

---

## Open Questions

- [ ] Should we support `bunx veryfront init` and `pnpm dlx veryfront init` from day one?
- [ ] Is the `ai` template hero example compelling enough, or should we build a more impressive demo?
- [ ] Pricing model for Veryfront Cloud — free tier? Per-project?
- [ ] Do we need a Discord or is GitHub Discussions enough initially?
- [ ] Should we seek early adopters / beta testers before the public Show HN?
