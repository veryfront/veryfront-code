# Error Handling Module

## Purpose

The error-handling module provides a structured error management system for Veryfront, including error codes, categorization, user-friendly messages, and developer debugging tools.

## Scope

### What this module does:

- Error code registry and lookup
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
error-handling/
├── catalog/                # Error catalog and solutions
│   ├── factory.ts         # Error solution creation
│   ├── types.ts           # Catalog type definitions
│   └── index.ts          # Error code → solution mapping
├── user-friendly/         # User-facing error messages
│   ├── formatter.ts       # Message formatting
│   └── suggestions.ts     # Contextual suggestions
├── error-codes.ts         # VF### error code registry
├── stack-parser.ts        # Stack trace parsing
└── index.ts              # Module exports
```

## Error Code System

Veryfront uses structured error codes in the format `VF###`:

- **VF001-099**: Configuration errors
- **VF100-199**: Build errors
- **VF200-299**: Runtime errors
- **VF300-399**: Route errors
- **VF400-499**: Import/Module errors
- **VF500-599**: Server errors
- **VF600-699**: RSC/Client boundary errors
- **VF700-799**: Development errors
- **VF800-899**: Deployment errors
- **VF900-999**: General errors

## Key Exports

### Error Creation

- `createErrorSolution(code, config)` - Create complete error solution
- `createSimpleError(code, title, message, steps)` - Quick error creation
- `VError` - Base error class with metadata

### Error Lookup

- `getErrorSolution(code)` - Get solution for error code
- `inferErrorCode(error)` - Infer code from error message
- `getErrorDocsUrl(code)` - Get documentation URL

### Formatting

- `formatUserFriendlyError(error)` - Format for end users
- `formatDeveloperError(error)` - Format for developers
- `parseStackTrace(stack)` - Parse stack frames

## Dependencies

### Internal

- `shared/` - Utilities
- `observability/` - Logging integration

### External

- None (zero dependencies)

## Usage Examples

### Creating Errors

```typescript
import { createErrorSolution, ErrorCode } from "./error-handling";

// Detailed error with solution
const error = createErrorSolution(ErrorCode.CONFIG_NOT_FOUND, {
  title: "Configuration file not found",
  message: "Veryfront could not find veryfront.config.js in your project root",
  steps: [
    "Create veryfront.config.js in your project root",
    'Run "veryfront init" to generate a default configuration',
    "Or specify a custom config path with --config flag",
  ],
  example: 'export default { port: 3000, mode: "development" }',
  tips: [
    "Make sure you are in the correct directory",
    "Check file permissions",
  ],
});

// Simple error
const simpleError = createSimpleError(
  ErrorCode.BUILD_FAILED,
  "Build failed",
  "The build process encountered errors",
  ["Check error messages", "Fix TypeScript errors"],
);
```

### Error Solutions Catalog

```typescript
import { ErrorCatalog } from "./error-handling/catalog";

// Get all available solutions
const catalog: ErrorCatalog = {
  [ErrorCode.CONFIG_NOT_FOUND]: {
    code: "VF001",
    title: "Configuration file not found",
    message: "Veryfront could not find veryfront.config.js",
    steps: ["Create config file", "Run veryfront init"],
    docs: "https://veryfront.com/docs/errors/VF001",
  },
  // ... more solutions
};
```

### User-Friendly Formatting

```typescript
import { formatUserFriendlyError } from "./error-handling/user-friendly";

try {
  await buildProject();
} catch (error) {
  const friendly = formatUserFriendlyError(error);

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

### Developer Error Format

```typescript
import { formatDeveloperError } from "./error-handling/user-friendly";

const devError = formatDeveloperError(error);

console.error(devError.title);
console.error(devError.stack); // Formatted stack trace
console.error("Context:", devError.context); // Additional debug info
```

### Stack Trace Parsing

```typescript
import { parseStackTrace } from "./error-handling";

const parsed = parseStackTrace(error.stack);

parsed.frames.forEach((frame) => {
  console.log(`${frame.function} at ${frame.file}:${frame.line}:${frame.column}`);
});
```

### Error Code Inference

```typescript
import { inferErrorCode } from "./error-handling";

const error = new Error("Module not found: react");
const code = inferErrorCode(error);

