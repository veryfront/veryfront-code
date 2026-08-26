import type { HostRuntime } from "#cli/host-runtime";
import { logWarning } from "#cli/utils";

const DECIMAL_PORT_PATTERN = /^\d+$/;
const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;

function parsePortValue(raw: string): number | undefined {
  const value = raw.trim();
  if (value === "" || !DECIMAL_PORT_PATTERN.test(value)) return undefined;

  const port = Number(value);
  return port >= MIN_TCP_PORT && port <= MAX_TCP_PORT ? port : undefined;
}

/** Read one strictly validated TCP port from the host environment. */
export function parsePortEnv(
  host: HostRuntime,
  name: string,
): number | undefined {
  const raw = host.env.get(name);
  if (raw === undefined || raw.trim() === "") return undefined;

  const port = parsePortValue(raw);
  if (port !== undefined) return port;

  logWarning(
    `${name}=${JSON.stringify(raw)} must be a complete decimal port from 1 to 65535; ignoring`,
  );
  return undefined;
}

/** Return whether one host environment value is a valid TCP port. */
export function isValidPortEnv(host: HostRuntime, name: string): boolean {
  const raw = host.env.get(name);
  return raw !== undefined && parsePortValue(raw) !== undefined;
}

/** Resolve PORT, then VERYFRONT_PORT, then the supplied default. */
export function resolveEnvironmentPort(
  host: HostRuntime,
  fallback: number,
): number {
  const veryfrontPort = parsePortEnv(host, "VERYFRONT_PORT") ?? fallback;
  return parsePortEnv(host, "PORT") ?? veryfrontPort;
}
