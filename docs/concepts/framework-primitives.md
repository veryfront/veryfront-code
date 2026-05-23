---
title: "Framework primitives"
description: "How Veryfront Code agents, tools, workflows, tasks, jobs, integrations, MCP, sandbox, and extensions fit together."
order: 2
---

Veryfront Code exposes several primitives because different kinds of work have
different owners. The important questions are who starts the work, how long it
lives, whether it streams to a user, and how it is observed.

## Concept map

| Primitive   | What it owns                                                   | Typical companion                      |
| ----------- | -------------------------------------------------------------- | -------------------------------------- |
| Agent       | Model reasoning, messages, tools, memory, and streamed output. | Tools, memory, chat UI                 |
| Tool        | One callable capability with typed input and output.           | Agent or MCP server                    |
| Workflow    | Ordered, branching, or parallel steps with durable progress.   | Agents, tools, approval steps          |
| Task        | A developer-defined background work target.                    | Job or cron job                        |
| Job         | Durable execution of a target on the platform.                 | Task, workflow, cron job               |
| Cron job    | Schedule definition that creates job runs.                     | Job                                    |
| Integration | Connector metadata, OAuth, token handling, and remote tools.   | Agent tools                            |
| MCP server  | Protocol surface for exposing tools, prompts, and resources.   | Tools, prompts, resources              |
| Sandbox     | Isolated command and file execution.                           | Agent, workflow, or tool               |
| Extension   | Reusable runtime capability packaged behind contracts.         | Provider, cache, auth, schema, bundler |

## Ownership boundaries

Agents own reasoning and conversation state. Tools own deterministic operations.
Workflows own multi-step coordination. Tasks define background work, while jobs
run that work durably. Integrations own external service metadata and
authorization, not local business logic.

Keeping these boundaries explicit makes projects easier to review. A feature can
combine primitives, but one primitive should still own the triggering event and
the primary lifecycle.

For example, an API route can receive a webhook, a workflow can coordinate the
multi-step response, a task can run slow background work, and an agent can reason
about a user-facing decision. Each part remains understandable because the
lifecycle owner stays clear.
