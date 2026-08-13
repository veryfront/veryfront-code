---
title: "Skill"
description: "How skills package reusable agent instructions, references, scripts, and assets."
order: 29
---

A skill owns reusable agent instructions. It can include reference files,
scripts, and assets.

Skills exist because some agent behavior is larger than one prompt but smaller
than a new runtime primitive. A skill packages a repeatable way of working, such
as code review, data analysis, incident response, or repository maintenance.

## Characteristics

- `SKILL.md` contains the instructions and metadata.
- References provide supporting material the agent can load.
- Scripts provide optional executable helpers.
- Assets provide optional files the skill can use.
- `allowed-tools` records which tools the skill expects to use. It is
  descriptive metadata, not an authorization boundary.

## Boundary

The agent owns the interaction and decides when to use a skill. The skill owns
the instructions and supporting files for that capability. Tools still own
actions.

A skill never widens or narrows the tools a run can call. The
[Agent Skills specification](https://agentskills.io/specification) defines
`allowed-tools` as tools pre-approved to run without prompting, so Veryfront
records the declaration and does not enforce it. Configure the agent's tools to
control what a run can do.

This keeps task-specific agent behavior discoverable without hiding it inside a
large system prompt.

## Wrong fit

Do not use a skill for callable work that should be a tool, background work that
should be a task, or multi-step process state that should be a workflow.

For implementation steps, see [Skills](../guides/skills.md).
