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
`buildSkillManifestPrompt` JSON-quotes bounded IDs and descriptions, escapes
Unicode line and paragraph separators, and uses captured serialization
intrinsics before placing this untrusted metadata in a system prompt;
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

Use `validateSkillPath` and `listSkillSubdir` only when you need their public
compatibility policy: relative paths may contain up to 4096 characters,
directory enumeration is not entry-capped, and listing preserves adapter
iteration order. Use `validateStrictSkillPath` and `listStrictSkillSubdir` at
untrusted runtime filesystem boundaries; they apply the 1024-character
relative-path budget, the 1000-entry directory budget, and deterministic
filename sorting. Traversal, symlinked directories or entries, and malformed
adapter entry names are rejected by both policies even if an older release
happened to enumerate them; those cases are intentional security corrections,
not supported compatibility behavior.
Errors returned from strict Skill reads redact the configured root as
`<skill-root>` and other absolute local paths as `<local-path>` so host
filesystem layout is not exposed to callers. Cancellation control still uses
the caller's abort reason internally, but the public error is a detached,
redacted framework-owned value without the source stack, cause, or custom
fields.
Framework discovery and tool execution additionally apply tighter resource
ceilings and deterministic sorting at their filesystem boundaries.
Non-native filesystem adapters used at these bounded Skill boundaries must
implement a genuine `readFileBytesBounded(path, byteLimit)` operation. Reading
the complete object and slicing afterward is not bounded; adapters without the
capability fail closed before `readFile()` is called.

## Parse a Skill document from application code

The `veryfront` CLI composes the first-party YAML provider automatically for
Skill commands and project discovery. No parser setup is required before
running `veryfront skills validate` or `veryfront dev`.

When calling `veryfront/skill` directly, install the provider package as a
direct dependency:

```bash
deno add npm:@veryfront/ext-yaml
# npm projects
npm install @veryfront/ext-yaml
```

Create the provider once and pass it to each standalone parser call:

```ts
import { createStdYamlSkillDocumentParserProvider } from "@veryfront/ext-yaml";
import { parseSkillFrontmatter, validateSkillFileMetadata } from "veryfront/skill";

const parser = createStdYamlSkillDocumentParserProvider();
const parsed = await parseSkillFrontmatter(
  "---\nname: review\ndescription: Review code\n---\n",
  parser,
);
const metadata = validateSkillFileMetadata(parsed.frontmatter, "review");
```

Alternatively, activate the provider through the extension lifecycle:

```ts
import { defineConfig } from "veryfront";
import extYaml from "@veryfront/ext-yaml";

export default defineConfig({
  extensions: [extYaml()],
});
```

After extension setup completes, parser calls can omit the provider argument
and resolve the active `SkillDocumentParserProvider` registration.

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

## Provide a Skill script executor

Use the `SkillScriptExecutorProvider` extension contract when Skill scripts
must run through a custom execution service. The exact registration name is
`SkillScriptExecutorProvider`; use `SkillScriptExecutorProviderName` instead of
repeating that string.

The provider must prepare an inert execution before it starts any work. This
example registers a complete provider that asynchronously echoes the validated
script content:

```ts
import type { ExtensionFactory } from "veryfront/extensions";
import {
  type SkillScriptExecutorProvider,
  SkillScriptExecutorProviderName,
} from "veryfront/extensions/skill";

const createEchoSkillScriptExecutor: ExtensionFactory = () => ({
  name: "echo-skill-script-executor",
  version: "1.0.0",
  capabilities: [],
  contracts: { provides: [SkillScriptExecutorProviderName] },
  setup(context) {
    const provider: SkillScriptExecutorProvider = {
      prepare(input, reporter) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let finished = false;

        return {
          activate() {
            timer = setTimeout(() => {
              if (finished) return;
              finished = true;
              timer = undefined;
              reporter.resolveResult({
                stdout: input.scriptContent ?? "",
                stderr: "",
                exitCode: 0,
              });
              reporter.resolveTerminal();
            }, 0);
          },
          terminate(reason) {
            if (finished) return;
            finished = true;
            if (timer !== undefined) clearTimeout(timer);
            reporter.rejectResult(
              reason ?? new Error("Skill script execution terminated"),
            );
            reporter.resolveTerminal();
          },
        };
      },
    };

    context.provide<SkillScriptExecutorProvider>(
      SkillScriptExecutorProviderName,
      provider,
    );
  },
});

export default createEchoSkillScriptExecutor;
```

