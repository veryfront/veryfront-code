---
title: "Skills"
description: "Define project-level agent capabilities as SKILL.md files with prompt augmentation, tool restrictions, and script execution."
order: 20
---

# Skills

Skills are project-level agent capabilities defined as `SKILL.md` files following the [agentskills.io](https://agentskills.io) specification. They give agents structured instructions, restrict which tools are available, and provide reference files and executable scripts.

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

## Next

- [Agents](./agents.md): agents use skills for structured instructions
- [Tools](./tools.md): define custom tools that skills can reference

## Related

- [agentskills.io specification](https://agentskills.io)
