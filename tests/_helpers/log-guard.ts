
const original = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};

const allowedWarnings: string[] = [
  "[prod] test page existence failed",
  "[prod] buildVersionedManifest failed",
  "[prod] OpenTelemetry span enrich failed",
  "[prod] metrics.incRequest failed",
  "[prod] rscActionGuard failed",
  "[prod] mock db import failed",
  "[AppRouter]",
  "Failed to discover components in",
  "Failed to discover routes in",
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
  "[TEST] cleanup: failed to remove app dir",
  "Request handler error:",
  "Middleware pipeline error:",
  "React streaming error Error: boom",
  "React streaming error",
  "[SERVER] ERROR: Server error for /api/ext",
  "[API] fail to log load error",
  "[SERVER] ERROR: Failed to load API handler",
  "Remote import blocked by allow-list",
  "[prod] API handler failed",
  "[API] error log failed",
  "[SERVER] ERROR: [API] handler module failed to load:",
  "[SERVER] ERROR: Failed to build api/echo:",
  "Page not found: api/echo",
  "[SERVER] ERROR: Failed to build api/hello:",
  "Failed to render TS/JS page: Script page must export a 'render(ctx)' function, a default function, or a string HTML",
  "[SERVER] ERROR: [RSC] Render error:",
  "[RENDERER] ERROR: Failed to load MDX module",
  "Error: boom",
  "Error: fail",
];

function isAllowed(args: unknown[]): boolean {
  const text = args.map((a) => String(a ?? "")).join(" ");
  return allowedWarnings.some((s) => text.includes(s));
}

console.warn = ((...args: unknown[]) => {
  if (!args.length || !isAllowed(args)) {
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
