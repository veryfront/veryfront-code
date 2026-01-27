# Veryfront AI Flywheel Plan

**You describe it. Claude builds it.**

---

## User Flow

### 1. Install Plugin

```bash
claude plugin marketplace add veryfront/veryfront-claude-plugin
claude plugin install veryfront@veryfront-plugins
```

### 2. Start Claude with Prompt

```
> Build a dashboard with user stats and charts
```

### 3. Flywheel (Autonomous Loop)

```
┌─────────────────────────────────────────────────────────────┐
│                        FLYWHEEL                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  WRITE                                                      │
│  ├─ Creating app/page.tsx...                               │
│  ├─ Creating app/api/stats/route.ts...                     │
│  └─ Creating components/Chart.tsx...                       │
│                                                             │
│  RUN                                                        │
│  └─ Veryfront hot reloads (zero config)                    │
│                                                             │
│  OBSERVE                                                    │
│  ├─ vf_get_errors() → TypeError at Chart.tsx:12            │
│  ├─ vf_get_logs() → GET /api/stats → 500 (3ms)            │
│  └─ Screenshot → Red error overlay                         │
│                                                             │
│  FIX                                                        │
│  ├─ Reading Chart.tsx...                                   │
│  ├─ Error: data.map is not a function                      │
│  └─ Editing: Add null check for data                       │
│                                                             │
│  VERIFY                                                     │
│  ├─ vf_get_errors() → No errors                            │
│  ├─ vf_get_logs() → GET /api/stats → 200 (5ms)            │
│  └─ Screenshot → Dashboard renders correctly               │
│                                                             │
│  ↺ REPEAT until done                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4. Outcome

```
✓ Dashboard with user stats
✓ Interactive charts
✓ API endpoint /api/stats
✓ Zero errors
✓ Deployed to https://my-dashboard.veryfront.com

Done in 1 conversation.
```

---

## Vision

```
┌─────────┐    ┌─────────────────┐    ┌─────────┐
│  YOUR   │───▶│    FLYWHEEL     │───▶│ WORKING │
│  IDEA   │    │                 │    │   APP   │
└─────────┘    │ Claude + Veryfront │    └─────────┘
               │  write → run →  │
               │  observe → fix  │
               │     repeat      │
               └─────────────────┘
```

## Current State Analysis

### What Works

| Component      | Status    | Location                                         |
| -------------- | --------- | ------------------------------------------------ |
| ErrorCollector | ✅ Exists | `src/cli/mcp/error-collector.ts`                 |
| LogBuffer      | ✅ Exists | `src/cli/mcp/log-buffer.ts`                      |
| HTTP API       | ✅ Exists | `/_dev/api/live-errors`, `/_dev/api/live-logs`   |
| MCP Tools      | ✅ Exists | `vf_get_errors`, `vf_get_logs`, `vf_trigger_hmr` |
| HMR Server     | ✅ Works  | WebSocket on port+1                              |
| File Watcher   | ✅ Works  | Detects changes, triggers reload                 |

### What's Broken

| Gap                       | Location                 | Impact                       |
| ------------------------- | ------------------------ | ---------------------------- |
| Errors not collected      | `request-handler.ts:167` | `vf_get_errors` returns `[]` |
| Errors not collected      | `ssr-handler.ts:441`     | Runtime errors invisible     |
| Request logs not captured | `middleware.ts`          | `vf_get_logs` returns `[]`   |

## Architecture

```
Request Flow:
Browser → DevServer → RequestHandler → UniversalHandler → SSRHandler → Response
                                            ↓
                               Error? → ErrorOverlay.createHTML()
                                            ↓
                               ❌ getErrorCollector().add() NOT CALLED
```

## Fix Plan

### Fix 1: Connect Error Overlay to Error Collector

**File:** `src/server/dev-server/request-handler.ts`

```typescript
// BEFORE (line 163-175)
private handleServerError(error: unknown): Response {
  logger.error("Server error:", error);
  return new Response(
    ErrorOverlay.createHTML({
      type: "runtime",
      error: error as Error,
    }),
    { status: HTTP_SERVER_ERROR, ... }
  );
}

// AFTER
import { getErrorCollector } from "#veryfront/cli/mcp/error-collector.ts";

private handleServerError(error: unknown): Response {
  logger.error("Server error:", error);

  // ADD: Capture error for MCP
  const err = error as Error;
  getErrorCollector().addRuntimeError(
    err.message,
    err.stack,
    { source: "request-handler" }
  );

  return new Response(
    ErrorOverlay.createHTML({
      type: "runtime",
      error: err,
    }),
    { status: HTTP_SERVER_ERROR, ... }
  );
}
```

**File:** `src/server/handlers/request/ssr/ssr-handler.ts`

```typescript
// Around line 441
import { getErrorCollector } from "#veryfront/cli/mcp/error-collector.ts";

