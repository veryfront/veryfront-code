import { deleteEnv, getEnv, setEnv } from "../../src/platform/compat/process.ts";
import { isBun, isDeno } from "../../src/platform/compat/runtime.ts";

/**
 * Get a free port for testing.
 *
 * Uses OS-assigned port 0 to let the kernel pick a guaranteed-free ephemeral
 * port. This eliminates random collisions between parallel test workers.
 *
 * NOTE: A small TOCTOU window exists between releasing the port and the caller
 * binding to it. For zero-race port allocation, use {@link createMockServer}
 * which binds to port 0 and returns the actual assigned port.
 */
export async function getFreePort(): Promise<number> {
  if (isDeno) {
    // @ts-ignore - Deno global
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const { port } = listener.addr as { port: number };
    listener.close();
    return port;
  }

  if (isBun) {
    const bun = (globalThis as {
      Bun?: { serve: (options: Record<string, unknown>) => { stop: () => void; port: number } };
    })
      .Bun;
    if (!bun) throw new Error("Bun global not available");

    const server = bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("ok");
      },
    });

    const { port } = server;
    server.stop();
    return port;
  }

  const net = await import("node:net");
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref?.();
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1", exclusive: true }, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Create a mock HTTP server bound to an OS-assigned port.
 *
 * Eliminates the TOCTOU race in {@link getFreePort} by returning a server
 * that is *already listening*. The caller never needs to re-bind.
 *
 * @example
 * ```ts
 * const mock = createMockServer((req) => new Response("ok"));
 * try {
 *   const res = await fetch(mock.url);
 * } finally {
 *   mock.server.shutdown();
 * }
 * ```
 */
export function createMockServer(
  handler: (req: Request) => Response | Promise<Response>,
): { server: Deno.HttpServer; port: number; hostname: string; url: string } {
  // @ts-ignore - Deno global
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, handler);
  const { port, hostname } = server.addr as { port: number; hostname: string };
  return { server, port, hostname, url: `http://${hostname}:${port}` };
}

export function withEnv(vars: Record<string, string>): () => void {
  const prev: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(vars)) {
    prev[key] = getEnv(key);
    setEnv(key, value);
  }

  return () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
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
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (extraDelayMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, extraDelayMs));
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
  if (!isDeno) {
    await drainEventLoop(2, delayMs);
    return;
  }

  // deno-lint-ignore no-explicit-any
  const denoAny = Deno as any;

  const resourcesFn: (() => Record<number, string>) | null = typeof denoAny.resources === "function"
    ? denoAny.resources.bind(Deno)
    : null;

  const metricsFn: (() => { opsDispatched: number; opsCompleted: number }) | null =
    typeof denoAny.metrics === "function" ? denoAny.metrics.bind(Deno) : null;

  const isAllowedResource = (name: string): boolean => allowResources.some((re) => re.test(name));

  let lastResources: Record<number, string> = {};
  let lastPendingOps = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await drainEventLoop(2, delayMs);

    const resources = resourcesFn?.() ?? {};
    const leftoverEntries = Object.entries(resources).filter(([, name]) =>
      !isAllowedResource(name)
    );

    const metrics = metricsFn?.() ?? { opsDispatched: 0, opsCompleted: 0 };
    const pending = Math.max(0, (metrics.opsDispatched ?? 0) - (metrics.opsCompleted ?? 0));

    if (leftoverEntries.length === 0 && pending <= allowOpsDelta) return;

    lastResources = resources;
    lastPendingOps = pending;
  }

  const filtered = Object.entries(lastResources).filter(([, name]) => !isAllowedResource(name));
  throw new Error(
    `Event loop not fully drained after retries. resources=${
      JSON.stringify(filtered)
    } pendingOps=${lastPendingOps}`,
  );
}
