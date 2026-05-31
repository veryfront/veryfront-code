# Veryfront code agent guide

This guide governs `veryfront-code/`. Deeper `AGENTS.md` files override it for their subtrees. The `cli/` subtree has its own guide at `cli/AGENTS.md` and that guide is the narrower authority for CLI command work.

Veryfront Code is the Deno-first framework and runtime package for Veryfront. It contains the public `veryfront/*` APIs, the runtime server, SSR/RSC support, agent and workflow primitives, runs, tasks, MCP support, and CLI entrypoints.

## Default working style

- Prefer the smallest viable diff.
- Preserve public API compatibility unless the task explicitly asks for a breaking change.
- For behavior changes, add or update a focused failing test before changing implementation.
- Reuse existing modules, schemas, adapters, and error patterns before adding new abstractions.
- Keep public behavior grounded in code evidence, generated types, and tests.
- Update docs, examples, generated references, and command help when public behavior changes.
- Do not rename, move, or refactor unrelated code.
- Do not add dependencies unless the task explicitly requires them.

## Commands

Use Deno commands from this repository root.

```bash
# Command discovery
veryfront schema --json

# MCP server
veryfront mcp

# Run the full test suite
VF_DISABLE_LRU_INTERVAL=1 SSR_TRANSFORM_PER_PROJECT_LIMIT=0 REVALIDATION_PER_PROJECT_LIMIT=0 \
  NODE_ENV=production LOG_FORMAT=text \
  deno test --no-check --allow-all --unstable-worker-options --unstable-net

# Unit tests only, parallel, excluding integration suites
deno test --no-check --allow-all --parallel \
  '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
```

For targeted changes, run the narrowest relevant `deno test` command first, then broaden only when the change touches shared runtime, public APIs, or cross-cutting behavior.

## Public copy rules

Apply these rules to CLI output, command help, docs generated from this package, examples, error messages, warnings, logs exposed to users, API descriptions, and public comments.

- Use direct, concise language.
- Address the reader as "you". Use "Veryfront" for the product.
- Avoid first-person plural product voice. Name the product or user role instead.
- Use present tense and active voice.
- Use sentence-case headings.
- Keep paragraphs short.
- Avoid filler phrases, hedging, and marketing language.
- Avoid weak instruction forms. Use "must" for requirements, "use" for actions, and "can" only for options.
- Use "ensure" for verification language.
- Use "select" instead of "click" in UI guidance.
- Do not use em dash or en dash characters. Use commas, periods, colons, parentheses, or ASCII hyphens.
- Code examples must be complete, copyable, and safe to paste.
- Use placeholders such as `<API_KEY>`, `<TOKEN>`, `<PROJECT_ID>`, `<RUN_ID>`, and `<REDACTED>` for sensitive values.

## Concept and terminology rules

Use the same concept names in code, schemas, command help, docs, tests, and errors.

| Term          | Meaning                                                                            | Do not confuse with                                       |
| ------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Agent         | AI runtime primitive that accepts messages, tools, context, and emits AG-UI events | Workflow or task                                          |
| Tool          | Callable capability used by an agent or workflow step                              | MCP tool unless the surface is explicitly MCP             |
| Workflow      | Step graph or DAG for multi-step execution                                         | Task or schedule                                          |
| Task          | Developer-defined background work target                                           | Run                                                       |
| Run           | Durable execution of an agent, workflow, or task                                   | Definition or schedule                                    |
| Schedule      | One-time or cron-like trigger that creates runs                                    | Run                                                       |
| Agent run     | Conversation-owned execution of an agent                                           | Workflow run or task run                                  |
| Workflow run  | Project-owned canonical run for workflow execution                                 | Agent run                                                 |
| Task run      | Project-owned canonical run for task execution                                     | Task definition                                           |
| AG-UI         | Agent event protocol used for streamed agent output                                | REST or MCP                                               |
| SSE           | Token and AG-UI event streaming transport                                          | WebSocket notification                                    |
| WebSocket     | Realtime notifications, terminal, logs, and Yjs sync                               | Token stream unless the specific code path uses WebSocket |
| MCP           | Tool and resource protocol surface for assistants                                  | REST, AG-UI, or CLI                                       |
| Control plane | Signed management surface between Veryfront services and project runtimes          | Public app route                                          |