Declare the contract in `contracts.provides`, then publish it with
`context.provide()` during extension setup. This gives the extension loader
ownership of registration, replacement, and teardown.

Follow these lifecycle requirements when adapting the example:

1. `prepare(input, reporter)` must return inert controls synchronously. It must
   not spawn a process, provision a sandbox, issue a request, schedule
   execution, or report settlement. Start external work only from `activate()`.
2. `activate()` must complete synchronously, without returning a Promise. It
   can start asynchronous work and report its outcome later.
3. The validated `terminate(reason)` control is synchronous and idempotent.
   Veryfront forwards its first call to the provider and ignores later calls.
   Initiate cancellation synchronously, then report asynchronous cleanup
   through the reporter.
4. Report the script outcome with `resolveResult(result)` or
   `rejectResult(reason)`. Report `resolveTerminal()` only after all
   provider-owned cleanup is complete, or use `rejectTerminal(reason)` if
   cleanup fails. Always report a terminal settlement, including after
   cancellation or an activation failure.

Reporter calls before activation are a contract violation. The
`execute_skill_script` call waits for both the result and terminal cleanup, so
a successful result does not return while cleanup is pending. Independent
result and cleanup failures are preserved in an `AggregateError`.

The provider and prepared controls have exact security shapes. The provider
must be a non-proxy plain object with only one own, enumerable function data
property, `prepare`. `prepare` must return a non-proxy plain object with exactly
the own, enumerable function data properties `activate` and `terminate`. Plain
objects may use `Object.prototype` or a null prototype. Extra or symbol keys,
accessors, inherited class methods, proxied functions, async functions, and
Promise-returning callbacks are rejected. Veryfront invokes the captured
functions without a receiver, so use closures instead of `this`.

`SkillScriptResult` has a structural boundary rather than this exact-object
requirement. No class or prototype brand is required, and extra fields are
allowed, but `stdout`, `stderr`, and `exitCode` must be own, enumerable data
properties on a non-proxy object. The two outputs must be well-formed strings
with a combined limit of 1 MiB, and `exitCode` must be a safe integer. Veryfront
copies only those three fields into a detached, frozen result and discards the
source prototype and extra fields. It rejects accessors for the required
fields instead of invoking them.

Backend selection follows this precedence for each execution:

1. A `SkillScriptExecutor` passed as
   `createExecuteSkillScriptTool({ executor })`.
2. The active `SkillScriptExecutorProvider` registration.
3. The built-in executor, which selects cloud execution when cloud
   authentication is available and local execution otherwise.

An explicit executor prevents provider-registry inspection. A registered
provider is snapshotted for that execution. A malformed or transition-
unavailable registration fails closed instead of falling back to the built-in
executor.

Loader-owned providers also participate in extension generation retirement.
When retirement begins, the loader seals the current generation synchronously,
before extension context abort or teardown, so no new execution can enter it.
Context abort and generation drain can both request cancellation, but the
validated execution forwards `terminate(reason)` at most once. The drain waits
up to a 1,000 ms cleanup grace for every admitted execution to report its
result and terminal cleanup. Only after those generation leases drain does the
provider extension run teardown and a successfully staged replacement become
active.

If a provider does not report both settlements within the cleanup grace, the
public script invocation returns its timeout or cancellation result instead of
waiting indefinitely. Veryfront keeps observing the late settlements and
quarantines the provider generation. Teardown and replacement fail without
dismantling or reusing that generation while its execution remains active.
After the provider reports both its late result and terminal cleanup
settlements, retry teardown before activating a replacement.

Provider resolution fails closed while a generation is retiring or a
replacement is staging. If replacement setup fails, contracts remain
unavailable until a later generation commits successfully; Veryfront does not
silently select the built-in executor. An execution already admitted to a
generation keeps its provider snapshot until terminal cleanup, while a
captured provider that did not start before retirement cannot start afterward.

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

`load_skill` remains available under a declared policy so the agent can load
or switch skill instructions. `load_skill_reference` and
`execute_skill_script` are available only when the active skill advertises a
matching file and the declared policy allows that tool ID. An empty or invalid
policy therefore cannot read advertised references or execute advertised
scripts.

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
