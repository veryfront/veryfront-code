/**
 * Platform-level constants that don't depend on configuration.
 * These are simple values used by HTTP servers and adapters.
 *
 * Note: config/defaults.ts re-exports DEFAULT_PORT for higher layers.
 */

export const DEFAULT_PORT = 3000;

export const LOCALHOST = {
  IPV4: "127.0.0.1",
  IPV6: "::1",
  HOSTNAME: "localhost",
} as const;
