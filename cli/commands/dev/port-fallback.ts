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
 * True when `error` means "this host has no address in that family at all",
 * rather than "that port is taken".
 *
 * The two have to be told apart, because probing a family a host does not have
 * must not make every port look busy: an IPv4-only CI container or a machine
 * with IPv6 disabled would otherwise never find a free port to fall back to.
 */
export function isAddressFamilyUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Deno names EADDRNOTAVAIL "AddrNotAvailable"; EAFNOSUPPORT surfaces only in
  // the message. Node reports both through `code`.
  const code = (error as { code?: string }).code ?? "";
  const message = error.message.toLowerCase();
  return error.name === "AddrNotAvailable" ||
    code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT" ||
    message.includes("eaddrnotavail") || message.includes("eafnosupport") ||
    message.includes("assign requested address") ||
    message.includes("address family not supported");
}

/**
 * The loopback addresses a `veryfront dev` listener can land on.
 *
 * Which family a listener gets is decided by the runtime, not by the CLI: the
 * Deno HTTP adapter defaults to `LOCALHOST.IPV4`, while the Node adapter that
 * the published npm build runs defaults to the *name* `localhost`, which
 * resolves to `::1` first on any dual-stack host. That is why one `veryfront
 * dev` serves the app on `127.0.0.1:3000` but its MCP server - `--port + 2` -
 * on `[::1]:3002`.
 *
 * A probe that bound only IPv4 therefore reported IPv6-held ports as free, and
 * a second `veryfront dev` announced "Port 3000 is in use, using 3002 instead"
 * while 3002 was already reserved by the first instance's MCP server. Nothing
 * hard-failed only because the two listeners landed on different families.
 *
 * The literal addresses are probed rather than the name `localhost` because a
 * listen on a name binds just the first address it resolves to, which would
 * leave the other family unchecked exactly as before.
 */
const PROBE_HOSTNAMES: readonly string[] = [LOCALHOST.IPV4, LOCALHOST.IPV6];

/** What one bind-and-release attempt learned about a port on one address. */
type ProbeOutcome = "free" | "in-use" | "no-such-family";

function probeWithDeno(deno: typeof Deno, hostname: string, port: number): ProbeOutcome {
  try {
    deno.listen({ hostname, port }).close();
    return "free";
  } catch (error) {
    if (isPortInUseError(error)) return "in-use";
    if (isAddressFamilyUnavailableError(error)) return "no-such-family";
    throw error;
  }
}

async function probeWithNode(hostname: string, port: number): Promise<ProbeOutcome> {
  const net = await import("node:net");
  return await new Promise<ProbeOutcome>((resolve, reject) => {
    const server = net.createServer();
    server.unref?.();
    server.once("error", (error: unknown) => {
      if (isPortInUseError(error)) resolve("in-use");
      else if (isAddressFamilyUnavailableError(error)) resolve("no-such-family");
      else reject(error);
    });
    server.listen({ port, host: hostname, exclusive: true }, () => {
      server.close(() => resolve("free"));
    });
  });
}

/**
 * Binds `port` on every loopback family the dev server might use, and releases
 * it again, to see whether the dev server could have it.
 *
 * A port counts as available only when nothing holds it on *any* of those
 * addresses - see `PROBE_HOSTNAMES` for why one family is not enough. A family
 * the host does not have is skipped rather than counted as a collision.
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

  for (const hostname of PROBE_HOSTNAMES) {
    const outcome = deno
      ? probeWithDeno(deno, hostname, port)
      : await probeWithNode(hostname, port);
    if (outcome === "in-use") return false;
  }

  return true;
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
