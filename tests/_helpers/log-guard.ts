// Global log guard for tests: fail on unexpected logs
// Usage: import './log-guard.ts' once in test entry or in individual files

const original = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};

// Allowlist of substrings that are acceptable in warnings/errors during tests
const allowedWarnings: string[] = [
  // Renderer attempts to discover reserved files; NotFound is expected
  "[prod] test page existence failed",
  // Manifest/graph is optional in Phase A
  "[prod] buildVersionedManifest failed",
  // Optional OTEL/metrics are best-effort
  "[prod] OpenTelemetry span enrich failed",
  "[prod] metrics.incRequest failed",
  // Optional guard hooks
  "[prod] rscActionGuard failed",
  // Optional mock db for demos
  "[prod] mock db import failed",
  // Dev-only route discovery chatter
  "[AppRouter]",
  // Component discovery in non-existent directory
  "Failed to discover components in",
  // Route discovery in non-existent directory
  "Failed to discover routes in",
  // Production build page discovery
  "Failed to build index: VeryfrontError: Page not found: index",
  "Failed to build index",
  "Page not found: broken",
  "Failed to build about: VeryfrontError: Page not found: about",
  "[SERVER] ERROR: Failed to build about:",
  "[SERVER] ERROR: Failed to build error:",
  "[SERVER] ERROR: Server error for /",
  "IsADirectory: Is a directory",
  "readfile",
  "[RENDERER] ERROR: renderToReadableStream failed",
  "[RENDERER] ERROR: SSR renderToString failed",
  "Expected component `UndefinedComponent` to be defined:",
  "SSR failed - no output",
  // Test cleanup messages that are safe to ignore
  "[TEST] cleanup: failed to remove app dir",
  // Dev server middleware errors (expected for some tests)
  "Request handler error:",
  "Middleware pipeline error:",
  // React streaming errors (expected in error boundary tests)
  "React streaming error Error: boom",
  "React streaming error",
  // Remote import security errors (expected in security tests)
  "[SERVER] ERROR: Server error for /api/ext",
  "[API] fail to log load error",
  "[SERVER] ERROR: Failed to load API handler",
  "Remote import blocked by allow-list",
  "[prod] API handler failed",
  "[API] error log failed",
  "[SERVER] ERROR: [API] handler module failed to load:",
  // API route build errors
  "[SERVER] ERROR: Failed to build api/echo:",
  "Page not found: api/echo",
  "[SERVER] ERROR: Failed to build api/hello:",
  "Failed to render TS/JS page: Script page must export a 'render(ctx)' function, a default function, or a string HTML",
  // RSC component errors
  "[SERVER] ERROR: [RSC] Render error:",
  "[RENDERER] ERROR: Failed to load MDX module",
  // RSC action parsing warnings (expected during validation tests)
  "[ActionParser] Zod validation failed",
  "[RSC] Failed to parse action request body",
  // RSC hydrator bundling errors (fallback to source is provided)
  "[RSC] Hydrator bundling failed:",
  // Test pages that intentionally throw
  "Error: boom",
  "Error: fail",
  // React key prop warnings (common in MDX rendering, harmless)
  "Each child in a list should have a unique",
  "Warning: Each child in a list",
  // React pipeable stream errors that wrap other allowed errors
  "[RENDERER] ERROR: React pipeable stream error",
  // String rendering fallback errors (expected when SSR fails)
  "[RENDERER] ERROR: String rendering fallback also failed",
  // Bootstrap initialization errors (expected during error tests)
  "[Bootstrap:Prod] Initialization failed",
  "[VERYFRONT] ERROR:",
  // Pipeable stream errors
  "[RENDERER] ERROR: renderToPipeableStream failed",
  // FS integration fallback (expected when veryfront-api adapter fails)
  "[FSIntegration] Falling back to local filesystem",
  "[VERYFRONT] WARN:",
];

function isAllowed(args: unknown[]): boolean {
  // Join all arguments to get the full message
  const text = args.map((a) => String(a ?? "")).join(" ");
  return allowedWarnings.some((s) => text.includes(s));
}

console.warn = ((...args: unknown[]) => {
  if (!args.length || !isAllowed(args)) {
    // Fail fast with explicit error
    throw new Error(`Unexpected console.warn in test: ${args.map((a) => String(a)).join(" ")}`);
  }
  return original.warn.apply(console, args as any);
}) as typeof console.warn;

console.error = ((...args: unknown[]) => {
  if (!args.length || !isAllowed(args)) {
    throw new Error(`Unexpected console.error in test: ${args.map((a) => String(a)).join(" ")}`);
  }
  return original.error.apply(console, args as any);
}) as typeof console.error;

export function restoreLogs() {
  console.log = original.log;
  console.warn = original.warn;
  console.error = original.error;
  console.info = original.info;
  console.debug = original.debug;
}
