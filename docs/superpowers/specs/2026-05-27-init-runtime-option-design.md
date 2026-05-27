# `init --runtime` option design

Date: 2026-05-27
Status: Approved (brainstorming)
Supersedes: nothing
Related: `docs/superpowers/specs/2026-05-26-bun-template-smoke-design.md` (the
Bun-only smoke plan will be rewritten into a unified `template-smoke` plan
after this lands).

## Goal

Let users pick the JavaScript runtime their scaffolded project will run under
at `veryfront init` time. Today `init` always emits a Node-shape
`package.json` and runs `npm install` by default. After this change, the user
can explicitly choose `node` (default), `bun`, or `deno` via a CLI flag,
config field, or interactive wizard prompt, and the scaffold output and
next-steps reflect that choice.

## Scope

In scope:

- New `runtime` option on `init`, valid values: `node` | `bun` | `deno`,
  default `node`.
- Surfaces: `--runtime <value>` CLI flag, `runtime` field in the `--config`
  JSON file, new wizard prompt step.
- Scaffold delta:
  - All runtimes write `package.json` exactly as today.
  - `runtime === "deno"` additionally writes a thin `deno.json`.
- Install command and next-steps printer pick the runtime-matched commands.
- Tests covering the three runtimes end-to-end through `init`.

Out of scope (intentionally deferred):

- Adding `trustedDependencies` to the scaffolded `package.json` for Bun.
  If the upcoming template smoke surfaces an esbuild postinstall issue under
  Bun, that becomes a separate finding.
- A richer `deno.json` with explicit import maps (`npm:`/`jsr:`). Today we
  rely on `nodeModulesDir: "auto"` for parity with the npm path.
- Per-runtime variants under `cli/templates/files/<name>/`. Templates remain
  runtime-agnostic.
- Template smoke under bun/deno. Tracked as a separate plan that follows
  this one.

## Background

Relevant current code (read before reviewing this spec):

- `cli/commands/init/types.ts:14-28` — `InitOptions` interface (no `runtime`
  today).
- `cli/commands/init/handler.ts:18-79` — parses CLI args and optional config
  file into `InitOptions`. CLI flag beats config (`||=` pattern).
- `cli/commands/init/init-command.ts:179` — `initCommand(options)` entry.
  Calls `runInteractiveWizard` (line 215), then `createPackageJson` (line
  363), then `detectPackageManager` (line 420) and `installDependencies`
  (line 422). Next-steps printer at line 504 uses `getRunCommand(pm, "dev")`.
- `cli/commands/init/config-generator.ts:21-83` — `createPackageJson` writes
  a Node-shape `package.json` unconditionally. Unchanged in this design.
- `cli/commands/init/interactive-wizard.ts` — three prompts today:
  location/name (lines 50-105), template (lines 108-125), git (lines
  128-148). Returns `WizardResult` (lines 16-22).
- `cli/utils/package-manager.ts:88-116` — `detectPackageManager` already
  accepts a `preference` parameter that bypasses lockfile probing. `bun`
  and `deno` are already valid `PackageManager` enum values; install/run
  command tables (lines 118-146) already cover all three.

The relevant piece of existing surface this design hooks into:
`detectPackageManager`'s `preference` argument is the natural insertion
point — passing `runtime` as `preference` makes the rest of the install/run
machinery work without further changes.

## Public surface

### CLI flag

New flag on `init`: `--runtime <node|bun|deno>`. No short alias.

Parsing: `cli/commands/init/handler.ts` reads `args.runtime`. Invalid value
(or anything not in the enum) throws before any file is written:

> `Invalid --runtime value: "foo". Must be one of: node, bun, deno.`

### Config file

The optional `--config <file>` JSON gains an optional `runtime` field of the
same enum. CLI flag wins on collision (`||=`, matches `name`, `template`,
`integrations` precedence).

Validation runs in the same place as the CLI parse — a config with
`runtime: "foo"` errors out with the same message.

### Interactive wizard

A new prompt is inserted between template selection and the git prompt:

> What runtime should this project use?
>
> - Node.js (default)
> - Bun
> - Deno

