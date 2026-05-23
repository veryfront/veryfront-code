---
title: "Skills"
description: "Define project-level agent capabilities as SKILL.md files with prompt augmentation, tool restrictions, and script execution."
order: 29
---

A skill is a directory under `skills/` containing a `SKILL.md` file. It bundles structured agent instructions, an `allowed_tools` policy, and optional reference files and executable scripts. The format follows the [agentskills.io](https://agentskills.io) specification.

## Prerequisites

- A Veryfront project with at least one agent (see [Agents](./agents.md)).
- The `skills/` directory exists at the project root, or
  `ai.skills.discovery.paths` is set in
  [Configuration](./configuration.md).

## Quick start

Create a skill directory with a `SKILL.md` file:

```
skills/
  code-review/
    SKILL.md
    references/
      style-guide.md
    scripts/
      lint.sh
```

The `SKILL.md` file uses YAML frontmatter for metadata and Markdown for instructions:

```markdown
---
name: code-review
description: Review code changes for style, correctness, and security issues.
allowed_tools: load-skill load-skill-reference execute-skill-script
---

# Code Review

Review the submitted code changes following the project style guide.

1. Load the style guide from `references/style-guide.md`
2. Check for common issues
3. Run the linter via `scripts/lint.sh`
4. Provide feedback with specific line references
```

## Skill structure

Each skill lives in its own directory under `skills/`:

```
skills/<skill-id>/
├── SKILL.md              # Required: frontmatter + instructions
├── references/           # Optional: reference files the agent can read
│   └── *.md
├── scripts/              # Optional: executable scripts
│   └── *.sh
└── assets/               # Optional: static assets
    └── *
```

## Frontmatter fields

| Field           | Required | Description                                                                  |
| --------------- | -------- | ---------------------------------------------------------------------------- |
| `name`          | Yes      | Skill identifier (lowercase alphanumeric + hyphens, 1-64 chars)              |
| `description`   | Yes      | Human-readable description (max 1024 chars)                                  |
| `allowed_tools` | No       | Space-delimited tool IDs or prefix patterns (e.g. `api:*`) the agent may use |
| `license`       | No       | SPDX license identifier                                                      |
| `compatibility` | No       | Compatibility constraints                                                    |
| `metadata`      | No       | Arbitrary key-value pairs                                                    |

## Discovery

Skills are discovered automatically from the `skills/` directory at server startup and on HMR file changes. No registration is needed.

```
skills/
  code-review/SKILL.md     → skill ID: "code-review"
  data-analysis/SKILL.md   → skill ID: "data-analysis"
```

## Agent tools

When skills are available, agents get three built-in tools:

| Tool                   | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `load-skill`           | Load a skill's full instructions by ID           |
| `load-skill-reference` | Read a reference file from a skill               |
| `execute-skill-script` | Execute a script from a skill (5-minute timeout) |

Enable skills on an agent:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "Use project skills when they match the task.",
  skills: ["code-review"],
});
```

Expose the agent through an AG-UI route, then ask it to use the skill:

```bash
curl -N http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Use the code-review skill and summarize what you would check first."}]}]}'
```

The agent should call `load-skill` before applying the skill instructions.

## Tool restrictions

The `allowed_tools` field restricts which tools an agent can use while a skill is active. Use exact IDs or prefix wildcards:

```yaml
# Exact tool IDs
allowed_tools: load-skill load-skill-reference execute-skill-script

# Prefix wildcards
allowed_tools: api:* database:read

# No restriction (agent can use all tools)
# omit the field entirely
```

## CLI commands

```bash
# Create a new skill
veryfront skills create my-skill

# Validate a skill
veryfront skills validate skills/my-skill
```

## Verify it worked

1. Run `veryfront skills validate skills/my-skill`. A passing skill prints
   no errors and exits with status `0`.
2. Restart `veryfront dev`. The dev log should list each registered skill
   under its directory name.
3. Send a message that should trigger the skill (for example, a code-review
   skill should engage when the message asks to "review this diff"). The
   AG-UI response should reference the skill's instructions or call only
   the tools listed in `allowed_tools`.
