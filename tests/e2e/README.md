# E2E Tests

End-to-end tests for the Veryfront renderer using the compiled binary.

## Directory Structure

```
tests/e2e/
├── setup/              # Test infrastructure
│   ├── binary.ts       # Binary compilation management
│   ├── binary-server.ts # Server lifecycle management
│   ├── fixtures.ts     # Project fixture factories
│   ├── assertions.ts   # BDD-style assertion helpers
│   └── index.ts        # Main export (import from here)
├── features/           # Feature-focused tests
│   ├── framework-imports.test.ts  # veryfront/* imports
│   ├── layouts.test.ts            # Layout and app providers
│   ├── routing.test.ts            # File-based routing
│   ├── api-routes.test.ts         # API route handlers
│   └── mdx.test.ts                # MDX page rendering
├── regressions/        # Regression tests for fixed bugs
│   ├── README.md       # Template and guidelines
│   └── YYYY-MM-DD-*.test.ts
└── README.md           # This file
```

## Running Tests

### All E2E Tests (uses cached binary)

```bash
deno task test:e2e
```

### Specific Feature Tests

```bash
deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys tests/e2e/features/layouts.test.ts
deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys tests/e2e/features/routing.test.ts
```

### Regression Tests Only

```bash
deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys tests/e2e/regressions/
```

### Force Fresh Binary Compilation

```bash
VERYFRONT_BINARY_FRESH=1 deno task test:e2e
```

### Use Custom Binary Path

```bash
VERYFRONT_BINARY=/path/to/binary deno task test:e2e
```

## Writing Tests

### Using the Setup Infrastructure

```typescript
import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProject,
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchPage,
  layouts,
  pages,
  withServer,
} from "./setup/index.ts";

describe("My Feature", { sanitizeOps: false, sanitizeResources: false }, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("should do something", async () => {
    // Create a test project with fixtures
    const projectDir = await createProject("my-test", pages.withHead, {
      files: {
        "pages/layout.tsx": layouts.basic,
      },
    });

    // Run test with managed server lifecycle
    await withServer(projectDir, async (server) => {
      const { response, html } = await fetchPage(server, "/");

      // BDD-style assertions
      expectPage(html, response)
        .toRender()
        .withLayout()
        .withoutErrors();

      expectServer(server)
        .withoutErrors();
    });
  });
});
```

### Pre-built Fixtures

The `fixtures.ts` module provides pre-built page content:

```typescript
import { apiRoutes, appProviders, components, layouts, mdxContent, pages } from "./setup/index.ts";

// Pages
pages.basic; // Basic page with <div id="content">
pages.withHead; // Page with veryfront/head import
pages.withRouter; // Page with veryfront/router import
pages.clientComponent; // Client component with useState

// Layouts
layouts.basic; // Layout with header/footer
layouts.withHead; // Layout using Head component
layouts.withRouter; // Layout using useRouter

// API Routes
apiRoutes.json; // GET returning JSON
apiRoutes.customStatus; // Custom status code

// MDX Content
mdxContent.basic; // Basic markdown
mdxContent.withComponents; // MDX with React components
```

### Helper Functions

```typescript
import {
  createApiProject, // API routes
  createAppProject, // Project with app.tsx
  createDynamicRouteProject, // Dynamic [slug] routes
  createLayoutProject, // Project with layout.tsx
  createMdxProject, // MDX pages
  createNestedLayoutProject, // Nested layouts
} from "./setup/index.ts";
```

### BDD-style Assertions

```typescript
// Page assertions
expectPage(html, response)
  .toRender() // Assert 200 OK
  .withElement("id") // Assert element exists
  .withText("text") // Assert text content
  .withLayout() // Assert layout-wrapper exists
  .withoutErrors(); // Assert no module/React errors

// Server assertions
expectServer(server)
  .withoutErrors() // Assert no error logs
  .withoutReactErrors() // Assert no React errors
  .withoutModuleErrors(); // Assert no module errors

// API assertions
expectApi(response, json)
  .toBeOk() // Assert 200 OK
  .toBeJson() // Assert JSON content type
  .toHaveProperty("key", value); // Assert property
```

## Adding Regression Tests

When you fix a bug, add a regression test to prevent it from reoccurring:

1. Create a new file: `tests/e2e/regressions/YYYY-MM-DD-short-description.test.ts`
2. Include metadata (bug description, root cause, fix)
3. Create minimal reproduction scenario
4. Verify the fix works

See `tests/e2e/regressions/README.md` for the template.
