# Templates Plan

> Concise, not bloated. Each template should feel tiny but deliver a "wow, that's all it takes?" moment.

## Design Principles

- **Minimal files, maximum impact** — show how much you get with little code
- Templates map to **what people search for**, not internal capabilities
- Every template showcases agentic AI — this is "the framework for AI apps"
- Auto-discovery does the heavy lifting — no boilerplate wiring

## User Personas

| Persona | What they want | Templates |
|---------|---------------|-----------|
| "Add AI to my SaaS" | Chat + agent + tools | chat, saas |
| "Build an AI-native product" | Agents, workflows, orchestration | multi-agent, workflow, coding-agent |
| "Automate internal workflows" | Workflows + approvals + integrations | workflow |
| "Build AI agent for customers" | Chat + memory + data access | rag, saas |

## Templates

### 1. `chat` — AI Chatbot

> "AI chatbot in 30 seconds"

One agent, one tool, one chat page. Streaming out of the box.

```
agents/assistant.ts       # 6 lines — model, system prompt, tools: true
tools/calculator.ts       # 12 lines — Zod schema + execute
app/page.tsx              # 5 lines — <Chat {...useChat()} />
app/api/chat/route.ts     # 6 lines — getAgent → stream → respond
```

**4 files. Working AI chatbot with tool calling and streaming.**

Rename of current `ai` template.

---

### 2. `rag` — Chat with Your Docs

> "Ask questions about your own data"

\#1 most-requested AI app pattern. Drop in docs, ask questions, get answers with sources.

```
agents/qa.ts              # RAG agent with retrieval tool
tools/search-docs.ts      # Vector search over ingested content
resources/documents.ts    # MCP resource for doc access
app/page.tsx              # Chat UI with source citations
app/api/chat/route.ts     # Streaming endpoint
content/example.md        # Sample doc to chat with
```

**6 files. Working RAG app with citations and MCP access.**

---

### 3. `multi-agent` — Team of AI Agents

> "Specialized agents that collaborate"

Orchestrator delegates to researcher + writer. Shows agent-as-tool composition.

```
agents/orchestrator.ts    # Coordinates via getAgentsAsTools()
agents/researcher.ts      # Searches and gathers info
agents/writer.ts          # Produces content
tools/web-search.ts       # Search tool
app/page.tsx              # Chat UI with agent cards
app/api/chat/route.ts     # Streaming endpoint
```

**6 files. Multi-agent system with live delegation UI.**

---

### 4. `workflow` — AI Pipeline with Approvals

> "Multi-step AI workflows with human-in-the-loop"

Research → generate → approve → publish. DAG with parallelism and approval gates.

```
agents/researcher.ts      # Research step
agents/writer.ts          # Content generation
workflows/pipeline.ts     # step() + parallel() + waitForApproval()
app/page.tsx              # Workflow dashboard with status + approval UI
app/api/workflows/route.ts
```

**5 files. DAG workflow with real-time progress and human approval.**

---

### 5. `coding-agent` — Your Own Cursor

> "AI coding assistant powered by Claude Code"

Coding agent with file system access. Read, write, refactor, review.

```
agents/coder.ts           # Claude Code tools (read, write, search, edit)
tools/run-tests.ts        # Execute test suite
app/page.tsx              # Chat UI for code tasks
app/api/chat/route.ts     # WebSocket streaming with pause/resume
```

**4 files. Coding assistant with real file system access.**

---

### 6. `saas` — AI SaaS Starter Kit

> "Ship an AI product with auth and agents"

Auth + per-user agent + conversation history. Production-ready.

```
agents/assistant.ts       # Per-user AI assistant
tools/search.ts           # Domain tool
app/page.tsx              # Landing page
app/login/page.tsx        # OAuth login
app/dashboard/page.tsx    # Chat UI with conversation sidebar
app/api/auth/[...]/route.ts  # OAuth flow
app/api/chat/route.ts     # Authenticated streaming
```

**7 files. Full AI SaaS with auth, memory, and conversation history.**

---

## Legacy Templates (demoted)

Available but not featured in `veryfront init`:

| Template | When to suggest |
|----------|----------------|
| `app` | User explicitly wants non-AI app |
| `blog` | User wants content site |
| `minimal` | User wants blank canvas |

## `veryfront init` Flow

```
? What are you building?

  ● AI Chatbot              Agent + chat UI + streaming
  ○ Chat with Your Docs     RAG with source citations
  ○ Multi-Agent System      Agents that delegate to each other
  ○ AI Workflow Pipeline     Steps + approvals + parallelism
  ○ Coding Agent            Claude Code-powered code assistant
  ○ AI SaaS                 Auth + chat + per-user memory
  ──────────────────────
  ○ Basic App               Dashboard with auth (no AI)
  ○ Blog                    MDX content site
  ○ Minimal                 Blank canvas
```

## Composable Features

After picking a template, users can add:

| Feature | What it adds |
|---------|-------------|
| **workflows** | `workflows/` + Redis backend + workflow hooks |
| **auth** | OAuth routes + session management |
| **redis** | Persistent memory + workflow durability |
| **mdx** | Markdown content with React components |
| **mcp** | Expose tools/prompts/resources over MCP |

## Build Priority

| Phase | Templates | Rationale |
|-------|-----------|-----------|
| **1** | `chat`, `rag` | Highest demand, fastest to build |
| **2** | `multi-agent`, `workflow` | Impressive demos, framework differentiators |
| **3** | `coding-agent`, `saas` | Most complex, needs all pieces working |

## Success Criteria

- [ ] `veryfront init → veryfront dev` works in under 2 minutes
- [ ] Visually impressive default UI (not unstyled)
- [ ] One "wow" moment per template (streaming, delegation, approval, etc.)
- [ ] File count stays minimal — the magic is in what auto-discovery handles
