import { deleteEnv, getEnv, setEnv } from "../../src/platform/compat/process.ts";
import { isBun, isDeno } from "../../src/platform/compat/runtime.ts";

/**
 * Get a free port for testing.
 *
 * Uses a wide default range (10000-60000) to minimize collisions when running
 * tests in parallel across multiple worktrees or repo clones.
 *
 * Override via environment variables:
 *   TEST_PORT_MIN=15000 TEST_PORT_MAX=20000 deno task test
 */
export async function getFreePort(start?: number, end?: number): Promise<number> {
  // Allow env var override for parallel worktree isolation
  const minPort = start ?? parseInt(getEnv("TEST_PORT_MIN") || "10000", 10);
  const maxPort = end ?? parseInt(getEnv("TEST_PORT_MAX") || "60000", 10);

  // Use random port selection to avoid sequential reuse before OS releases ports
  // This helps when tests run quickly in sequence - previously used ports may still be in TIME_WAIT
  const maxAttempts = 100;
  const net = isDeno || isBun ? null : await import("node:net");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Random port in range
    const port = Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;

    // Try to bind to the port to check availability
    if (isDeno) {
      try {
        // @ts-ignore - Deno global
        const listener = Deno.listen({ hostname: "127.0.0.1", port });
        listener.close();
        return port;
      } catch {
        // Port in use; try another random port
      }
    } else if (isBun) {
      try {
        const bun = (globalThis as {
          Bun?: { serve: (options: Record<string, unknown>) => { stop: () => void } };
        }).Bun;
        if (!bun) {
          throw new Error("Bun global not available");
        }
        const server = bun.serve({
          port,
          hostname: "127.0.0.1",
          fetch() {
            return new Response("ok");
          },
        });
        server.stop();
        return port;
      } catch {
        // Port in use or server start failed; try another random port
      }
    } else {
      const isAvailable = await new Promise<boolean>((resolve) => {
        const server = net!.createServer();
        server.unref?.();
        server.once("error", () => {
          resolve(false);
        });
        server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
          server.close(() => resolve(true));
        });
      });
      if (isAvailable) {
        return port;
      }
    }
  }

  throw new Error(
    `No free port found in range ${minPort}-${maxPort} after ${maxAttempts} attempts`,
  );
}

export function withEnv(vars: Record<string, string>): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = getEnv(k);
    setEnv(k, v);
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) deleteEnv(k);
      else setEnv(k, v);
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
 * Note: This is Deno-specific. In Node.js/Bun, this is a no-op since they don't have
 * the same resource/ops tracking.
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
  // This is Deno-specific - skip in Node.js/Bun
  if (!isDeno) {
    await drainEventLoop(2, delayMs);
    return;
  }

  // deno-lint-ignore no-explicit-any
  const resourcesFn: (() => Record<number, string>) | null =
    typeof (Deno as any).resources === "function" ? (Deno as any).resources.bind(Deno) : null;
  // deno-lint-ignore no-explicit-any
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