console.log(code); // 'VF400' (MODULE_NOT_FOUND)
```

## Error Categories

### Configuration Errors (VF001-099)

```typescript
ErrorCode.CONFIG_NOT_FOUND; // VF001
ErrorCode.CONFIG_INVALID; // VF002
ErrorCode.CONFIG_PARSE_ERROR; // VF003
ErrorCode.CONFIG_VALIDATION_ERROR; // VF004
```

### Build Errors (VF100-199)

```typescript
ErrorCode.BUILD_FAILED; // VF100
ErrorCode.BUNDLE_ERROR; // VF101
ErrorCode.TYPESCRIPT_ERROR; // VF102
ErrorCode.MDX_COMPILE_ERROR; // VF103
```

### Runtime Errors (VF200-299)

```typescript
ErrorCode.HYDRATION_MISMATCH; // VF200
ErrorCode.RENDER_ERROR; // VF201
ErrorCode.COMPONENT_ERROR; // VF202
ErrorCode.PAGE_NOT_FOUND; // VF204
```

### Server Errors (VF500-599)

```typescript
ErrorCode.PORT_IN_USE; // VF500
ErrorCode.SERVER_START_ERROR; // VF501
ErrorCode.HMR_ERROR; // VF502
```

## Best Practices

### 1. Always Use Error Codes

```typescript
// Good
throw new VError(ErrorCode.CONFIG_NOT_FOUND, "Config file missing");

// Bad
throw new Error("Config file missing");
```

### 2. Provide Actionable Steps

```typescript
createErrorSolution(ErrorCode.PORT_IN_USE, {
  title: "Port already in use",
  message: "The specified port 3000 is already in use",
  steps: [
    "Stop the other process using port 3000",
    "Or use a different port with --port flag",
    "Find the process: lsof -ti:3000 | xargs kill",
  ],
});
```

### 3. Include Context

```typescript
throw new VError(ErrorCode.BUILD_FAILED, "Build failed", {
  file: "/path/to/problematic/file.tsx",
  line: 42,
  column: 10,
});
```

### 4. Link to Documentation

```typescript
// Automatically generates docs URL
const error = createErrorSolution(ErrorCode.RSC_PAYLOAD_ERROR, {
  title: "RSC Payload Error",
  message: "Failed to serialize React Server Component",
  // docs: 'https://veryfront.com/docs/errors/VF605' (auto-generated)
});
```

## Testing

```bash
# Run error handling tests
deno task test src/error-handling/

# Test factory functions
deno task test src/error-handling/catalog/factory.test.ts

# Test formatting
deno task test src/error-handling/user-friendly/
```

## Error Solution Template

```typescript
import { createErrorSolution, ErrorCode } from "./error-handling";

const solution = createErrorSolution(ErrorCode.MY_ERROR, {
  title: "Short descriptive title",
  message: "Detailed explanation of what went wrong",
  steps: [
    "First step to resolve",
    "Second step to resolve",
    "Third step if needed",
  ],
  example: `
    // Code example showing correct usage
    const correct = doSomethingRight()
  `,
  tips: [
    "Additional helpful tip",
    "Another consideration",
  ],
  relatedErrors: [ErrorCode.RELATED_ERROR_1, ErrorCode.RELATED_ERROR_2],
});
```

## Maintainer

**Team:** Platform Team
**Code Owners:** See CODEOWNERS file

## Related Modules

- [`observability/logging/`](../observability/logging/README.md) - Error logging
- [`server/handlers/response/`](../server/handlers/response/README.md) - HTTP error responses
- [`dev/error-overlay/`](../dev/error-overlay/README.md) - Development error UI

## Migration Guide

### From throw Error() to VError

```typescript
// Before
throw new Error("Something went wrong");

// After
import { ErrorCode, VError } from "./error-handling";
throw new VError(ErrorCode.UNKNOWN_ERROR, "Something went wrong", {
  context: {/* additional info */},
});
```

### Adding New Error Codes

1. Add to `ErrorCode` enum in `error-codes.ts`
2. Create solution in `catalog/index.ts`
3. Add tests in `tests/`
4. Document in error guide

## References

- [Error Handling Best Practices](https://veryfr

ont.dev/docs/errors)

- [Error Code Registry](https://veryfront.com/docs/errors/codes)
- [Troubleshooting Guide](https://veryfront.com/docs/troubleshooting)