// When generating error overlay:
getErrorCollector().addRuntimeError(errorObj.message, errorObj.stack, {
  source: "ssr-handler",
  url: req.url,
});
const body = ErrorOverlay.createHTML({ error: errorObj, type: "runtime" });
```

### Fix 2: Connect Request Logger to Log Buffer

**File:** `src/server/dev-server/middleware.ts`

```typescript
import { getLogBuffer } from "#veryfront/cli/mcp/log-buffer.ts";

export function createRequestLoggerMiddleware(): Middleware {
  return async (req, next) => {
    const url = new URL(req.url);
    const start = performance.now();

    // ADD: Log to buffer
    getLogBuffer().info(`${req.method} ${url.pathname} started`, "http", {
      method: req.method,
      path: url.pathname,
    });

    const response = await next(req);
    const duration = Math.round(performance.now() - start);

    // ADD: Log completion to buffer
    getLogBuffer().info(
      `${req.method} ${url.pathname} → ${response.status} (${duration}ms)`,
      "http",
      {
        method: req.method,
        path: url.pathname,
        status: response.status,
        duration,
      },
    );

    return response;
  };
}
```

### Fix 3: Connect Transform Errors

**File:** `src/transforms/` (various transform files)

When esbuild/transform fails:

```typescript
import { getErrorCollector } from "#veryfront/cli/mcp/error-collector.ts";

try {
  // transform code
} catch (error) {
  getErrorCollector().addCompileError(
    error.message,
    filePath,
    error.line,
    error.column,
  );
  throw error;
}
```

## PROVEN WORKING (2026-01-28)

### Logs Captured

```bash
curl "http://localhost:8080/_dev/api/live-logs?limit=3"
{
  "logs": [
    { "message": "GET /broken → 500 (12ms)" },
    { "message": "GET /broken → 500 (8ms)" },
    { "message": "GET /broken → 200 (17ms)" }  # After fix!
  ]
}
```

### Errors Captured

```bash
curl "http://localhost:8080/_dev/api/live-errors"
{
  "errors": [{
    "type": "runtime",
    "message": "Intentional error for flywheel test",
    "stack": "Error: Intentional error...",
    "context": { "source": "ssr-handler", "url": "...", "slug": "broken" }
  }]
}
```

### Build Errors Captured

```bash
# Syntax error in page.tsx:
{
  "message": "Failed to load TSX/JSX component: Expected \")\" but found \"}\""
}
```

---

## Verification

After fixes, test the flywheel:

```bash
# 1. Start server
npx veryfront &

# 2. Create broken file
echo "export default function() { return <div" > app/broken/page.tsx

# 3. Check errors via MCP
curl "http://localhost:8080/_dev/api/live-errors"
# Should return: { errors: [{ type: "compile", message: "..." }] }

# 4. Make request
curl http://my-app.veryfront.me:8080/

# 5. Check logs via MCP
curl "http://localhost:8080/_dev/api/live-logs?limit=5"
# Should return: { logs: [{ message: "GET / → 200 (12ms)" }] }

# 6. Fix file
echo "export default function() { return <div>Fixed</div> }" > app/broken/page.tsx

# 7. Verify fixed
curl "http://localhost:8080/_dev/api/live-errors"
# Should return: { errors: [] }
```

## Success Criteria

1. `vf_get_errors` returns actual errors when they occur
2. `vf_get_logs` returns HTTP request logs
3. Errors clear when fixed (file watcher + cache invalidation)
4. Full flywheel works:

   ```
   > Create a todo app

   [WRITE] Creating files...
   [RUN] Veryfront hot reloads
   [OBSERVE] vf_get_errors → syntax error at line 12
   [FIX] Editing file...
   [OBSERVE] vf_get_errors → No errors
   [OBSERVE] Screenshot → Works!

   Done.
   ```

## Key Files to Modify

| File                                             | Change                                            |
| ------------------------------------------------ | ------------------------------------------------- |
| `src/server/dev-server/request-handler.ts`       | Add error collection in `handleServerError`       |
| `src/server/handlers/request/ssr/ssr-handler.ts` | Add error collection when rendering error overlay |
| `src/server/dev-server/middleware.ts`            | Add request logging to LogBuffer                  |
| `src/transforms/mdx/esm-module-loader/loader.ts` | Add transform error collection                    |
| `src/rendering/orchestrator/pipeline.ts`         | Add render error collection                       |

## Timeline

| Phase | Tasks                                                           |
| ----- | --------------------------------------------------------------- |
| P0    | Connect errors to ErrorCollector (request-handler, ssr-handler) |
| P0    | Connect requests to LogBuffer (middleware)                      |
| P1    | Connect transform errors                                        |
| P2    | Add structured context to all logs                              |
| P3    | Real-time streaming via WebSocket (future)                      |
