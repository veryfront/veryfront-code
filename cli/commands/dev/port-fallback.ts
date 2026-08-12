/**
 * Dev server port selection.
 *
 * Port 3000 is the most contended port on a developer machine, and the
 * getting-started docs tell readers to run a bare `veryfront dev`. Rather than
 * hard-failing when that port is taken, scan forward for the first free one -
 * the same fallback the login callback server already uses.
 *
 * The scan probes ports by binding and releasing them, rather than by retrying
 * `startDevServer`: a failed `DevServer.start()` has already registered file
 * watchers and reload subscriptions that only `stop()` releases, so retrying it
 * would leak a watcher set per busy port.
 */

import { LOCALHOST } from "veryfront/config";
import { PORT_IN_USE } from "veryfront/errors";
import { getDenoRuntime } from "veryfront/platform";

/** How many consecutive ports to try before giving up. */
export const MAX_PORT_FALLBACK_ATTEMPTS = 10;

/** The highest port a TCP listener can bind. */
export const MAX_TCP_PORT = 65535;

/** True when `error` means "that port is taken", on either Deno or Node. */
export function isPortInUseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Deno: name is "AddrInUse", message "Address already in use (os error 48)".
  // Node: code is "EADDRINUSE".
  const code = (error as { code?: string }).code ?? "";
  const message = error.message.toLowerCase();
  return error.name === "AddrInUse" || code === "EADDRINUSE" ||
    message.includes("eaddrinuse") || message.includes("address already in use");
}

/**
 * Binds `port` and releases it again, to see whether the dev server could have it.
 *
 * The Deno runtime is read through `getDenoRuntime()` rather than through the
 * `Deno` global directly: dnt rewrites every bare `Deno.` reference in the
 * published npm build into `@deno/shim-deno`, whose Node-backed `listen()`
 * reads `server._handle.fd` - null under Deno's `node:net`. A CLI installed
 * with `deno install -gArf npm:veryfront` runs that build on a real Deno, so
 * the shim was reached and `veryfront dev` died on "Cannot read properties of
 * null (reading 'fd')" before it ever printed a URL.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  const deno = getDenoRuntime();
  if (deno) {
    try {
      deno.listen({ hostname: LOCALHOST.IPV4, port }).close();
      return true;
    } catch (error) {
      if (isPortInUseError(error)) return false;
      throw error;
    }
  }

  const net = await import("node:net");
  return await new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.unref?.();
    server.once("error", (error: unknown) => {
      if (isPortInUseError(error)) resolve(false);
      else reject(error);
    });
    server.listen({ port, host: LOCALHOST.IPV4, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Returns `requestedPort`, or the first free port after it.
 *
 * The scan stops at `MAX_TCP_PORT`: a runtime rejects port 65536 as an invalid
 * port rather than as an address in use, so scanning past the end of the range
 * would let that raw error escape instead of the `PORT_IN_USE` below.
 * `requestedPort` itself is always probed, so an out-of-range `--port` still
 * surfaces the runtime's own complaint about the value the user passed.
 *
 * Throws `PORT_IN_USE` - whose suggestion names `--port` - once the whole scan
 * range is taken.
 */
export async function findAvailablePort(
  requestedPort: number,
  maxAttempts: number = MAX_PORT_FALLBACK_ATTEMPTS,
  probe: (port: number) => Promise<boolean> = isPortAvailable,
): Promise<number> {
  const attempts = Math.max(1, maxAttempts);
  let lastPort = requestedPort;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const port = requestedPort + attempt;
    if (attempt > 0 && port > MAX_TCP_PORT) break;
    if (await probe(port)) return port;
    lastPort = port;
  }

  throw PORT_IN_USE.create({
    detail: `Ports ${requestedPort}-${lastPort} are all in use`,
    context: { requestedPort, lastPort, attempts },
  });
}
