# Suggested Commands for Veryfront Renderer

## Development

```bash
# Start development server with HMR
deno task dev

# Start renderer only (split mode)
deno task renderer

# Start proxy only (split mode)
deno task proxy

# Start combined server
deno task start
```

## Testing

```bash
# Run all tests (unit + integration)
deno task test

# Run unit tests only
deno task test:unit

# Run integration tests
deno task test:integration

# Run with coverage
deno task test:coverage
deno task coverage:report

# Run E2E tests
deno task test:e2e

# Run compiled binary E2E tests
deno task test:e2e:binary
```

## Code Quality

```bash
# Full verification (format + lint + typecheck + test)
deno task verify

# Quick verification (no tests)
deno task verify:quick

# Lint only
deno task lint

# Format code
deno task fmt

# Check formatting
deno task fmt:check

# Type check
deno task typecheck
```

## Build

```bash
# Build binary
deno task build

# Build npm package
deno task build:npm

# Create release
deno task release
```

## Utilities

```bash
# Run CLI commands
deno task cli <command>

# Start MCP server
deno task mcp

# Clean cache
deno task clean

# Check for circular dependencies
deno task check:circular

# Validate architecture
deno task validate:architecture
```


