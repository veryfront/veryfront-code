/**
 * Turns the address a dev server bound into the URL to show for it.
 *
 * The name `localhost` is deliberately not used. It resolves to `::1` first on
 * a dual-stack host, while the dev server binds `LOCALHOST.IPV4` - so the
 * printed URL named an address the server was not listening on, and any process
 * that did hold `[::1]:port` answered in its place.
 */

import { LOCALHOST } from "veryfront/config";

/** Wildcards are bind targets, not somewhere to browse to. */
const LOOPBACK_FOR_WILDCARD: Readonly<Record<string, string>> = Object.freeze({
  "0.0.0.0": LOCALHOST.IPV4,
  "::": LOCALHOST.IPV6,
});

export function serverDisplayUrl(bindAddress: string, port: number): string {
  const host = LOOPBACK_FOR_WILDCARD[bindAddress] ?? bindAddress;
  // A literal IPv6 address needs brackets to be a valid URL authority.
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}
