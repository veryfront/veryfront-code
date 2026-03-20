---
name: vf-cli-output
description: Use when writing CLI commands, TUI output, terminal messages, error formatting, or machine-readable output in veryfront CLI
---

# Veryfront CLI Output Patterns

## Overview

Veryfront CLI follows a strict style guide for terminal output. Human-first by default, machine output via `--json`.

**Core principle:** Simple, empathetic, consistent. Red is only for errors.

## Output Helpers

```typescript
import { brand, dim, error, muted, success, warning } from "#cli/ui";

// Success
console.log("  " + success("✓") + " Done");

// Error
console.log("  " + error("✗") + " Failed to compile");
console.log("  " + dim("Try running: deno task typecheck"));

// Active/Info
console.log("  " + brand("●") + " Building project...");

// Inactive
console.log("  " + muted("○") + " Waiting");

// Warning
console.log("  " + warning("!") + " This option is deprecated");
```

## Formatting Rules

| Rule | Example |
|------|---------|
| 2-space indent for all content | `"  ✓ Done"` |
| Blank line between logical sections | Separate status groups |
| Red only for errors | Never red for warnings or info |
| Yellow for warnings | `warning("!")` |
| No emoji in standard output | Use text icons: `✓ ✗ ● ○ !` |
| Respect `NO_COLOR` env var | Colors auto-disable |

## Icons

| Icon | Meaning | Helper |
|------|---------|--------|
| `✓` | Success/complete | `success()` |
| `✗` | Error/failure | `error()` |
| `●` | Active/running | `brand()` |
| `○` | Inactive/pending | `muted()` |
| `!` | Warning/caution | `warning()` |

## Error Messages

Errors must be empathetic and actionable:

```typescript
// Good: specific, actionable
console.log("  " + error("✗") + " Config file not found");
console.log("  " + dim("Expected: veryfront.config.ts in project root"));
console.log("  " + dim("Run: veryfront init to create one"));

// Bad: vague, unhelpful
console.log("Error: config error");
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid usage (wrong args, missing required) |
| `130` | Interrupted (Ctrl+C) |

## Machine Output (`--json`)

```typescript
// Success
console.log(JSON.stringify({
  success: true,
  data: { url: "https://app.veryfront.com", projectId: "abc" }
}));

// Error
console.log(JSON.stringify({
  success: false,
  error: { code: "PROJECT_NOT_FOUND", message: "No project found in current directory" }
}));
```

**Rules for `--json`:**
- One JSON object per line
- Always include `success` boolean
- Success: `data` field with structured result
- Error: `error` field with `code` and `message`
- No colors, no icons, no formatting
- Stderr for progress/debug, stdout for result

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Red for warnings | Use `warning()` (yellow) |
| Missing indent | Always 2-space prefix |
| No actionable fix in error | Add `dim("Try: ...")` suggestion |
| Console emoji | Use text icons `✓ ✗ ● ○ !` |
| `process.exit(1)` without message | Print error first, then exit |
| Mixed stdout for progress + result | Progress to stderr, result to stdout |
