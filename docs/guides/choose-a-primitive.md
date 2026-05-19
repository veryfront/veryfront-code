---
title: "Choose a primitive"
description: "Pick the right Veryfront primitive before you write code."
order: 34
---

# Choose a primitive

Pick the smallest Veryfront primitive that matches the job. This keeps project
structure clear and avoids turning agents, workflows, jobs, and integrations
into overlapping abstractions.

## Quick choice

| If you need to...                                           | Use                    | Start with                        |
| ----------------------------------------------------------- | ---------------------- | --------------------------------- |
| Answer users with model reasoning, tools, memory, or skills | Agent                  | [Agents](./agents.md)             |
| Give an agent one typed capability                          | Tool                   | [Tools](./tools.md)               |
| Coordinate multiple steps, branches, approvals, or retries  | Workflow               | [Workflows](./workflows.md)       |
| Run durable background work now or on a schedule            | Job or cron job        | [Jobs](./jobs.md)                 |
| Define project-owned background work                        | Task                   | [Tasks](./tasks.md)               |
| Connect agents to third-party services                      | Integration with OAuth | [Integrations](./integrations.md) |
| Expose project capabilities to assistants over a protocol   | MCP server             | [MCP server](./mcp-server.md)     |
| Run isolated commands or file operations                    | Sandbox                | [Sandbox](./sandbox.md)           |
| Add reusable runtime capabilities                           | Extension              | [Extensions](./extensions.md)     |

## Decision rules

| Primitive   | Use this when                                                                 | Do not use this when                                                          |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Agent       | The model must decide, explain, call tools, use memory, or stream a response. | The work is deterministic and can be a function, task, or workflow step.      |
| Tool        | An agent needs a typed operation such as search, lookup, write, or transform. | The operation has multiple long-running states or human approval steps.       |
| Workflow    | Work has ordered steps, parallel branches, retries, or human review.          | A single agent response or one background function is enough.                 |
| Task        | You own a reusable background function in `tasks/`.                           | The user needs conversational reasoning or streaming output.                  |
| Job         | You need durable execution, scheduling, batch status, or run history.         | The work can finish inside a request without durability.                      |
| Integration | You need provider metadata, OAuth, tokens, or remote integration tools.       | A local custom API call is enough and no shared connector behavior is needed. |
| MCP server  | External assistants or MCP clients need tools, prompts, or resources.         | The capability is only used inside one Veryfront app route.                   |
| Sandbox     | Code or shell work needs isolation from the app process.                      | The code can run safely in your own trusted runtime.                          |
| Extension   | A capability should be packaged and reused across projects.                   | The code belongs to one app and can stay local.                               |

## Common pairings

| Goal                                   | Typical shape                                      |
| -------------------------------------- | -------------------------------------------------- |
| Chat with company data                 | Agent + tools + memory + chat UI                   |
| Human-approved content pipeline        | Workflow + agents + approval step                  |
| Nightly sync from an external API      | Task + cron job + optional integration credentials |
| User-authorized GitHub automation      | Integration + OAuth + tools                        |
| Assistant-accessible project commands  | MCP server + tools                                 |
| Isolated repo inspection or code edits | Agent + sandbox + tools                            |
| Reusable Redis cache support           | Extension + CacheStore contract                    |

## Verify it worked

Before building, write down the primitive you chose and one sentence explaining
why. Then check the matching guide:

- If the guide's first example solves your shape, continue there.
- If you need two or more primitives, start with the primitive that owns the
  triggering event.
- If you are choosing between `Task` and `Job`, remember that a task defines
  the work and a job runs it durably.

Run the relevant guide example or validation command before adding more
primitives.

## Next

- [Quickstart](./quickstart.md): create a project
- [Agents](./agents.md): define an agent
- [Workflows](./workflows.md): orchestrate multi-step work
- [Jobs](./jobs.md): run durable background work

## Related

- [`veryfront/agent`](../reference/veryfront/agent.md): agent API reference
- [`veryfront/tool`](../reference/veryfront/tool.md): tool API reference
- [`veryfront/workflow`](../reference/veryfront/workflow.md): workflow API reference
- [`veryfront/jobs`](../reference/veryfront/jobs.md): jobs API reference
- [`veryfront/integrations`](../reference/veryfront/integrations.md): integrations API reference
- [`veryfront/mcp`](../reference/veryfront/mcp.md): MCP API reference
- [`veryfront/sandbox`](../reference/veryfront/sandbox.md): sandbox API reference
- [`veryfront/extensions`](../reference/veryfront/extensions.md): extension API reference