Pre-selected to `node`. If the user passes `--runtime <value>` on the CLI,
`runInteractiveWizard` skips the prompt and threads the value through
unchanged (mirrors the existing `existingName` pattern for the location/name
prompt).

`WizardResult` gains a `runtime: "node" | "bun" | "deno"` field. All
existing cancel/non-TTY/skipped branches set `runtime: "node"`.

## Scaffold output

### All runtimes

`package.json` exactly as `createPackageJson` writes today. No new fields,
no new dependencies, no `trustedDependencies`.

### `runtime === "deno"` only

Additionally writes `deno.json` at the project root:

```json
{
  "nodeModulesDir": "auto",
  "tasks": {
    "dev": "deno run -A npm:veryfront dev",
    "build": "deno run -A npm:veryfront build",
    "preview": "deno run -A npm:veryfront preview"
  }
}
```

Rationale: `nodeModulesDir: "auto"` makes Deno read `package.json` and
materialize `node_modules/` on first task run, so we keep one dependency
declaration shared across all three runtimes. The tasks invoke
`npm:veryfront` so `deno task dev` resolves the framework via its npm
package (the same one `bun` and `node` use).

The file is written verbatim — no template substitution. If a future
template ships its own `deno.json` (none does today), the new
`createDenoConfig` function throws rather than silently overwriting.

## Wiring

### `InitOptions`

Add to `cli/commands/init/types.ts`:

```ts
export type InitRuntime = "node" | "bun" | "deno";

export interface InitOptions {
  // ...existing fields...
  /** Runtime for the scaffolded project. Defaults to "node". */
  runtime?: InitRuntime;
}
```

### Default resolution

In `initCommand` (in `init-command.ts`), after wizard resolution and before
file writes:

```ts
const runtime: InitRuntime = options.runtime ?? wizardResult?.runtime ?? "node";
```

(Order: explicit option > wizard answer > default. The wizard already
returns `runtime: "node"` in its skipped/non-TTY branches, so the chain
collapses to `node` for any non-interactive path that doesn't pass
`--runtime`.)

### Scaffold call

After the existing `createPackageJson` call, add:

```ts
if (runtime === "deno") {
  await createDenoConfig(projectDir);
}
```

### Install command

Replace `detectPackageManager(projectDir)` (line 420) with:

```ts
const pm = await detectPackageManager(projectDir, runtime);
```

The existing `preference` argument already takes priority over all other
detection signals (`cli/utils/package-manager.ts:92`). No changes to
`package-manager.ts`.

### Next-steps printer

Line 504 already reads `getRunCommand(pm, "dev")`. Since `pm` is now driven
by `runtime`, the printed dev command matches the user's choice for free.
Same for the install-command line (`getInstallCommand(pm)`, line 511).

## New files

- `cli/commands/init/deno-config-generator.ts` — single exported
  `createDenoConfig(projectDir: string): Promise<void>` that writes the
  thin `deno.json` shown above. ~25 LOC. Throws if `deno.json` already
  exists in `projectDir`.

## Modified files

- `cli/commands/init/types.ts` — add `InitRuntime` and the `runtime` field.
- `cli/commands/init/handler.ts` — parse `args.runtime` and `config.runtime`,
  validate the enum, thread through to `initCommand`.
- `cli/commands/init/init-command.ts` — resolve runtime default, conditional
  call to `createDenoConfig`, pass `runtime` to `detectPackageManager`.
- `cli/commands/init/interactive-wizard.ts` — new prompt step, new
  `runtime` field on `WizardResult`, threaded into all return statements.
  `runInteractiveWizard` signature gains an optional `presetRuntime?:
  InitRuntime` parameter; when provided, the prompt is skipped and the
  value is threaded into the returned `WizardResult`.

## Error handling

