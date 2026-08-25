# Veryfront CLI Style Guide

Design principles for CLI and TUI components. Inspired by [clig.dev](https://clig.dev/), Zen of Python, and Pydantic.

## Philosophy

```
Simple is better than complex.
Explicit is better than implicit.
Readability counts.
Errors should never pass silently.
If the implementation is hard to explain, it's a bad idea.
```

**Human-first**: Default output is for humans. Machine output (`--json`) is opt-in.

**Restrained**: Default output contains the current state and result, not decoration or coaching.

**Empathetic**: Anticipate confusion. Rewrite errors for humans, not developers.

**Progressive disclosure**: Keep identifiers, configuration detail, docs links, and stack traces behind
`--verbose`; keep machine detail in `--json`.

### Cloud Workflow

Keep preview and production as two explicit steps:

```text
veryfront push                                  # Update the stable main preview
veryfront push --branch feature-auth            # Update an isolated branch preview
veryfront deploy                                # Promote main to production
veryfront deploy --environment staging          # Promote main to another environment
```

`push` prints the Studio and Preview URLs. `deploy` prints the resolved environment URL. Do not
introduce hidden "last branch" inference or redundant confirmations; use `--branch`,
`--environment`, and `--dry-run` when the user needs an explicit target or preflight.

---

## Output Patterns

### Success States

```typescript
// DO: Clean, minimal success
console.log("  ✓ Deployed to " + brand("myapp.production.veryfront.com"));

// DON'T: Noisy, verbose
console.log(
  "[SUCCESS] Deployment completed successfully to https://myapp.production.veryfront.com at 2024-01-15T10:30:00Z",
);
```

### Progress & Status

```typescript
// Use brand spinner for loading
console.log("  " + brand("⠋") + " Building...");

// Use dim for secondary info
console.log("  " + dim("3 files changed"));
```

### Information Hierarchy

```
Primary   → plain text or bold()    // What matters most
Action    → brand()                 // Commands, URLs, active cursor/spinner
Secondary → dim() or muted()        // Supporting details and metadata labels
Success   → plain "✓"               // Completed actions
Error     → error("✗")              // Failed actions
```

---

## Spacing & Layout

**Always indent content by 2 spaces:**

```typescript
// DO
console.log();
console.log("  ✓ Done");
console.log();

// DON'T
console.log("✓ Done");
```

**Use blank lines to separate logical sections:**

```typescript
console.log(); // Space before
console.log("  " + bold("Title"));
console.log(); // Space after title
console.log("  " + dim("Description line 1"));
console.log("  " + dim("Description line 2"));
console.log(); // Space after section
```

---

## Error Messages

Follow Pydantic's approach: **specific, actionable, helpful**.

### Structure

```
✗ What failed
  Why it failed (if known)
  How to fix it
```

For simple validation errors, a single line is fine:

```typescript
console.log("  " + error("✗") + " Missing required flag: " + brand("--project"));
```

### Examples

```typescript
// DO: Specific and actionable
console.log("  " + error("✗") + " Project not found: " + brand("myapp"));
console.log();
console.log("  " + dim("Check the project slug or create it with:"));
console.log("  " + brand("veryfront new myapp"));

// DON'T: Vague and unhelpful
console.log("Error: ENOENT");
```

### Rewrite Caught Errors

```typescript
// Transform technical errors into human guidance
catch (e) {
  if (e.code === 'EACCES') {
    console.log("  " + error("✗") + " Permission denied: " + file);
    console.log();
    console.log("  " + dim("Try: chmod +w " + file));
  }
}
```

---

## Colors

### Brand Palette

```typescript
brand(); // rgb(238,178,146) - Pastel orange, commands, URLs, and active controls
success(); // rgb(34,197,94)  - Green, semantic health and availability values
error(); // rgb(239,68,68)  - Red, failures only
warning(); // rgb(234,179,8)  - Yellow, caution
muted(); // rgb(113,113,122) - Gray, secondary text
dim(); // ANSI dim, de-emphasized text
bold(); // ANSI bold
```

### Warning Example

```typescript
// Deprecation or non-fatal issue
console.log("  " + warning("!") + " Config key 'port' is deprecated, use 'server.port' instead");
```

### Usage Rules

1. **Use brand color for actions and active state, not labels or completed state**
2. **Red is reserved for errors** - never use for emphasis
3. **Yellow is for non-fatal warnings** - deprecations, risky config, recoverable issues
4. **Respect `NO_COLOR` environment variable**
5. **Disable colors when stdout is not a TTY**
6. **Do not use boxes, mascots, emoji, shimmer, or decorative dividers in standard output**

```typescript
import { isTTY } from "../ui/layout.ts";

// Colors auto-disable in non-TTY contexts
if (!isTTY()) {
  // Plain text fallback
}
```

---

## Icons & Symbols

| Symbol | Meaning          | Function                                |
| ------ | ---------------- | --------------------------------------- |
| `✓`    | Success/Complete | plain terminal text                     |
| `✗`    | Error/Failed     | `error("✗")`                            |
| `●`    | Active/Current   | `brand("●")`                            |
| `○`    | Inactive/Pending | `muted("○")`                            |
| `⠋⠙⠹⠸` | Loading spinner  | `createSpinner()` from `ui/progress.ts` |
| `❯`    | Selection cursor | `brand("❯")`                            |
| `▶`    | Collapsed        | `dim("▶")`                              |
| `▼`    | Expanded         | `dim("▼")`                              |

**No emoji in standard output** - use unicode symbols only.

---

## Help Text

- Support `-h`, `--help`, `veryfront help`, and `veryfront help <command>`.
- Show concise help when required input is missing; interactive-by-default commands may prompt.
- Lead with the common usage and examples, then list options and notes.
- Keep examples executable and show the long form of flags.
- Link to the relevant web documentation or support path.
- Do not print the full help page after a runtime error; show one actionable recovery hint.

### Conventions

| Flag            | Meaning                 |
| --------------- | ----------------------- |
| `-h, --help`    | Show help               |
| `-v, --version` | Show version            |
| `-y, --yes`     | Skip confirmations      |
| `-f, --force`   | Command-specific force  |
| `-n, --dry-run` | Preview without action  |
| `-q, --quiet`   | Minimal output          |
| `--json`        | Machine-readable output |
| `--no-input`    | Disable prompts         |
| `--no-color`    | Disable colors          |

---

## Interactive Prompts

### Selection UI

```
  Choose authentication method:

  ❯ Google
    GitHub
    Microsoft
    API Token
```

### Confirmation

Confirm destructive or difficult-to-reverse actions. Do not add a second confirmation when the
command verb already names a recoverable action, such as `push` or `deploy`; provide `--dry-run` for
users who want a preflight. Every prompt must have a flag or argument equivalent, and `--no-input`
must prevent all prompting.

### Progress

Use `createSpinner()` for animated loading states. It auto-degrades in non-TTY:

```typescript
import { createSpinner } from "../ui/progress.ts";

const spinner = createSpinner("Installing dependencies...");
// ... do work ...
spinner.success("Dependencies installed");
```

For multi-step operations, use `TaskList`:

```typescript
import { TaskList } from "../ui/progress.ts";

const tasks = new TaskList();
const buildIdx = tasks.add("Building project");
const deployIdx = tasks.add("Deploying");
tasks.start(buildIdx);
// ... build ...
tasks.complete(buildIdx);
tasks.start(deployIdx);
```

---

## TUI Patterns

### Screen Layout

```
  ✓ Server ready at http://localhost:3000
  ✓ MCP ready at http://localhost:3001/mcp

  Projects
  ❯ my-agent
    docs

  enter open  n create  ? help  ctrl+c exit
```

Keep status, content, and controls in a stable hierarchy. Do not put the primary TUI inside a
decorative box or reserve space for branding.

### Keyboard Shortcuts

| Key            | Action         |
| -------------- | -------------- |
| `Enter`        | Confirm/Submit |
| `Ctrl+C`       | Cancel/Exit    |
| `↑/↓` or `j/k` | Navigate       |
| `l`            | Toggle logs    |
| `q`            | Quit           |

---

## Machine Output

### stdout vs. stderr

**stdout** is for primary output (results, `--json` data). **stderr** is for human-facing side-effects (progress, spinners, errors). This ensures `--json` output stays parseable when piped:

```bash
veryfront deploy --branch main --env production --json | tail -n 1 | jq '.data.deploymentId'
```

Human progress must not be emitted on a `--json` path. Interactive spinners may update the TTY in
place; when stdout is piped, write progress to stderr and disable animation and ANSI control
sequences.

### JSON Mode

Commands that support `--json` should return a consistent envelope, or documented NDJSON events for
streaming operations:

```typescript
if (options.json) {
  // Success
  console.log(JSON.stringify({
    success: true,
    data: { url: "https://app.veryfront.com" },
  }));
  return;
}

// Error
console.log(JSON.stringify({
  success: false,
  error: { code: "PROJECT_NOT_FOUND", message: "Project 'myapp' not found" },
}));
```

### Exit Codes

| Code  | Meaning              |
| ----- | -------------------- |
| `0`   | Success              |
| `1`   | General error        |
| `2`   | Invalid usage        |
| `130` | Interrupted (Ctrl+C) |

---

## Quick Reference

```typescript
import { brand, dim, error, muted, warning } from "../ui/colors.ts";

// Success
console.log("  ✓ Done");

// Error
console.log("  " + error("✗") + " Failed");

// Info
console.log("  " + brand("●") + " " + "Running...");

// Warning
console.log("  " + warning("!") + " Deprecated option");

// Secondary
console.log("  " + dim("https://example.com"));

// Title
console.log("  " + bold(brand("Veryfront")));
```

---

## Checklist

Before shipping CLI output:

- [ ] Uses 2-space indent
- [ ] Blank lines separate sections
- [ ] Success uses `✓`, errors use `✗`
- [ ] Red only for actual errors
- [ ] Errors are actionable
- [ ] Errors and warnings use stderr
- [ ] Works without color (`NO_COLOR=1`)
- [ ] Animations are disabled outside a TTY
- [ ] `--no-input` prevents prompts
- [ ] Long operations show progress (`createSpinner` or `TaskList`)
- [ ] Ctrl+C exits cleanly
- [ ] `--json` flag returns `{ success, data?, error? }` envelope (if applicable)
