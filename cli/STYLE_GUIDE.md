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

**Conversational**: Users iterate through commands. Suggest corrections, show next steps.

**Empathetic**: Anticipate confusion. Rewrite errors for humans, not developers.

---

## Output Patterns

### Success States

```typescript
// DO: Clean, minimal success
console.log("  " + success("✓") + " Deployed to " + brand("myapp.production.veryfront.com"));

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
Primary   → brand() or bold()       // What matters most
Secondary → dim() or muted()        // Supporting details
Success   → success("✓")            // Completed actions
Error     → error("✗")              // Failed actions
```

---

## Spacing & Layout

**Always indent content by 2 spaces:**

```typescript
// DO
console.log();
console.log("  " + success("✓") + " Done");
console.log();

// DON'T
console.log(success("✓") + " Done");
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
brand(); // rgb(252,143,93) - Orange, primary actions and highlights
success(); // rgb(34,197,94)  - Green, completed states
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

1. **Use color for meaning, not decoration**
2. **Red is reserved for errors** - never use for emphasis
3. **Yellow is for non-fatal warnings** - deprecations, risky config, recoverable issues
4. **Respect `NO_COLOR` environment variable**
5. **Disable colors when stdout is not a TTY**

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
| `✓`    | Success/Complete | `success("✓")`                          |
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

### Concise Help (no args)

Show when command is run without required arguments:

```
  veryfront deploy

  Deploy your project to production.

  Usage: veryfront deploy [options]

  Examples:
    $ veryfront deploy
    $ veryfront deploy --env staging

  Run 'veryfront deploy --help' for all options.
```

### Full Help (--help)

```
  veryfront deploy
  Deploy your project to production.

  Usage: veryfront deploy [options]
  Options:
    -e, --env <name>      Environment (default: production)
    -b, --branch <name>   Branch to deploy
    -f, --force           Skip confirmation
    -n, --dry-run         Preview without deploying

  Examples:
    $ veryfront deploy
    $ veryfront deploy --env staging
    $ veryfront deploy --branch feature-x --dry-run

  Tips:
    • Use --dry-run to preview changes before deploying
    • Press Ctrl+C to cancel at any time
```

### Conventions

| Flag            | Meaning                 |
| --------------- | ----------------------- |
| `-h, --help`    | Show help               |
| `-v, --version` | Show version            |
| `-f, --force`   | Skip confirmations      |
| `-n, --dry-run` | Preview without action  |
| `-q, --quiet`   | Minimal output          |
| `--json`        | Machine-readable output |
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

```typescript
// DO: Clear question, obvious default
console.log("  " + muted("Deploy to production?") + " " + dim("[y/N]"));

// DON'T: Ambiguous
console.log("Continue? (yes/no/maybe)");
```

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
┌─────────────────────────────────────┐
│                                     │  ← Blank line
│  Title                              │  ← Bold brand
│                                     │  ← Blank line
│  Info Section                       │
│    key  value                       │
│    key  value                       │
│                                     │
│  ● Status message                   │
│                                     │
│  enter deploy  l logs  ctrl+c exit  │  ← Help bar
│                                     │
│  ▶ Logs (12)                        │  ← Collapsible
│                                     │
└─────────────────────────────────────┘
```

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
veryfront deploy --json 2>/dev/null | jq '.url'
```

Progress indicators (`createSpinner`) already write to stdout with ANSI clear sequences, so they self-clean in TTY mode and are suppressed in non-TTY mode.

### JSON Mode

Commands that support `--json` should return a consistent envelope:

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
import { brand, dim, error, muted, success, warning } from "../ui/colors.ts";

// Success
console.log("  " + success("✓") + " Done");

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
- [ ] Works without color (`NO_COLOR=1`)
- [ ] Long operations show progress (`createSpinner` or `TaskList`)
- [ ] Ctrl+C exits cleanly
- [ ] `--json` flag returns `{ success, data?, error? }` envelope (if applicable)