When a change adds or changes a concept, update the concept name everywhere it appears. Do not create synonyms such as "agent job" or "workflow task" unless the code has a defined type with that exact name.

## Architecture guardrails

- Respect public exports and import maps in `deno.json`.
- Public imports use `veryfront/*`.
- Internal source imports use `#veryfront/*`.
- CLI imports use `#cli/*` or relative imports inside `cli/`.
- Keep runtime and control-plane boundaries explicit. Do not conflate CLI commands, public application routes, project runtime routes, and service control-plane routes.
- Keep AG-UI streaming, durable run state, and WebSocket notifications separate in naming and docs.
- Keep workflow, task, run, schedule, and runtime-adapter boundaries explicit.
- Keep public schemas close to the runtime behavior they validate.
- When a public schema changes, update the corresponding generated docs, examples, and tests.

## Secret and internal-detail safety

Never place real sensitive values in code examples, docs, logs, error messages, tests, PR descriptions, or final summaries.

Sensitive values include:

- API keys, provider keys, private keys, signing secrets, tokens, cookies, session identifiers, OAuth credentials, database URLs, webhook secrets, and one-time codes
- Customer data, production payloads, provider request bodies, raw prompts, and private model outputs
- Internal infrastructure names, private hostnames, cluster names, deployment contexts, and account identifiers
- Local absolute paths, user home directories, temp directories, and machine-specific filesystem layouts
- Full stack traces in user-facing output unless the command is explicitly a debug command

Use placeholders and redaction markers instead. Repo-relative paths are allowed in internal developer guidance, plans, test output, and code review notes when they are needed for precision. Public docs and user-facing output must not expose internal implementation paths or local machine paths.

## CLI and MCP output rules

Commands that support `--json` use it for machine-readable output. Some help and version paths remain human-readable when the command implementation has no JSON branch.

```bash
veryfront deploy --json
veryfront doctor --json
veryfront whoami --json
```

Use the JSON envelope pattern for commands that support structured output.

```json
{ "success": true, "command": "deploy", "data": {}, "timing": { "duration_ms": 3200 } }
```

```json
{
  "success": false,
  "command": "deploy",
  "error": {
    "code": "PERMISSION_ERROR",
    "slug": "deploy-not-authorized",
    "message": "...",
    "context": {}
  }
}
```

- Keep machine-readable output stable and schema-valid.
- Do not mix human prose into JSON mode.
- Redact sensitive values before writing logs, errors, or telemetry.
- Put user-actionable messages in `message`. Put sanitized technical detail in structured fields.
- For CLI command layout, help registration, argument parsing, and JSON utilities, follow `cli/AGENTS.md`.

### Global CLI flags and exit codes

Keep common CLI behavior consistent with the command router and `cli/AGENTS.md`.

| Surface          | Meaning                                                       |
| ---------------- | ------------------------------------------------------------- |
| `--json`, `-j`   | Machine-readable output for commands that implement JSON mode |
| `--output`, `-o` | Output destination or format, depending on command support    |
| `--yes`, `-y`    | Non-interactive confirmation for supported prompts            |
| `--quiet`, `-q`  | Reduced human output                                          |
| `--verbose`      | Diagnostic output for supported commands                      |
| `--no-color`     | Disable ANSI color in human output                            |

| Exit code | Meaning                  |
| --------- | ------------------------ |
| `0`       | Success                  |
| `1`       | Runtime or command error |
| `2`       | Usage or argument error  |
| `130`     | Interrupted by user      |

### MCP connection and resources

- Use `veryfront mcp` for stdio MCP sessions.
- In `veryfront dev`, the HTTP MCP server starts on the app port plus `2`.
- `veryfront start` does not start the CLI MCP server or expose `vf_*` tools.
- Prefer `vf_bootstrap` for initial context. It replaces separate project-context lookup calls for normal agent startup.
- MCP help highlights `vf_list_local_projects`, `vf_list_templates`, `vf_list_integrations`, `vf_create_project`, `vf_get_errors`, `vf_preview_route`, `vf_scaffold`, `vf_list_routes`, and `vf_trigger_hmr`.
- The standalone MCP runtime also exposes tools such as `vf_bootstrap`, `vf_get_project_context`, `vf_get_conventions`, `vf_get_status`, `vf_get_logs`, `vf_run_tests`, `vf_run_lint`, `vf_build`, and `vf_trigger_deploy`.
- Key MCP resources include `veryfront://schema`, `veryfront://agents-md`, and `veryfront://skills`.

