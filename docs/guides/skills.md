---
title: "Skills"
description: "Define project-level agent capabilities as SKILL.md files with prompt augmentation, tool restrictions, and script execution."
order: 29
---

A skill is a directory under `skills/` containing a `SKILL.md` file. It bundles structured agent instructions, an `allowed-tools` policy, optional resource and reference files, static assets, and executable scripts. Its metadata follows the [Agent Skills specification](https://agentskills.io/specification); Veryfront uses the fail-closed tool-pattern subset described below for the experimental `allowed-tools` field.
Use [veryfront/skill](../api-reference/veryfront/skill.md) for parser,
registry, tool, and policy helpers in framework code.

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
    resources/
      review-rubric.md
    scripts/
      lint.sh
```

The `SKILL.md` file uses YAML frontmatter for metadata and Markdown for instructions:

```markdown
---
name: code-review
description: Review code changes for style, correctness, and security issues.
allowed-tools: load_skill load_skill_reference execute_skill_script
---

# Code Review

Review the submitted code changes following the project style guide.

1. Load the style guide from `references/style-guide.md`
2. Load the rubric from `resources/review-rubric.md`
3. Check for common issues
4. Run the linter via `scripts/lint.sh`
5. Provide feedback with specific line references
```

## Skill structure

Each skill lives in its own directory under `skills/`:

```
skills/<skill-id>/
├── SKILL.md              # Required: frontmatter + instructions
├── references/           # Optional: reference files the agent can read
│   └── *.md
├── resources/            # Optional: source documents or review inputs
│   └── *.md
├── scripts/              # Optional: executable scripts
│   └── *.sh
└── assets/               # Optional: static assets
    └── *
```

## Frontmatter fields

| Field           | Required | Description                                                                                                            |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`          | Yes      | Authored label. The directory supplies the runtime ID; new skills should use the same canonical 1-64-character ID here |
| `description`   | Yes      | Human-readable description (max 1024 characters)                                                                       |
| `allowed-tools` | No       | Space-delimited tool IDs or prefix patterns (for example, `api:*`) the agent may use                                   |
| `license`       | No       | License identifier or reference (max 256 characters)                                                                   |
| `compatibility` | No       | Environment or product requirements (max 500 characters)                                                               |
| `metadata`      | No       | String-to-string metadata (max 64 entries)                                                                             |

`allowed_tools` remains accepted as a compatibility alias. Use the canonical
`allowed-tools` spelling in new skills.

## Discovery

Skills are discovered automatically from the `skills/` directory at server startup and on HMR file changes. No registration is needed.

```
skills/
  code-review/SKILL.md     → skill ID: "code-review"
  data-analysis/SKILL.md   → skill ID: "data-analysis"
```

The parent directory is always the runtime skill ID. New skills should repeat
that canonical ID in `name`. For compatibility, discovery retains a differing
authored name only as `displayName`; it never changes lookup or authorization.
The CLI validator rejects a different canonical-looking ID as a likely typo,
while display-style labels remain supported. Invalid or malformed YAML is
reported as a discovery error; it is not partially reinterpreted.

`parseSkillFrontmatter` and `parseSkillFileFrontmatter` expose the same
bounded, fail-closed parser. The explicitly named
`parseUnsafeLegacySkillFrontmatter` helper preserves the historical lossy
fallback only for migration and is deprecated. Likewise,
`buildSkillManifestPrompt` JSON-quotes bounded IDs and descriptions before
placing this untrusted metadata in a system prompt;
`buildUnsafeLegacySkillManifestPrompt` is deprecated and unsafe for prompts.
The public Agent runtime helpers follow the same rule:
`buildRuntimeAvailableSkillsPromptBlock`, `formatRuntimeSkillMetadata`,
`parseRuntimeSkillDocument`, `parseRuntimeSkillMetadata`, and
`normalizeRuntimeSkillReferencePath` are bounded, fail-closed defaults.
`buildRuntimeSkillDefinition` and `buildRuntimeLoadedSkillResponse` likewise
validate and snapshot their direct programmatic inputs. Their historical
permissive behavior is available only through the deprecated
`buildUnsafeLegacyRuntimeAvailableSkillsPromptBlock`,
`buildUnsafeLegacyRuntimeSkillDefinition`,
`buildUnsafeLegacyRuntimeLoadedSkillResponse`,
`formatUnsafeLegacyRuntimeSkillMetadata`,
`parseUnsafeLegacyRuntimeSkillDocument`,
`parseUnsafeLegacyRuntimeSkillMetadata`, and
`normalizeUnsafeLegacyRuntimeSkillReferencePath` compatibility helpers.

If a project-global skill and an agent-owned skill claim the same exact ID,
discovery quarantines both definitions and reports a `duplicate_id` error.
Directory-form project skills still take precedence over legacy flat files,
and valid project skills still take precedence over built-ins.

Path-safety helpers preserve adapter iteration order and accept canonical
relative paths up to the general 4096-character path budget. Traversal,
symlinked directories or entries, and malformed adapter entry names are
rejected even if an older release happened to enumerate them; those cases are
intentional security corrections, not supported compatibility behavior.
Errors returned from strict Skill reads redact the configured root as
`<skill-root>` so host filesystem layout is not exposed to callers.
Framework discovery and tool execution additionally apply tighter resource
ceilings and deterministic sorting at their filesystem boundaries.
Non-native filesystem adapters used at these bounded Skill boundaries must
implement a genuine `readFileBytesBounded(path, byteLimit)` operation. Reading
the complete object and slicing afterward is not bounded; adapters without the
capability fail closed before `readFile()` is called.

## Agent tools

Every agent gets `load_skill`. Local and project runtimes also expose the two
supporting skill tools:

| Tool                   | Availability               | Description                                                |
| ---------------------- | -------------------------- | ---------------------------------------------------------- |
| `load_skill`           | Every runtime              | Load a skill's full instructions by ID                     |
| `load_skill_reference` | Local and project runtimes | Read a file from `references/`, `resources/`, or `assets/` |
| `execute_skill_script` | Local and project runtimes | Execute a script with a total deadline of up to 5 minutes  |

Hosted chat reads an advertised reference through
`load_skill({ skillId, file })`. It does not execute skill scripts directly.

Discovered skills visible to the agent are advertised by default:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "Use project skills when they match the task.",
});
```

Use `skills: ["code-review"]` to advertise and authorize only that skill. Use
`skills: []` to select none; the runtime then omits skill-loading tools. Omitted
`skills` and `skills: true` select every skill visible to the agent. Explicit
entries resolve as the agent's own short names first, then exact visible IDs,
and unresolved entries fail configuration rather than widening access.

Expose the agent through an AG-UI route, then ask it to use the skill:

```bash
curl -N http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Use the code-review skill and summarize what you would check first."}]}]}'
```

The agent should call `load_skill` before applying the skill instructions.

## Tool restrictions

The `allowed-tools` field restricts which tools an agent can use while a skill is active. Use exact IDs or prefix wildcards:

```yaml
# Exact tool IDs
allowed-tools: load_skill load_skill_reference execute_skill_script

