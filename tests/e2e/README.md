# E2E Tests

This directory currently contains multiple end-to-end harnesses:

- `deno task test:e2e:playwright`: Playwright smoke tests in `*.playwright.ts`
- `deno task test:e2e:rsc-browser`: browser-backed Deno regression for proxy-mode RSC hydration
- `deno task test:e2e:binary`: compiled-binary end-to-end coverage

`deno task test:e2e` remains as a compatibility alias for `deno task test:e2e:playwright`, but the explicit task names above are the preferred interface.

## Directory Structure

```
tests/e2e/
├── smoke.playwright.ts # Playwright smoke coverage against temp multi-project fixtures on the dev/proxy stack
├── setup/              # Test infrastructure
│   ├── binary.ts       # Binary compilation management
│   ├── binary-server.ts # Server lifecycle management
│   ├── fixtures.ts     # Project fixture factories
│   ├── assertions.ts   # BDD-style assertion helpers
│   └── index.ts        # Main export (import from here)
├── features/           # Deno-driven end-to-end feature tests
│   ├── framework-imports.test.ts  # veryfront/* imports
│   ├── layouts.test.ts            # Layout and app providers
│   ├── routing.test.ts            # File-based routing
│   ├── api-routes.test.ts         # API route handlers
│   └── mdx.test.ts                # MDX page rendering
├── regressions/        # Regression tests for fixed bugs across harnesses
│   ├── README.md       # Template and guidelines
│   ├── YYYY-MM-DD-*.test.ts
│   └── rsc-proxy-hydration.test.ts
└── README.md           # This file
```

## Running Tests

### Playwright Smoke Tests

```bash
deno task test:e2e:playwright
```

The Playwright harness provisions temporary `projects/<slug>` fixtures automatically from
`E2E_PROJECT` / `E2E_PROJECTS`, so it no longer depends on checked-in local projects.

### RSC Browser Regression

```bash
deno task test:e2e:rsc-browser
```

### Compiled Binary E2E

```bash
deno task test:e2e:binary
```

### Force Fresh Binary Compilation

```bash
VERYFRONT_BINARY_FRESH=1 deno task test:e2e:binary
```

### Use Custom Binary Path

```bash
VERYFRONT_BINARY=/path/to/binary deno task test:e2e:binary
```

### Run a Specific E2E Test File

```bash
PW_DISABLE_TS_ESM=1 npx playwright test tests/e2e/smoke.playwright.ts --config=tests/e2e/playwright.config.cjs
deno test --allow-all tests/e2e/features/layouts.test.ts
deno test --allow-all tests/e2e/regressions/rsc-proxy-hydration.test.ts
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