## Agent workflows

Call `vf_bootstrap` once at session start when the Veryfront MCP server is available and project context is needed.

```text
vf_bootstrap()
```

Development loop:

1. Edit code.
2. Trigger HMR for the changed path when browser feedback is needed: `vf_trigger_hmr({ path: "app/page.tsx" })`.
3. Check compile and runtime errors: `vf_get_errors()`.
4. Run focused tests for the touched module: `vf_run_tests({ filter: "page" })`.
5. Run lint or formatting checks when relevant: `vf_run_lint()`.
6. Iterate until verification passes.

Build and release loop:

1. Run focused tests.
2. Run broader tests for shared runtime changes: `vf_run_tests({ parallel: true })`.
3. Run lint or format checks: `vf_run_lint()`.
4. Run a dry build when build output changes: `vf_build({ dryRun: true })`.
5. Run the production build when release behavior changes: `vf_build()`.

## Architecture map

```text
src/
├── agent/              # Agent runtime and AG-UI support
├── build/              # Build pipeline
├── channels/           # Control-plane and invoke channels
├── config/             # Configuration resolution
├── errors/             # VeryfrontError registry
├── runs/               # Canonical run client schemas and runtime environment helpers
├── mcp/                # MCP protocol types and runtime support
├── platform/           # Deno and Node compatibility layer
├── provider/           # AI model providers
├── react/              # React, SSR, RSC, and client components
├── server/             # Runtime server and request handlers
├── tool/               # Tool definitions and remote tool support
├── workflow/           # Workflow definitions, execution, and workers
└── ...

cli/                    # CLI layer. See cli/AGENTS.md for subtree rules.
├── router.ts
├── commands/
├── mcp/
├── help/
├── shared/
├── auth/
├── ui/
└── utils/
```

## Implementation conventions

### Error handling

Use the `VeryfrontError` registry pattern for typed errors.

```ts
import { defineError } from "#veryfront/errors";

const MY_ERROR = defineError("my-error-slug", ErrorCode.CONFIG_ERROR, 400);
throw MY_ERROR.create("Describe the user-actionable failure", { detail: "Sanitized detail" });
```

Match errors with `error instanceof VeryfrontError && error.slug === "my-error-slug"`.

### Tests

- Use `describe()` and `it()` from `#veryfront/testing/bdd.ts`.
- Use assertions from `#veryfront/testing/assert.ts`.
- Keep test files colocated as `*.test.ts` next to source.
- Do not delete tests to force a green run.

### Argument parsing

```ts
import { z } from "zod";
import { CommonArgs, createArgParser } from "#cli/shared/args";

const Schema = z.object({ force: z.boolean().default(false) });
const parseArgs = createArgParser(Schema, { force: CommonArgs.force });
```

## Verification checklist

For changes to `AGENTS.md` only:

```bash
git diff --check
python3 - <<'PY'
from pathlib import Path
text = Path("AGENTS.md").read_text()
for needle in [chr(0x2014), chr(0x2013), "/" + "Users/", "/" + "home/", "/" + "var/folders/"]:
    if needle in text:
        raise SystemExit(f"forbidden literal: {needle!r}")
PY
python3 - <<'PY'
from pathlib import Path
import re
text = Path("AGENTS.md").read_text()
patterns = [r"=[A-Za-z0-9_./+-]{24,}", r"token=[A-Za-z0-9._-]+", ("Bearer" + " ") + r"[A-Za-z0-9._-]+"]
for pattern in patterns:
    if re.search(pattern, text):
        raise SystemExit(f"secret-like literal matched: {pattern}")
named = [
    "ANTHROPIC" + "_API_KEY=",
    "OPENAI" + "_API_KEY=",
    "JWT" + "_PRIVATE_KEY=",
    "auth" + "Token=",
    "Bearer" + " ",
]
for needle in named:
    if needle in text:
        raise SystemExit(f"named secret marker matched: {needle!r}")
PY
```

For code changes, also run the narrowest relevant test command. Add broader test, build, or docs generation commands when the touched code affects shared runtime, public APIs, CLI output, generated references, SSR/RSC behavior, or transport behavior.

Before completion, report the verification commands and their results. If a command cannot run, report the blocker and the safest next step.
