# Contributing to Veryfront

Thank you for your interest in contributing to Veryfront! This guide will help you get started with our single-package React meta-framework.

## Quick Start

### 1. Prerequisites

- **Deno 1.40+** - [Install Deno](https://deno.land/)
- **Git** - For version control

### 2. Setup (< 5 minutes)

```bash
# Clone the repository
git clone https://github.com/veryfront/veryfront.git
cd veryfront/packages/veryfront

# Run tests to verify setup
deno task test

# Run specific test suites
deno task test:integration
```

### 3. Project Structure

Veryfront is a **single-package framework** with modular architecture:

```
src/
├──  PUBLIC API (what users import)
│   ├── index.ts              → veryfront
│   ├── server/               → veryfront/server
│   ├── middleware/           → veryfront/middleware
│   └── react/components/     → veryfront/components
│
├──  FRAMEWORK CORE
│   ├── rendering/            → SSR, RSC, streaming, layouts
│   ├── routing/              → Route matching, API routes
│   ├── build/                → Bundling, compilation, SSG
│   ├── html/                 → HTML generation, hydration
│   ├── modules/              → Module loading, import maps
│   └── react/                → React integration, components
│
├──  INFRASTRUCTURE
│   ├── platform/             → Runtime adapters (Deno/Node/Bun/CF)
│   ├── security/             → CORS, CSP, input validation
│   ├── observability/        → Metrics, tracing
│   ├── core/                 → Shared (config, errors, types, utils)
│   └── types/                → Entity type definitions
│
└──  DEVELOPER TOOLS
    ├── cli/                  → CLI commands (dev, build)
    └── server/               → Dev server, HMR, production server
```

**See [src/NAVIGATION.md](/guides/routing/README.md) for detailed module navigation.**

## Development Workflow

### Running Tests

```bash
# Run all tests
deno task test

# Run integration tests only
deno task test:integration

# Run unit tests only
deno task test:unit

# Run specific module tests
deno task test src/rendering/

# Run with coverage
deno task test:coverage

# Generate coverage report
deno task coverage:report

# Advanced testing
deno task test:unsafe              # Fail-fast tests with coverage
deno task test:batches             # Run tests in batches
deno task test:coverage:unit       # Coverage for unit tests only
deno task test:coverage:integration # Coverage for integration tests only
deno task coverage:html            # Generate HTML coverage report
```

### Code Quality

```bash
# Type checking
deno task typecheck

# Linting
deno task lint

# Formatting
deno task fmt

# Check for banned imports
deno task lint:ban-deep-imports

# Advanced code quality
deno task check:circular              # Check for circular dependencies
deno task lint:ban-console            # Ensure no console.log in code
deno task lint:ban-internal-root-imports # Validate import patterns
deno task docs:check-links            # Validate documentation links
```

### Making Changes

1. **Create a branch**
   ```bash
   git checkout -b feature/my-feature
   # or
   git checkout -b fix/issue-123
   ```

2. **Make your changes**
   - Write tests first (TDD encouraged)
   - Follow existing code patterns
   - Add TypeScript types (avoid `any`)
   - Update module README if changing public API

3. **Run tests**
   ```bash
   deno task test
   ```

4. **Commit with clear message**
   ```bash
   git commit -m "feat(rendering): add streaming SSR support"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/my-feature
   ```

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `refactor`: Code refactoring
- `test`: Add/update tests
- `perf`: Performance improvement
- `chore`: Maintenance tasks

**Scopes:**
- Module names: `rendering`, `routing`, `build`, `platform`, `data`, `security`, etc.
- Areas: `cli`, `server`, `middleware`, `config`

**Examples:**
- `feat(rendering): add streaming SSR for React 18+`
- `fix(routing): resolve race condition in dynamic routes`
- `docs(core): add module architecture documentation`
- `refactor(build): simplify asset pipeline`

## Where Should My Code Go?

Use this decision tree:

### Core Modules (src/)

**→ `rendering/`** - Page rendering logic
- SSR, SSG, RSC rendering
- Layout system
- Render caching

**→ `routing/`** - URL routing
- Route matching and patterns
- API route handling
- Dynamic routes

**→ `build/`** - Build system
- Production builds
- Asset optimization
- MDX compilation

**→ `html/`** - HTML generation
- HTML shell generation
- Hydration scripts
- Meta tag processing

**→ `modules/`** - Module system
- Component loading
- Import map resolution
- React component registry

**→ `react/`** - React integration
- Framework components (Link, Head, MDXProvider)
- React version compatibility
- SSR adapters

**→ `platform/`** - Runtime abstraction
- Deno/Node/Bun/Cloudflare adapters
- File system abstraction
- HTTP server abstraction

**→ `security/`** - Security features
- CORS, CSP, security headers
- Input validation
- Sanitization

**→ `observability/`** - Monitoring
- Metrics collection
- Distributed tracing
- Performance monitoring

**→ `core/`** - Shared infrastructure
- Configuration system
- Error handling
- Utilities (logger, cache, paths)
- Shared types

**→ `middleware/`** - Middleware system
- Request/response pipeline
- Built-in middleware

**→ `data/`** - Data fetching
- Data fetcher
- Caching strategies
- Static data generation

**→ `cli/`** - Command-line interface
- Dev, build, preview commands
- CLI utilities

**→ `server/`** - Server implementations
- Dev server with HMR
- Production server
- Request handlers

**Still unsure?** Check existing code or ask in PR!

## Import Patterns

### Internal Imports (Within src/)

Use `@veryfront/` aliases for clean imports:

```typescript
// Core utilities
import { logger } from '@veryfront/utils';
import { VeryfrontError } from '@veryfront/errors';
import { defineConfig } from '@veryfront/config';

// Rendering
import { createRenderer } from '@veryfront/rendering';
import { wrapInHTMLShell } from '@veryfront/html';

// Platform
import { getAdapter } from '@veryfront/platform';

// Components
import { Link } from '@veryfront/components';

// Data fetching
import { notFound, redirect } from '@veryfront/data';
```

### Public API (What Users Import)

```typescript
// Users import from "veryfront"
import { Link, Head, defineConfig, OptimizedImage } from 'veryfront';
import { startUniversalServer } from 'veryfront/server';
```

### Import Rules

 **DO:**
- Use `@veryfront/` aliases for internal imports
- Use relative imports within same module
- Import from `veryfront` in examples and docs

 **DON'T:**
- Use deep imports (e.g., `@veryfront/rendering/ssr/internal/...`)
- Import from `src/` directly (use aliases)
- Mix different import styles

## Architecture Principles

### 1. Modular Design
Each module has a **single responsibility** and clear boundaries:
- `rendering/` - Only rendering logic
- `routing/` - Only route matching
- `data/` - Only data fetching

### 2. Platform Abstraction
The `platform/` layer provides unified APIs across runtimes:
```typescript
// Works on Deno, Node.js, Bun, Cloudflare Workers
import { fs, path } from '@veryfront/platform';
const content = await fs.readFile('page.tsx');
```

### 3. Dependency Flow
```
Application Layer (user code)
    ↓
Public API Layer (index.ts, server/, middleware/)
    ↓
Framework Core (rendering/, routing/, build/)
    ↓
Infrastructure (platform/, security/, core/)
    ↓
Runtime (Deno/Node.js/Bun/CF Workers)
```

### 4. Documentation Co-location
Each module has a README.md with:
- Purpose and scope
- Architecture diagram
- Key exports
- Usage examples
- Troubleshooting

**See `src/<module>/README.md` for details.**

## Testing Guidelines

### Test Coverage Requirements
- **Core modules**: ≥80% coverage
- **Critical paths**: ≥90% coverage (rendering, routing, security)
- **New features**: Must include tests

### Test Structure

```typescript
import { describe, it } from 'std/testing/bdd.ts';
import { expect } from 'std/expect/mod.ts';

describe('Router', () => {
  describe('route matching', () => {
    it('should match exact routes', () => {
      const router = new Router();
      router.add('/about', handler);

      const match = router.match('/about');
      expect(match).toBeDefined();
    });

    it('should match dynamic routes', () => {
      const router = new Router();
      router.add('/posts/:id', handler);

      const match = router.match('/posts/123');
      expect(match?.params.id).toBe('123');
    });
  });
});
```

### Integration Tests
- Located in `tests/integration/`
- Test cross-module behavior
- Verify user workflows
- Use `withTestContext()` helper for isolation

### Running Specific Tests

```bash
# Run tests for specific module
deno task test src/rendering/

# Run single test file
deno test --allow-all src/routing/matchers/route-matcher.test.ts

# Run tests matching pattern
deno test --allow-all --filter "SSR"
```

## Documentation

### Code Documentation
- Add JSDoc comments for public APIs
- Include usage examples in comments
- Explain "why" not just "what"
- Document edge cases and limitations

Example:
```typescript
/**
 * Renders a React component to HTML string with SSR.
 *
 * @param component - React component to render
 * @param options - Rendering options
 * @returns HTML string with hydration data
 *
 * @example
 * ```typescript
 * const html = await renderToString(<App />, {
 *   mode: 'production',
 *   enableStreaming: false,
 * });
 * ```
 */
export async function renderToString(
  component: ReactElement,
  options: RenderOptions
): Promise<string> {
  // ...
}
```

### Module README Updates
When changing a module's public API:
1. Update the module's README.md
2. Add examples for new features
3. Update "Key Exports" section
4. Add troubleshooting tips if needed

### Architecture Documentation
- Main architecture: [Architecture Guide](/guides/architecture/README.md)
- Code navigation: [src/NAVIGATION.md](/guides/routing/README.md)
- Module READMEs: `../../src/<module>/README.md`

## Getting Help

### Resources
- **Architecture**: [Architecture Guide](/guides/architecture/README.md)
- **Navigation Guide**: [src/NAVIGATION.md](/guides/routing/README.md)
- **Module Docs**: All modules have READMEs (15/15 documented)
- **Quick Start**: [Quick Start Guide](/learn/quickstart.md)
- **Introduction**: [Introduction](/learn/introduction.md)

### Questions?
- Check existing issues on GitHub
- Search discussions
- Ask in PR comments
- Tag maintainers (@username)

## Good First Issues

Look for issues labeled `good-first-issue` on GitHub:
- Clear, focused scope
- Good documentation
- Mentorship available
- Usually in: docs, tests, minor features

## Code Review Process

### What to Expect
1. **Automated checks** (CI)
   - Tests pass
   - Linting passes
   - Type checking passes
   - No banned imports

2. **Architecture review**
   - Follows module boundaries
   - Uses correct import patterns
   - Clear separation of concerns

3. **Code review**
   - Readable and maintainable
   - Follows existing patterns
   - Proper error handling
   - Performance considerations

4. **Documentation**
   - Code comments for complex logic
   - Module README updated if needed
   - Examples for new features

### Tips for Faster Review
- **Keep PRs focused** - One feature/fix per PR
- **Write clear PR description** - What, why, how
- **Add tests** - Demonstrates correctness
- **Update docs** - Keep docs in sync
- **Respond promptly** - Address feedback quickly
- **Request re-review** - After making changes

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation

## Testing
- [ ] Tests added/updated
- [ ] All tests passing
- [ ] Manual testing done

## Documentation
- [ ] Code comments added
- [ ] Module README updated (if applicable)
- [ ] Examples added (if new feature)
```

## Module-Specific Guidelines

### Rendering (`src/rendering/`)
- Maintain SSR/SSG/RSC compatibility
- Consider streaming performance
- Test with React 17/18/19
- Cache appropriately

### Routing (`src/routing/`)
- Support both static and dynamic routes
- Maintain security (path traversal, etc.)
- Test edge cases (trailing slashes, etc.)
- Consider performance for large route sets

### Build (`src/build/`)
- Optimize build times
- Support incremental builds
- Test with various project sizes
- Consider memory usage

### Platform (`src/platform/`)
- **Must test on all runtimes**: Deno, Node.js, Bun
- Abstract runtime-specific APIs
- Provide consistent interfaces
- Handle runtime detection gracefully

### Security (`src/security/`)
- Follow OWASP guidelines
- Test against common attacks (XSS, CSRF, etc.)
- Document security implications
- Add security tests

### React Components (`src/react/components/`)
- Support React 17/18/19
- Follow React best practices
- Optimize for SSR
- Consider accessibility

## Performance Considerations

- **Rendering**: Optimize hot paths, use caching
- **Routing**: O(1) or O(log n) route matching
- **Build**: Incremental builds, parallel processing
- **Memory**: Watch for leaks, use streaming when possible
- **Startup**: Lazy load when appropriate

## Security Best Practices

- **Input validation**: Sanitize all user input
- **XSS prevention**: Escape HTML, use CSP
- **CSRF protection**: Use tokens for state-changing operations
- **Path traversal**: Validate and normalize all paths
- **Dependency security**: Keep dependencies updated

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to make Veryfront better!

## Thank You!

Contributions are welcome. Submit code, documentation, bug reports, or feature requests via GitHub.

---

**Questions?** Open an issue or discussion on GitHub.
**Found a bug?** Please report it with reproduction steps.
**Have an idea?** Submit feature requests via GitHub.
