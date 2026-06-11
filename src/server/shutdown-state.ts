/**
 * Explicit lame-duck shutdown state for the renderer.
 *
 * This is intentionally separate from the `serverInitialized` health flag,
 * which is also `false` during startup. Once SIGTERM is received the renderer
 * enters lame-duck mode: new agent-work requests are rejected with 503 so the
 * API gets a clean pre-side-effect failure it can retry against another
 * instance, while in-flight streams continue draining.
 */

let shuttingDown = false;

/** Marks the server as entering graceful shutdown (lame-duck mode). */
export function markServerShuttingDown(): void {
  shuttingDown = true;
}

/** Returns true once the server has started graceful shutdown. */
export function isServerShuttingDown(): boolean {
  return shuttingDown;
}

/** Test-only helper to reset lame-duck state between tests. */
export function __resetServerShuttingDownForTests(): void {
  shuttingDown = false;
}
