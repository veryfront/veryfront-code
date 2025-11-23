# CLI Module

The CLI module provides the command-line interface for the Veryfront framework, including commands for development, building, code generation, and project diagnostics.

## Import Map Alias

```typescript
// Using import map alias (recommended)
import { handleBuildCommand, main } from "#cli";

// Using barrel file
import { handleBuildCommand, main } from "./cli/index.ts";
```

## Public API Overview

The CLI module exports:

- **`main()`** - Main CLI entry point
- **Command Handlers** - `handleBuildCommand()`, `handleDevCommand()`, `handleGenerateCommand()`, `routeCommand()`
- **Argument Parsing** - `parseCliArgs()`, `parseArrayArg()`
- **Utilities** - `exitProcess()`
- **Types** - `BuildCommandArgs`, `GenerateCommandArgs`, `ParsedArgs`

## File Structure

```
cli/
├── index.ts                # Public API (barrel file) ← USE THIS
├── README.md               # This file
├── main.ts                 # CLI entry point executable
├── index/                  # CLI core functionality
│   ├── index.ts           # Barrel exports
│   ├── cli-main.ts        # Main CLI logic
│   ├── arg-parser.ts      # Argument parsing
│   ├── command-router.ts  # Command routing
│   ├── build-handler.ts   # Build command handler
│   ├── dev-handler.ts     # Dev command handler
│   ├── generate-handler.ts # Generate command handler
│   └── types.ts           # Type definitions
├── commands/               # Command implementations
│   ├── analyze-chunks.ts
│   ├── build.ts (or build/)
│   ├── clean.ts
│   ├── dev.ts
│   ├── doctor/
│   ├── generate.ts
│   ├── init/
│   └── routes.ts
└── utils/                  # CLI utilities
    └── index.ts
```

## Quick Start

### Running the CLI

```bash
# Development server
deno task dev

# Production build
deno task build

# Show available routes
deno run --allow-all src/cli/main.ts routes

# Run diagnostics
deno run --allow-all src/cli/main.ts doctor
```

### Using Programmatically

```typescript
import { main } from "#cli";

// Run CLI with custom args
await main(["build", "--production"]);
```

## Available Commands

### `dev` - Development Server

Start the development server with hot module replacement (HMR).

```bash
deno task dev
# or
deno run --allow-all src/cli/main.ts dev

# Options:
#   --port <number>      Port to run on (default: 3000)
#   --host <string>      Host to bind to (default: localhost)
#   --open               Open browser automatically
```

### `build` - Production Build

Build the application for production deployment.

```bash
deno task build
# or
deno run --allow-all src/cli/main.ts build

# Options:
#   --outDir <path>      Output directory (default: dist/)
#   --analyze            Analyze bundle sizes
#   --minify             Minify output (default: true)
```

### `routes` - Show Routes

Display all discovered routes (Pages Router and App Router).

```bash
deno run --allow-all src/cli/main.ts routes

# Options:
#   --format <type>      Output format: table, json (default: table)
#   --filter <pattern>   Filter routes by pattern
```

### `generate` - Code Generation

Generate boilerplate code for common patterns.

```bash
deno run --allow-all src/cli/main.ts generate <type> <name>

# Examples:
#   generate page about           # Generate a page
#   generate component Header     # Generate a component
#   generate api users            # Generate an API route
```

### `clean` - Clean Build Artifacts

Remove build artifacts and caches.

```bash
deno run --allow-all src/cli/main.ts clean

# Options:
#   --all                Remove all caches including dependencies
```

### `doctor` - Run Diagnostics

Run diagnostic checks on your Veryfront project.

```bash
deno run --allow-all src/cli/main.ts doctor

# Checks:
#   - Project structure
#   - Configuration validity
#   - Dependency versions
#   - Runtime compatibility
```

### `analyze-chunks` - Bundle Analysis

Analyze production bundle chunks and sizes.

```bash
deno run --allow-all src/cli/main.ts analyze-chunks

# Options:
#   --limit <number>     Number of chunks to show (default: 10)
#   --json               Output as JSON
```

### `init` - Initialize Project

Create a new Veryfront project (interactive).

```bash
deno run --allow-all src/cli/main.ts init [project-name]

# Options:
#   --template <name>          Use a template: minimal, blog, docs, app, pages-router, app-router
#   --cache-backend <type>     Choose render cache backend (memory | filesystem | kv | redis)
#   --app-router / --pages-router  Shorthand for template selection
```

## Advanced Usage

### Custom Command Handlers

```typescript
import { parseCliArgs, routeCommand } from "#cli";

// Parse custom CLI arguments
const args = parseCliArgs(Deno.args);

// Route to appropriate command handler
await routeCommand(args);
```

### Argument Parsing

```typescript
import { parseArrayArg, parseCliArgs } from "#cli";

// Parse array arguments
const plugins = parseArrayArg("--plugin=foo,bar,baz");
// Result: ['foo', 'bar', 'baz']

// Parse all CLI args
const args = parseCliArgs(process.argv.slice(2));
// Result: { command: 'build', flags: { production: true }, args: [] }
```

### Build Command Programmatically

```typescript
import { type BuildCommandArgs, handleBuildCommand } from "#cli";

const args: BuildCommandArgs = {
  outDir: "./dist",
  minify: true,
  sourceMaps: true,
};

await handleBuildCommand(args);
```

## Testing

Tests are located in `tests/integration/cli/`:

```bash
deno test tests/integration/cli/
```

## Module Boundaries

The `cli/` module has established boundaries to ensure clean architecture and maintainability.

### Public API (via Barrel File)

**Always import from the barrel file** (`index.ts`):

```typescript
// CORRECT - Using import map alias
import { handleBuildCommand, main } from "#cli";

// ALSO CORRECT - Using barrel file directly
import { handleBuildCommand, main } from "./cli/index.ts";

// WRONG - Deep import bypassing barrel file
import { main } from "./cli/index/cli-main.ts";
```

### Internal Files (Do Not Import Directly)

These are implementation details and should not be imported from outside the module:

- `index/cli-main.ts` - Internal CLI logic
- `index/arg-parser.ts` - Internal argument parsing
- `index/command-router.ts` - Internal command routing
- `index/build-handler.ts` - Internal build command handler
- `index/dev-handler.ts` - Internal dev command handler
- `index/generate-handler.ts` - Internal generate command handler
- `commands/` - Internal command implementations
- `utils/` - Internal CLI utilities

### Enforcing Boundaries

Run the deep import linter to check for violations:

```bash
deno task lint:ban-deep-imports
```

This will detect any imports that bypass the barrel file and suggest corrections.

### Why Module Boundaries Matter

1. **Encapsulation**: Internal implementation can be refactored without breaking external code
2. **Clear API**: Public API is explicitly defined in one place
3. **Maintainability**: Changes to internal files don't affect consumers
4. **Discoverability**: Developers know exactly what's public by reading `index.ts`
5. **Type Safety**: Export types are properly managed and versioned

## Related Domains

- **server/**: Server implementations that use CLI commands
- **build/**: Build system used by CLI commands
- **config/**: Configuration loading and validation

## Contributing

When adding new commands:

1. Create command implementation in `commands/`
2. Add command export to `index/index.ts`
3. Update this README with command documentation
4. Add tests in `tests/integration/cli/`
