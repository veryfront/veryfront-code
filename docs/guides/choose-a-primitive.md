---
title: "Choose a primitive"
description: "Choose the smallest Veryfront primitive for the work."
order: 10
---

Pick the smallest primitive that matches the work. This keeps project structure
clear and prevents overlapping agents, workflows, runs, and integrations.

## Quick choice

| Goal                                                        | Use                    | Start with                                  |
| ----------------------------------------------------------- | ---------------------- | ------------------------------------------- |
| Receive browser, HTTP, or webhook traffic                   | App route or API route | [Pages and routing](./pages-and-routing.md) |
| Answer users with model reasoning, tools, memory, or skills | Agent                  | [Agents](./agents.md)                       |
| Give an agent one typed capability                          | Tool                   | [Tools](./tools.md)                         |
| Package reusable agent behavior                             | Skill                  | [Skills](./skills.md)                       |
| Reuse assistant instructions                                | Prompt                 | [MCP server](./mcp-server.md)               |
| Expose readable context to assistants                       | Resource               | [MCP server](./mcp-server.md)               |
| Measure agent quality across examples                       | Eval                   | [Evals](./evals.md)                         |
| Define project-owned background work                        | Task                   | [Tasks](./tasks.md)                         |
| Coordinate multiple steps, branches, approvals, or retries  | Workflow               | [Workflows](./workflows.md)                 |
| Run durable background work now or on a schedule            | Run or schedule        | [Runs](./runs.md)                           |
| Connect agents to third-party services                      | Integration with OAuth | [Integrations](./integrations.md)           |
| Expose project capabilities to assistants over a protocol   | MCP server             | [MCP server](./mcp-server.md)               |
| Run isolated commands or file operations                    | Sandbox                | [Sandbox](./sandbox.md)                     |
| Add reusable runtime capabilities                           | Extension              | [Extensions](./extensions.md)               |

## Decision rules

| Primitive   | Use for                                                                       | Do not use for                                                                |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| App route   | A browser, HTTP client, or webhook needs an entry point.                      | The work should outlive the request or be reused outside routing.             |
| Agent       | The model must decide, explain, call tools, use memory, or stream a response. | The work is deterministic and can be a function, task, or workflow step.      |
| Tool        | An agent needs a typed operation such as search, lookup, write, or transform. | The operation has multiple long-running states or human approval steps.       |
| Skill       | An agent needs reusable instructions, references, scripts, and tool policy.   | The work is deterministic or needs durable process state.                     |
| Prompt      | An assistant needs reusable instruction text.                                 | The project needs to execute code or read data.                               |
| Resource    | An assistant needs readable project context.                                  | The operation changes state or starts work.                                   |
| Eval        | You need repeatable agent quality checks, datasets, metrics, and reports.     | You need deterministic code assertions without model execution.               |
| Task        | You own a reusable background function in `tasks/`.                           | The user needs conversational reasoning or streaming output.                  |
| Workflow    | The process has ordered steps, parallel branches, retries, or human review.   | A single agent response or one background function is enough.                 |
| Run         | You need durable execution, scheduling, batch status, or run history.         | The work can finish inside a request without durability.                      |
| Integration | You need provider metadata, OAuth, tokens, or remote integration tools.       | A local custom API call is enough and no shared connector behavior is needed. |
| MCP server  | External assistants or MCP clients need tools, prompts, or resources.         | The capability is only used inside one Veryfront app route.                   |
| Sandbox     | Code or shell work needs isolation from the app process.                      | The code can run safely in your own trusted runtime.                          |
| Extension   | A capability should be packaged and reused across projects.                   | The code belongs to one app and can stay local.                               |

## Common pairings

| Goal                                   | Typical shape                                      |
| -------------------------------------- | -------------------------------------------------- |
| Chat with company data                 | Agent + tools + memory + chat UI                   |
| Human-approved content pipeline        | Workflow + agents + approval step                  |
| Nightly sync from an external API      | Task + schedule + optional integration credentials |
| Assistant help with a repeatable task  | Agent + skill + optional tools                     |
| Agent quality gate for CI              | Eval + agent + dataset                             |
| Assistant reads project context        | MCP server + resources                             |
| Observable invoice processing          | Workflow + agents + task runs                      |
| User-authorized GitHub automation      | Integration + OAuth + tools                        |
| Assistant-accessible project commands  | MCP server + tools                                 |
| Isolated repo inspection or code edits | Agent + sandbox + tools                            |
| Reusable Redis cache support           | Extension + CacheStore contract                    |

## Verify it worked

Before building, write down the primitive and why it owns the work. Then check
the matching guide:

- If the guide's first example solves your shape, continue there.
- If you need two or more primitives, start with the one that owns the triggering event.
- When choosing between `Task` and `Run`, remember that a task defines the work and a run executes it durably.

Run the guide's example or validation command before adding another primitive.
