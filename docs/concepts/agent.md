---
title: "Agent"
description: "How agents own model reasoning, messages, tools, memory, and streamed output."
order: 21
---

An agent owns model reasoning for an interaction. It receives messages, applies
instructions, chooses whether to call tools, observes tool results, and emits
output.

Agents follow the same idea as the ReAct prompting pattern: reasoning and
acting. The model reasons about the current state, acts by calling a tool or
producing a response, observes the result, then repeats the loop until it can
finish.

## Characteristics

- Perception: reads messages, system instructions, memory, runtime state, and
  tool results.
- Reasoning: decides what the next useful step is.
- Action: calls a tool, asks for more information, or emits output.
- Goal direction: works toward the objective expressed by its instructions and
  the current user message.
- Autonomy: can choose the next step inside the limits of its tools, runtime
  config, and guardrails.

## Loop

The loop has four parts:

| Phase       | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| Input       | User messages, system instructions, memory, and runtime data. |
| Reasoning   | The model decides the next useful step.                       |
| Action      | The agent calls a tool or emits output.                       |
| Observation | Tool results or new messages are added back into context.     |

Veryfront hides most loop plumbing behind the agent runtime. The important
boundary is still visible: the agent decides what to do next, while tools,
resources, jobs, and app routes own the deterministic work they perform.

## Boundary

Use an agent when the system needs judgment, language understanding, tool choice,
or streamed conversational output. Agents usually pair with tools, memory, and a
chat UI. AG-UI is the default streaming surface for interactive agent output.

Do not use an agent for deterministic work that a tool, route, task, or workflow
can own directly. If the next step is always known, the model should not be in
charge of it.

## Wrong fit

An agent is the wrong primitive for a fixed HTTP response, a scheduled sync, a
single database write, or a multi-step process that needs durable state. Use an
app route, task, tool, or workflow for those boundaries.

For implementation steps, see [Agents](../guides/agents.md).
