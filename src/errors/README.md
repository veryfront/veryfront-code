# Error Handling Module

## Purpose

The error-handling module provides a structured error management system for Veryfront, including slug-based error identity, RFC 9457 compliance, categorization, user-friendly messages, and developer debugging tools.

## Scope

### What this module does:

- Slug-based error registry and lookup
- RFC 9457 (Problem Details for HTTP APIs) compliance
- Error categorization (config, build, runtime, etc.)
- User-friendly error messages
- Error solutions and troubleshooting guides
- Stack trace parsing and formatting
- Error documentation URL generation

### What this module does NOT do:

- Error catching/boundary logic (see `components/ErrorBoundary`)
- HTTP error responses (see `server/handlers/response/`)
- Logging infrastructure (see `observability/logging/`)

## Architecture

```
errors/
├── catalog/                # Error catalog and solutions
│   ├── factory.ts         # Error solution creation
│   ├── types.ts           # Catalog type definitions
│   └── index.ts          # Slug → solution mapping
├── user-friendly/         # User-facing error messages
│   ├── formatter.ts       # Message formatting
│   └── suggestions.ts     # Contextual suggestions
├── error-registry.ts      # Slug-based error registry (source of truth)
├── types.ts               # Core types and VeryfrontError class
├── http-error.ts          # RFC 9457 HTTP response utilities
└── index.ts              # Module exports
```

## Slug-Based Error System

Veryfront uses slug-based error identity for stable, human-readable error identification:

### Error Categories

- **CONFIG**: Configuration errors (e.g., `config-not-found`, `config-invalid`)
- **BUILD**: Build errors (e.g., `build-failed`, `bundle-error`)
- **RUNTIME**: Runtime errors (e.g., `hydration-mismatch`, `render-error`)
- **ROUTE**: Route errors (e.g., `route-not-found`, `invalid-route`)
- **MODULE**: Import/Module errors (e.g., `module-not-found`, `import-error`)
- **SERVER**: Server errors (e.g., `port-in-use`, `server-start-error`)
- **BOUNDARY**: RSC/Client boundary errors (e.g., `rsc-payload-error`)
- **DEV**: Development errors (e.g., `hmr-error`, `hot-reload-failed`)
- **DEPLOY**: Deployment errors (e.g., `deploy-failed`, `asset-upload-error`)
- **AGENT**: AI agent errors (e.g., `agent-error`, `agent-timeout`)
- **GENERAL**: General errors (e.g., `unknown-error`, `internal-error`)

## Key Exports

### Error Registry

```typescript
import { CONFIG_NOT_FOUND, RENDER_ERROR } from "#veryfront/errors";

// Create an error instance
const error = CONFIG_NOT_FOUND.create({
  detail: "Could not find veryfront.config.js in /path/to/project",
  context: { projectDir: "/path/to/project" },
});

// Access error properties
console.log(error.slug); // "config-not-found"
console.log(error.category); // "CONFIG"
console.log(error.status); // 500
console.log(error.title); // "Configuration not found"
console.log(error.suggestion); // "Create veryfront.config.js..."
```

### VeryfrontError Class

```typescript
import { CONFIG_NOT_FOUND } from "#veryfront/errors";

// Preferred: use .create() from registry
const error = CONFIG_NOT_FOUND.create({
  detail: "Could not find config file",
  context: { projectDir: "/path/to/project" },
});

// Convert to RFC 9457 format
const response = error.toRFC9457();
// {
//   type: "https://veryfront.com/docs/errors/config-not-found",
//   title: "Configuration not found",
//   status: 404,
//   detail: "Could not find config file",
//   category: "CONFIG",
//   suggestion: "Create veryfront.config.js..."
// }

// Get documentation URL
console.log(error.getDocsUrl());
// "https://veryfront.com/docs/errors/config-not-found"
```

### Defining New Errors

