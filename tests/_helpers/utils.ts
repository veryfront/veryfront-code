/**
 * Get a free port for testing.
 *
 * Uses a wide default range (10000-60000) to minimize collisions when running
 * tests in parallel across multiple worktrees or repo clones.
 *
 * Override via environment variables:
 *   TEST_PORT_MIN=15000 TEST_PORT_MAX=20000 deno task test
 */
export function getFreePort(start?: number, end?: number): number {
  // Allow env var override for parallel worktree isolation
  const minPort = start ?? parseInt(Deno.env.get("TEST_PORT_MIN") || "10000", 10);
  const maxPort = end ?? parseInt(Deno.env.get("TEST_PORT_MAX") || "60000", 10);

  // Use random port selection to avoid sequential reuse before OS releases ports
  // This helps when tests run quickly in sequence - previously used ports may still be in TIME_WAIT
  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Random port in range
    const port = Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;

    try {
      const listener = Deno.listen({ hostname: "127.0.0.1", port });
      listener.close();
      return port;
    } catch {
      // Port in use; try another random port
    }
  }

  throw new Error(`No free port found in range ${minPort}-${maxPort} after ${maxAttempts} attempts`);
}

export function withEnv(vars: Record<string, string>): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = Deno.env.get(k);
    Deno.env.set(k, v);
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  };
}

/**
 * Drain the event loop deterministically.
 *
 * Why stack Promise.resolve() and setTimeout(0)?
 * - Promise.resolve() flushes the microtask queue
 * - setTimeout(0) yields to the macrotask queue (timers, I/O)
 * Repeating this a couple of cycles ensures pending fetch/streams and
 * scheduler MessagePort tasks settle between test teardown and process exit.
 *
 * Increased defaults (5 cycles, 50ms delay) for better cleanup in batch test mode
 */
export async function drainEventLoop(cycles = 5, extraDelayMs = 50): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  if (extraDelayMs > 0) {
    await new Promise((r) => setTimeout(r, extraDelayMs));
  }
}

/**
 * Assert that no unexpected resources or ops remain. Retries with drains before failing.
 */
export async function assertDrained({
  retries = 3,
  delayMs = 10,
  allowResources = [/^stdin$/i, /^stdout$/i, /^stderr$/i],
  allowOpsDelta = 0,
}: {
  retries?: number;
  delayMs?: number;
  allowResources?: RegExp[];
  allowOpsDelta?: number;
} = {}): Promise<void> {
  const resourcesFn: (() => Record<number, string>) | null =
    typeof (Deno as any).resources === "function" ? (Deno as any).resources.bind(Deno) : null;
  const metricsFn: (() => { opsDispatched: number; opsCompleted: number }) | null =
    typeof (Deno as any).metrics === "function" ? (Deno as any).metrics.bind(Deno) : null;

  let lastResources: Record<number, string> = {};
  let lastPendingOps = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await drainEventLoop(2, delayMs);
    const res = resourcesFn ? resourcesFn() : {};
    // filter allowed resource names
    const leftoverEntries = Object.entries(res).filter(
      ([, name]) => !allowResources.some((re) => re.test(name)),
    );
    const m = metricsFn ? metricsFn() : { opsDispatched: 0, opsCompleted: 0 };
    const pending = Math.max(0, (m.opsDispatched ?? 0) - (m.opsCompleted ?? 0));

    if (leftoverEntries.length === 0 && pending <= allowOpsDelta) {
      return; // drained
    }
    lastResources = res;
    lastPendingOps = pending;
  }
  const filtered = Object.entries(lastResources).filter(
    ([, name]) => !allowResources.some((re) => re.test(name)),
  );
  throw new Error(
    `Event loop not fully drained after retries. resources=${
      JSON.stringify(
        filtered,
      )
    } pendingOps=${lastPendingOps}`,
  );
}
