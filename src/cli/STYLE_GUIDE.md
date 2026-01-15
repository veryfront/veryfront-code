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
console.log("  " + success("✓") + " Deployed to " + brand("myapp.veryfront.com"));

// DON'T: Noisy, verbose
console.log(
  "[SUCCESS] Deployment completed successfully to https://myapp.veryfront.com at 2024-01-15T10:30:00Z",
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
brand(); // #00A3F4 - Blue, primary actions and links
success(); // #22C55E - Green, completed states
error(); // #EF4444 - Red, failures only
warning(); // #EAB308 - Yellow, caution
muted(); // #71717A - Gray, secondary text
dim(); // ANSI dim, de-emphasized text
```

### Usage Rules

1. **Use color for meaning, not decoration**
2. **Red is reserved for errors** - never use for emphasis
3. **Respect `NO_COLOR` environment variable**
4. **Disable colors when stdout is not a TTY**

```typescript
import { isTTY } from "../utils/index.ts";

// Colors auto-disable in non-TTY contexts
if (!isTTY()) {
  // Plain text fallback
}
```

---

## Icons & Symbols

| Symbol | Meaning          | Function       |
| ------ | ---------------- | -------------- |
| `✓`    | Success/Complete | `success("✓")` |
| `✗`    | Error/Failed     | `error("✗")`   |
| `●`    | Active/Current   | `brand("●")`   |
| `○`    | Inactive/Pending | `muted("○")`   |
| `⠋⠙⠹⠸` | Loading spinner  | Animated       |
| `❯`    | Selection cursor | `brand("❯")`   |
| `▶`    | Collapsed        | `dim("▶")`     |
| `▼`    | Expanded         | `dim("▼")`     |

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

```typescript
// Show what's happening
console.log("  " + brand("⠋") + " Installing dependencies...");
console.log("  " + success("✓") + " Dependencies installed");
console.log("  " + brand("⠋") + " Building project...");
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

### JSON Mode

```typescript
if (options.json) {
  console.log(JSON.stringify({
    success: true,
    url: "https://app.veryfront.com",
  }));
  return;
}
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
import { brand, dim, error, muted, success } from "../ui/colors.ts";

// Success
console.log("  " + success("✓") + " Done");

// Error
console.log("  " + error("✗") + " Failed");

// Info
console.log("  " + brand("●") + " " + "Running...");

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
- [ ] Long operations show progress
- [ ] Ctrl+C exits cleanly
