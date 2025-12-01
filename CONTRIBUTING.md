# Contributing to Veryfront

Thank you for your interest in contributing to Veryfront! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code Organization](#code-organization)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)
- [Module Guidelines](#module-guidelines)

## Code Organization

### Module Structure

Veryfront is organized into **16 core modules**. See [src/README.md](./src/README.md) for detailed module descriptions and [ARCHITECTURE.md](./ARCHITECTURE.md) for design philosophy and system architecture.

### Utils Pattern Guidelines

#### When to use `core/utils/`

Place utilities in `src/core/utils/` when they:
- Are used by **3 or more modules**
- Provide framework-level abstractions (logging, caching, hashing)
- Are platform-agnostic helpers
- Could be useful across the entire codebase

**Examples:**
```typescript
// core/utils/logger/  - Logging used everywhere
// core/utils/cache/   - Caching abstractions
// core/utils/hash-utils.ts - Hash functions used by multiple modules
```

#### When to use module-level `utils/`

Place utilities in `src/{module}/utils/` when they:
- Are **specific to that module's domain**
- Are only used within that module
- Provide module-specific transformations
- Would be confusing if placed in core

**Examples:**
```typescript
// ai/utils/          - AI-specific (tool registry, discovery)
// build/utils/       - Build-specific (asset utils, file types)
// rendering/utils/   - Rendering helpers (React, streams)
// server/handlers/utils/ - Handler utilities (content-types, etag)
```

#### Guidelines

1. **Default to core/utils/** if unsure (can be moved later)
2. **Never duplicate** - if a utility exists in core, use it
3. **Document** - add JSDoc comments explaining purpose and usage
4. **Test** - add unit tests for all utilities
5. **Export properly** - use barrel exports (`index.ts`)

### Import Strategy

**ALWAYS use import map aliases** for internal imports:

```typescript
// GOOD - Using import map alias
import { createRenderer } from "@veryfront/rendering";
import type { VeryfrontConfig } from "@veryfront/config";
import { computeHash } from "@veryfront/utils";

// BAD - Deep relative import
import { createRenderer } from "../../../../rendering/index.ts";
```

**Available aliases:**
- `@veryfront/types` - Core types
- `@veryfront/config` - Configuration
- `@veryfront/utils` - Shared utilities
- `@veryfront/errors` - Error handling
- `@veryfront/platform` - Platform adapters
- `@veryfront/security` - Security primitives
- `@veryfront/routing` - Routing system
- `@veryfront/middleware` - Middleware
- `@veryfront/modules` - Module system
- `@veryfront/data` - Data fetching
- `@veryfront/html` - HTML generation
- `@veryfront/react` - React integration
- `@veryfront/components` - React components
- `@veryfront/rendering` - SSR/RSC
- `@veryfront/build` - Build system
- `@veryfront/transforms` - Code transformations
- `@veryfront/server` - Servers
- `@veryfront/ai` - AI agent runtime
- `@veryfront/observability` - Metrics/tracing

### File Naming Conventions

- **Source files**: `kebab-case.ts`
- **Test files**: `kebab-case.test.ts` or `kebab-case_test.ts`
- **Type definition files**: `types.ts` or `{module}.d.ts`
- **Index files**: `index.ts` (barrel exports)

### Directory Structure

```
src/{module}/
├── subdirectory/
│   ├── feature.ts
│   ├── feature.test.ts
│   └── index.ts
├── README.md          ← Module documentation
├── index.ts           ← Public API (barrel export)
└── types.ts           ← Module-specific types
```

## Development Setup

### Prerequisites

- **Deno 1.40+** (recommended)
- **Node.js 18+** or **Bun 1.0+** (alternative runtimes)

### Installation

```bash
# Clone repository
git clone https://github.com/veryfront/veryfront.git
cd veryfront

# Install dependencies (Deno)
deno cache --reload src/index.ts

# Run tests
deno task test

# Type check
deno task typecheck
```

### Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes**
   - Follow code style guidelines
   - Add tests for new features
   - Update documentation

3. **Run tests**
   ```bash
   deno task test
   deno task typecheck
   deno task lint
   ```

4. **Commit changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## Code Style

### TypeScript Guidelines

1. **Use strict mode** - All code must pass strict TypeScript checks
2. **Explicit types** - Prefer explicit type annotations for public APIs
3. **No `any`** - Avoid `any` type unless absolutely necessary
4. **Const assertions** - Use `as const` for literal types
5. **Function signatures** - Document complex function signatures

Example:
```typescript
/**
 * Renders a page component to HTML
 * @param component - React component to render
 * @param props - Component props
 * @returns Rendered HTML string
 */
export async function renderPage(
  component: React.ComponentType<Props>,
  props: Props
): Promise<string> {
  // Implementation
}
```

### Import Order

Organize imports in this order:
1. External dependencies (Node.js, Deno, npm packages)
2. Framework internal imports (`@veryfront/*`)
3. Relative imports from same module

```typescript
// 1. External
import { join } from "node:path";
import * as React from "react";

// 2. Framework
import { createRenderer } from "@veryfront/rendering";
import type { VeryfrontConfig } from "@veryfront/config";

// 3. Relative
import { helperFunction } from "./helpers.ts";
import type { LocalType } from "./types.ts";
```

### Formatting

- **Line width**: 100 characters
- **Indent**: 2 spaces
- **Semicolons**: Yes
- **Quotes**: Double quotes
- **Trailing commas**: Yes (multi-line)

Run formatter:
```bash
deno task fmt
```

### Naming Conventions

- **Variables**: `camelCase`
- **Functions**: `camelCase`
- **Classes**: `PascalCase`
- **Interfaces**: `PascalCase`
- **Types**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE` (for true constants)
- **Private fields**: prefix with `_` (e.g., `_privateField`)

## Testing

### Test Structure

- **Unit tests**: Test individual functions/classes
- **Integration tests**: Test module interactions
- **E2E tests**: Test full application scenarios

### Writing Tests

```typescript
import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";

describe("MyModule", () => {
  describe("myFunction", () => {
    it("should handle basic case", () => {
      const result = myFunction("input");
      assertEquals(result, "expected output");
    });

    it("should handle edge case", () => {
      const result = myFunction("");
      assertEquals(result, "");
    });
  });
});
```

### Test Coverage

- **Minimum coverage**: 80% (enforced by CI)
- **Critical paths**: 100% coverage for security and core modules
- **Edge cases**: Always test error conditions and edge cases

Run tests with coverage:
```bash
deno task test:coverage
deno task coverage:report
```

## Pull Request Process

### Before Submitting

1. All tests pass
2. Type checking passes
3. Linting passes
4. Code is formatted
5. Documentation is updated
6. CHANGELOG is updated (for features/fixes)

### PR Title Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug in module
docs: update README
refactor: reorganize utils directory
test: add tests for rendering
chore: update dependencies
```

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Tests pass locally
- [ ] Documentation updated
```

### Code Review Process

1. **Automated checks** must pass (CI/CD)
2. **At least 1 approval** required from maintainers
3. **Address feedback** - respond to all review comments
4. **Squash commits** - maintainers will squash when merging

## Release Process

We use an automated script to handle versioning, testing, building, and publishing.

### Prerequisites

- Ensure you are on the `main` branch.
- Ensure your working directory is clean.
- Ensure you have `npm` authenticated (if publishing).

### Creating a Release

Use the `release` task to create a new version:

```bash
# Patch release (0.0.1 -> 0.0.2)
deno task release patch

# Minor release (0.1.0 -> 0.2.0)
deno task release minor

# Major release (1.0.0 -> 2.0.0)
deno task release major

# Specific version
deno task release 1.2.3
```

### What the script does

1.  **Runs Tests**: Executes `deno task test` to ensure stability.
2.  **Updates Version**: Bumps the version in `deno.json`.
3.  **Builds Package**: Runs `deno task build:npm` to generate the npm package.
4.  **Publishes**: Prompts to publish to npm (optional).

### Dry Run

You can preview the release process without making changes:

```bash
deno task release patch --dry-run
```

## Module Guidelines

### Adding a New Module

1. **Create directory structure**
   ```bash
   mkdir -p src/new-module
   touch src/new-module/index.ts
   touch src/new-module/README.md
   ```

2. **Add import map alias** in `deno.json`
   ```json
   {
     "@veryfront/new-module": "./src/new-module/index.ts",
     "@veryfront/new-module/": "./src/new-module/"
   }
   ```

3. **Create barrel export** (`index.ts`)
   ```typescript
   // Public API
   export { publicFunction } from "./feature.ts";
   export type { PublicType } from "./types.ts";
   ```

4. **Document module** in `README.md`
   ```markdown
   # New Module

   ## Purpose
   Brief description

   ## Usage
   Code examples

   ## API
   Reference documentation
   ```

5. **Update src/README.md** with module description in the Quick Module Overview table

### Module Dependencies

- **Avoid circular dependencies** - check with `deno task check:circular`
- **Minimize coupling** - modules should have clear, minimal dependencies
- **Document dependencies** - explain why each dependency is needed

### Barrel Exports

Always define a clear public API through `index.ts`:

```typescript
// GOOD - Explicit public API
export { renderPage } from "./renderer.ts";
export type { RenderOptions } from "./types.ts";

// BAD - Exposing everything
export * from "./renderer.ts";
export * from "./internal-helper.ts";
```

## Security

- **No secrets** in code or commits
- **Validate all input** at system boundaries
- **Sanitize output** to prevent XSS
- **Use CSP** and security headers
- **Review dependencies** for vulnerabilities

Report security issues to: security@veryfront.com

## Questions?

- **Documentation**: See [docs/](./docs/)
- **Architecture**: See [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Issues**: https://github.com/veryfront/veryfront/issues
- **Discussions**: https://github.com/veryfront/veryfront/discussions

Thank you for contributing to Veryfront!
