# Task Completion Checklist

When completing a coding task in veryfront-renderer, run these checks:

## Before Committing

### 1. Format Code
```bash
deno task fmt
```

### 2. Run Linter
```bash
deno task lint
```

### 3. Type Check
```bash
deno task typecheck
```

### 4. Run Tests
```bash
# For quick feedback (unit tests only)
deno task test:unit

# For full validation
deno task test
```

## Quick Verification (No Tests)
```bash
deno task verify:quick
```
This runs: format check + lint + typecheck

## Full Verification
```bash
deno task verify
```
This runs: format check + lint + typecheck + all tests + E2E binary tests

## Architecture Validation
If changes affect module structure:
```bash
deno task validate:architecture
```

## Coverage Check
For significant changes:
```bash
deno task test:coverage
deno task coverage:report
```
Aim for >80% coverage.

## Common Issues to Check
1. **Import aliases**: Use `#veryfront/*`, not relative paths
2. **No circular deps**: Run `deno task check:circular` if unsure
3. **Env variables**: Set in test commands (see deno.json tasks)
4. **File paths**: Use platform-agnostic paths via `#veryfront/platform`
