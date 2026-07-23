import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the client-boundary-violation slug. */
export const CLIENT_BOUNDARY_VIOLATION: RegisteredError = defineError({
  slug: "client-boundary-violation",
  category: "BOUNDARY",
  status: 400,
  title: "Client boundary rule violation",
  suggestion: "Add 'use client' directive or move code to a client component",
});

/** Registered error definition for the server-only-in-client slug. */
export const SERVER_ONLY_IN_CLIENT: RegisteredError = defineError({
  slug: "server-only-in-client",
  category: "BOUNDARY",
  status: 400,
  title: "Server-only code in client component",
  suggestion: "Move server-only code to a server component",
});

/** Registered error definition for the client-only-in-server slug. */
export const CLIENT_ONLY_IN_SERVER: RegisteredError = defineError({
  slug: "client-only-in-server",
  category: "BOUNDARY",
  status: 400,
  title: "Client-only code in server component",
  suggestion: "Move client-only code to a client component",
});

/** Registered error definition for the invalid-use-client slug. */
export const INVALID_USE_CLIENT: RegisteredError = defineError({
  slug: "invalid-use-client",
  category: "BOUNDARY",
  status: 400,
  title: "Invalid 'use client' directive",
  suggestion: "Place 'use client' at the top of the file",
});

/** Registered error definition for the invalid-use-server slug. */
export const INVALID_USE_SERVER: RegisteredError = defineError({
  slug: "invalid-use-server",
  category: "BOUNDARY",
  status: 400,
  title: "Invalid 'use server' directive",
  suggestion: "Place 'use server' at the top of the file or function",
});

/** Registered error definition for the rsc-payload-error slug. */
export const RSC_PAYLOAD_ERROR: RegisteredError = defineError({
  slug: "rsc-payload-error",
  category: "BOUNDARY",
  status: 500,
  title: "RSC payload serialization error",
  suggestion: "Ensure props are serializable (no functions, symbols, etc.)",
});

/** Registry fragment for BOUNDARY errors (slug → definition). */
export const BOUNDARY_REGISTRY: ErrorRegistryFragment<
  | "client-boundary-violation"
  | "server-only-in-client"
  | "client-only-in-server"
  | "invalid-use-client"
  | "invalid-use-server"
  | "rsc-payload-error"
> = Object.freeze(
  {
    "client-boundary-violation": CLIENT_BOUNDARY_VIOLATION,
    "server-only-in-client": SERVER_ONLY_IN_CLIENT,
    "client-only-in-server": CLIENT_ONLY_IN_SERVER,
    "invalid-use-client": INVALID_USE_CLIENT,
    "invalid-use-server": INVALID_USE_SERVER,
    "rsc-payload-error": RSC_PAYLOAD_ERROR,
  } as const,
);