# Prefix wildcards
allowed-tools: api:* database:read

# No restriction (agent can use all tools)
# omit the field entirely
```

Veryfront supports exact tool IDs and colon-delimited prefix wildcards such as
`api:*`. It does not interpret experimental argument constraints such as
`Bash(git:*)`; unsupported patterns fail validation instead of widening access.
An explicitly empty string or array creates a deny-all policy. Only omission
means unrestricted tool access.

The latest successful skill body load remains active for the persisted
conversation, including later user messages, until another skill body is
successfully loaded. Stateless agent calls begin without prior skill state.
Duplicate-load responses that mention "this turn" refer only to the current
runtime context's load cache.

After a successful `form_input` submission, the runtime removes `form_input`
from planning. It also prevents skill-body switches and advertises
`load_skill` only with the active skill ID and its exact advertised reference
paths. Delegation and other tools still follow the active `allowed-tools`
policy.

Continuation and delegation advice is derived from the intersection of the
runtime's available tools and the active `allowed-tools` policy. Veryfront does
not suggest a delegate tool that the active skill cannot call. Runtime
duplicate-load tracking is aggregate-bounded: it stores compact skill metadata
and reference markers, not loaded instruction bodies or reference contents.

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
   the tools listed in `allowed-tools`.

## Script execution limits

Skill scripts default to a 60-second timeout and may request up to 5 minutes.
The requested timeout is one total deadline measured from tool entry; path
validation, bounded reads, executor preparation, launch, and process execution
all consume the same remaining budget. Cancellation can settle the operation
during any of those preflight stages.
Local tool execution preserves the original validated script path, filename,
working directory, script-relative imports, and ancestor package resolution.
It does not write staging files into the skill tree, so skills may be installed
read-only. Immediately before launch, Veryfront rechecks canonical containment
and native filesystem identities and confirms that the selected file still
matches the bounded decoded content read by the tool. Filesystems that do not expose a
stable native device/file identity fail closed instead of using metadata as an
identity substitute.

The interpreter must still open the original path after those checks. A
same-user actor that can mutate the source namespace can race that final open,
and imported dependencies are resolved from the live source tree rather than
an immutable bundle. Local skill scripts are therefore trusted development
code, not an operating-system security boundary. Use cloud execution when
untrusted code requires filesystem and process isolation.

Local cancellation, output limits, and timeouts signal the runtime-owned POSIX
process group or request Windows process-tree termination, then close capture
pipes after a bounded force-kill grace period. On normal tool settlement,
same-group POSIX descendants are killed before return; Windows uses
best-effort, asynchronous `taskkill` tree cleanup. A descendant that
deliberately creates a new session or otherwise escapes OS process-tree
discovery can survive local cleanup and is unsupported.

Cloud execution uses a disposable sandbox session. Every command settlement,
including success, attempts direct process termination before session deletion;
cleanup failures are surfaced. Sandbox provisioning and file-transfer requests
retain their bounded request deadlines before cleanup. The current termination
command relies on the official Linux/Bash runtime invariant that the sandbox
HTTP service is container PID 1: Bash's built-in `kill` terminates eligible
peer processes while Linux excludes both PID 1 and the calling shell. A
compatible backing service that does not preserve this invariant cannot offer
the same guarantee through the current client API. Portable fail-closed cleanup
requires a future control-plane terminate-all primitive; session deletion alone
is asynchronous and is not treated as proof that all processes have exited.

Cloud scripts run from a fresh remote directory containing only the selected
uploaded script. A local `cwd` is not copied into that directory; references,
resources, assets, and sibling scripts must be uploaded or accessed through an
explicit supported interface. Environment values are passed as structured
sandbox options rather than embedded in the command string. Combined captured
output and uploaded script content are capped at 1 MiB, and arguments and
environment entries are limited to 64 each.

Python, shell, and JavaScript files use `python3`, `bash`, and `node`
respectively. Deno runs TypeScript directly. Node and Bun projects must already
provide `tsx`; script execution uses `npx --no-install tsx` and never installs a
package from the network.