```typescript
import { defineError } from "#veryfront/errors";

export const MY_NEW_ERROR = defineError({
  slug: "my-new-error",
  category: "RUNTIME",
  status: 500,
  title: "My new error occurred",
  suggestion: "Try doing X instead of Y",
});

// Use it
throw MY_NEW_ERROR.create({
  detail: "Specific details about what went wrong",
  context: { additionalInfo: "value" },
});
```

### RFC 9457 HTTP Responses

```typescript
import { createErrorResponse, createProblemResponse } from "#veryfront/errors";

// From a VeryfrontError
const response = createErrorResponse(error);

// Direct problem response
const problemResponse = createProblemResponse({
  slug: "validation-error",
  status: 400,
  title: "Validation failed",
  detail: "Email field is required",
});
```

## Error Catalog

The error catalog provides solutions and troubleshooting guidance:

```typescript
import { ERROR_CATALOG, getErrorSolution } from "#veryfront/errors";

// Get solution by slug
const solution = getErrorSolution("config-not-found");
if (solution) {
  console.log(solution.title);
  console.log(solution.message);
  console.log(solution.steps); // Array of fix steps
  console.log(solution.docs); // Documentation URL
}

// Search for errors
import { searchErrors } from "#veryfront/errors";
const results = searchErrors("config");
```

## User-Friendly Formatting

```typescript
import { formatUserError, identifyError } from "#veryfront/errors";

try {
  await buildProject();
} catch (error) {
  const friendly = formatUserError(error);

  console.error(friendly.title);
  console.error(friendly.message);

  if (friendly.steps) {
    console.error("\nHow to fix:");
    friendly.steps.forEach((step, i) => {
      console.error(`  ${i + 1}. ${step}`);
    });
  }

  if (friendly.docs) {
    console.error(`\nLearn more: ${friendly.docs}`);
  }
}
```

## Best Practices

### 1. Use the Error Registry

```typescript
// Good - uses registry for consistent error identity
import { CONFIG_NOT_FOUND } from "#veryfront/errors";
throw CONFIG_NOT_FOUND.create({ detail: "Config file missing" });

// Bad - raw Error without structure
throw new Error("Config file missing");
```

### 2. Provide Context

```typescript
import { BUILD_FAILED } from "#veryfront/errors";

throw BUILD_FAILED.create({
  detail: "TypeScript compilation failed",
  context: {
    file: "/path/to/problematic/file.tsx",
    line: 42,
    column: 10,
  },
});
```

### 3. Check Error Types by Slug

```typescript
import { VeryfrontError } from "#veryfront/errors";

if (error instanceof VeryfrontError && error.slug === "file-not-found") {
  // Handle file not found specifically
}
```

### 4. Use RFC 9457 for HTTP Responses

```typescript
import { createErrorHandler } from "#veryfront/errors";

const handler = createErrorHandler({ isDev: true });

app.use((error, req, res, next) => {
  const response = handler(error);
  res.status(response.status).json(response);
});
```

## Testing

```bash
# Run error handling tests
deno task test src/errors/

# Test registry
deno task test src/errors/error-registry.test.ts

# Test catalog
deno task test src/errors/catalog/
```

## Adding New Errors

1. Add to `error-registry.ts` using `defineError()`
2. Create solution in appropriate `catalog/*.ts` file
3. Add tests
4. Document in error guide

```typescript
// In error-registry.ts
export const MY_ERROR = defineError({
  slug: "my-error",
  category: "RUNTIME",
  status: 500,
  title: "My error title",
  suggestion: "How to fix this error",
});

// In catalog/runtime-errors.ts
"my-error": createErrorSolution({
  slug: "my-error",
  title: "My Error Title",
  message: "Detailed explanation",
  steps: ["Step 1", "Step 2"],
}),
```

## Maintainer

**Team:** Platform Team
**Code Owners:** See CODEOWNERS file

## Related Modules

- [`observability/`](../../observability/README.md) - Error logging and tracing
- [`server/`](../../server/README.md) - HTTP error responses

## References

- [RFC 9457 - Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
- [Error Handling Best Practices](https://veryfront.dev/docs/errors)
- [Troubleshooting Guide](https://veryfront.com/docs/troubleshooting)
