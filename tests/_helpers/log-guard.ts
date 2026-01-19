// Log guard for tests: fail on unexpected logs
// Usage: import './log-guard.ts' in test files that want strict log checking

import { afterEach, beforeEach } from "@veryfront/testing/bdd";

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
  "Failed to build about:",
  "[SERVER] ERROR: Failed to build error:",
  "Failed to build error:",
  "[SERVER] ERROR: Server error for /",
  "Server error for /",
  "IsADirectory: Is a directory",
  "readfile",
  "[RENDERER] ERROR: renderToReadableStream failed",
  "renderToReadableStream failed",
  "[RENDERER] ERROR: SSR renderToString failed",
  "SSR renderToString failed",
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
  "Server error for /api/ext",
  "[API] fail to log load error",
  "[SERVER] ERROR: Failed to load API handler",
  "Failed to load API handler",
  "Remote import blocked by allow-list",
  "[prod] API handler failed",
  "[API] error log failed",
  "[SERVER] ERROR: [API] handler module failed to load:",
  "[API] handler module failed to load:",
  // API route build errors
  "[SERVER] ERROR: Failed to build api/echo:",
  "Failed to build api/echo:",
  "Page not found: api/echo",
  "[SERVER] ERROR: Failed to build api/hello:",
  "Failed to build api/hello:",
  "Failed to render TS/JS page: Script page must export a 'render(ctx)' function, a default function, or a string HTML",
  // RSC component errors
  "[SERVER] ERROR: [RSC] Render error:",
  "[RSC] Render error:",
  "[RENDERER] ERROR: Failed to load MDX module",
  "Failed to load MDX module",
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
  "React pipeable stream error",
  "[RENDERER] ERROR: String rendering fallback also failed",
  "String rendering fallback also failed",
  "[Bootstrap:Prod] Initialization failed",
  "[VERYFRONT] ERROR:",
  "VERYFRONT  ✖",
  // Pipeable stream errors
  "[RENDERER] ERROR: renderToPipeableStream failed",
  "renderToPipeableStream failed",

  // SSR renderToReadableStream errors (expected in error boundary tests)
  "[RENDERER] ERROR: SSR renderToReadableStream error",
  "SSR renderToReadableStream error",
  // FS integration fallback (expected when veryfront-api adapter fails)
  "[FSIntegration] Falling back to local filesystem",
  "[VERYFRONT] WARN:",
  "VERYFRONT  ▲",

  // Custom domain lookup without API token (expected in local/test environments)
  "[universal] Cannot look up custom domain - no API token available",

  // Node.js experimental feature warnings (expected when using --experimental-transform-types)
  "ExperimentalWarning: Transform Types is an experimental feature",

  // Bundler error logs (expected in tests that verify error handling)
  "BUNDLER    ✖ Failed to bundle MDX",
  "✖ Failed to bundle MDX",
  "Failed to bundle MDX",
  "BUNDLER    ✖ Failed to bundle script",
  "✖ Failed to bundle script",
  "Failed to bundle script",
  "BUNDLER    ✖ Bundle optimization failed",
  "✖ Bundle optimization failed",
  "Bundle optimization failed",

  // RSC stream handler errors (expected in tests that verify malformed JSON handling)
  "[RSC][dev] failed to parse final HTML payload",
  "failed to parse final HTML payload",

  // CORS validation errors (expected in tests that verify credential/wildcard handling)
  "[CORS] Cannot use credentials with wildcard origin",
  "[CORS] Origin validation function error",

  // Prefetch errors (expected in tests that verify error handling)
  "[PREFETCH] ERROR:",
  "Failed to prefetch",
  "Prefetch callback failed",

  // HMR/File watcher errors (expected when file watching is not available in some runtimes)
  "[HMR] Failed to setup file watcher",
  "Failed to watch",
  "Failed to setup file watcher",
  "Bun.watch is not available",

  // App route build errors (expected in tests that verify error handling)
  "Failed to build app route",
  "[SERVER] ERROR: Failed to build app route",

  // API Server page rendering errors (expected in tests that verify error handling)
  "Error rendering page data",
  "[SERVER] ERROR: Error rendering page data",

  // Renderer/server errors that are expected in various test scenarios
  "Page not found:",
  "Render failed unexpectedly",
  "Test error",

  // Bundle manifest errors (expected when manifest is missing)
  "[bundle-manifest]",

  // Module resolution errors in tests
  "Cannot find module",
  "Module not found",

  // Build/esbuild errors (expected in tests that verify error handling)
  "Build failed with",
  "build failed",

  // Embedded preset build errors
  "[embedded-build]",

  // MDX compilation errors (expected in tests that verify error handling)
  "[MDX Compiler] Compilation failed",
  "Compilation failed:",

  // Config generation warnings (expected when testing error handling)
  "Could not read base config",
  "Could not read deno.json",
  "Failed to parse deno.json",
  "ENOENT:",
  "no such file or directory",

  // Asset and static file warnings
  "public directory does not exist",
  "Failed to copy static assets",
  "handles missing public directory",

  // SSG/Build warnings
  "getStaticPaths",
  "Static path generation failed",

  // CLI command warnings
  "File already exists",
  "Directory already exists",

  // Token storage warnings
  "MemoryTokenAdapter",

  // CSS manifest warnings
  "CSS manifest not found",
  "Failed to parse CSS manifest",

  // Universal server warnings
  "not-found.tsx",
  "loading.tsx",
  "error.tsx",

  // ReloadNotifier errors (expected in tests that verify error handling)
  "[ReloadNotifier] Listener error",
  "Listener error",

  // HMR server errors (expected in port conflict tests)
  "HMR server failed to start",
  "Failed to start server. Is port",

  // CLI clean command warnings (expected behavior)
  "This will remove node_modules",
  "This will remove",

  // Request timeout warnings (expected in tests that simulate slow operations)
  "Request timed out",
  "[universal] Request timed out",
  "Server error:",

  // Root element not found (expected in prefetch tests without DOM)
  "Root element not found",
  "[RENDERER] ERROR: Root element not found",

  // Pipeline errors (expected in tests that verify error handling)
  "[PIPELINE:resolve-bare] Stage failed",
  "[RENDERER] ERROR: [PIPELINE:resolve-bare] Stage failed",

  // React config generation errors (expected in tests with malformed config)
  "Failed to detect React version from config",
  "[RENDERER] ERROR: Failed to detect React version from config",

  // Prefetch warnings (expected in tests without DOM)
  "[PREFETCH] WARN:",
  "document.head is not available",
  "skipping resource hint",
];

function isAllowed(args: unknown[]): boolean {
  // Join all arguments to get the full message
  const text = args.map((a) => String(a ?? "")).join(" ");
  return allowedWarnings.some((s) => text.includes(s));
}

let installed = false;

function installLogGuard(): void {
  if (installed) return;
  installed = true;

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
}

export function restoreLogs() {
  console.log = original.log;
  console.warn = original.warn;
  console.error = original.error;
  console.info = original.info;
  console.debug = original.debug;
  installed = false;
}

beforeEach(() => installLogGuard());
afterEach(() => restoreLogs());