| Condition                                                | Behavior                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--runtime foo` (invalid)                                | `handler.ts` throws before any file write: "Invalid --runtime value: …"                                          |
| Config file has `runtime: "foo"`                         | Same error; validated when handler reads the config                                                              |
| `--runtime` and config both set                          | CLI wins (existing precedence pattern; CLI value short-circuits the `\|\|=` against the config-file default)     |
| `--runtime deno` + `--skip-install`                      | `deno.json` is still written; user runs `deno task dev` manually after `deno install` (printed in next-steps)    |
| `runtime === "deno"` and `deno.json` already in template | `createDenoConfig` throws: "Refusing to overwrite existing deno.json at <path>"                                  |
| Wizard cancelled                                         | Returns `cancelled: true` with `runtime: "node"`; `initCommand` exits before any file write (existing behavior)  |
| Non-TTY / CI environment                                 | `canRunWizard()` is false; `runInteractiveWizard` returns `skipped: true` with `runtime: "node"` — same as today |

## Testing

- `cli/commands/init/init-command.test.ts` (existing) — extend or add cases:
  - `--runtime node` (default path, no `deno.json` written).
  - `--runtime bun` — no `deno.json`; `pm` is `bun`; printed dev command is
    `bun dev`.
  - `--runtime deno` — `deno.json` written with the expected shape; `pm` is
    `deno`; printed dev command is `deno task dev`.
- `cli/commands/init/init.integration.test.ts` (existing, three end-to-end
  cases) — add `--runtime deno` case asserting both files land.
- `cli/commands/init/deno-config-generator.test.ts` (new) — asserts the
  written `deno.json` parses, has `nodeModulesDir: "auto"`, has the three
  tasks; asserts a second call against the same directory throws.
- `cli/commands/init/handler.test.ts` (or wherever handler arg-parsing is
  tested today) — add cases for the `--runtime` flag and for the config
  field, including the invalid-value path.
- `cli/commands/init/interactive-wizard.test.ts` — add the new prompt step
  to the existing wizard test; assert `presetRuntime` skips the prompt.

## Build sequence

Each step is independently mergeable in principle, but they stack in this
order for clarity:

1. Add `InitRuntime` to `types.ts`. Add `runtime` to `InitOptions`. Add
   handler parsing for `--runtime` and `config.runtime` with validation.
   Handler tests.
2. Add `createDenoConfig` + its unit test.
3. Add `WizardResult.runtime` (default `"node"` in every branch, no UI
   change yet). Wire `runtime` into `initCommand`: resolve from
   `options.runtime ?? wizardResult.runtime`, conditional call to
   `createDenoConfig`, pass to `detectPackageManager`. Integration tests
   for the three runtimes (driven by the option, not the wizard).
4. Add the wizard prompt UI and the `presetRuntime` parameter on
   `runInteractiveWizard`. Wizard tests.
5. Doc updates: README or `docs/reference/cli/init.md` (whichever exists)
   to mention the new flag.

## Risks and open items

- **Deno tasks invoking `npm:veryfront`.** The framework's npm-published bin
  wrapper uses `node:` imports and a native binary fallback. Deno supports
  `node:` imports natively, but the actual command path
  (`deno run -A npm:veryfront dev`) needs a quick local verification in the
  manual sweep portion of the follow-up template smoke plan. If that command
  shape doesn't work, the deno tasks degrade to using the local
  `node_modules/.bin/veryfront` directly: `deno run -A
  ./node_modules/.bin/veryfront dev`. Acceptable fallback; chosen here
  because `npm:veryfront` is the canonical Deno-flavored invocation.
- **Wizard length.** Adding a fourth prompt to the wizard slightly extends
  the onboarding flow. Pre-selecting `node` and skipping the prompt when
  `--runtime` is passed limits the cost.
- **Trusted dependencies / Bun ergonomics.** Out of scope here; if Bun
  scaffolds end up surfacing esbuild postinstall failures, that's a
  separate small commit to add `trustedDependencies` to the
  `createPackageJson` output.

## Non-goals to be explicit about

- We are not gating any feature behind runtime choice; all templates work
  with all three runtimes in principle.
- We are not changing `detectPackageManager`'s detection logic — only how
  it's called.
- We are not introducing a `RuntimeAdapter` abstraction. If per-runtime
  deltas grow beyond `package.json` + optional `deno.json`, that
  refactor is a separate concern.
