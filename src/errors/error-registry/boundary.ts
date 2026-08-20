import { defineError } from "../types.ts";

export const CLIENT_BOUNDARY_VIOLATION = defineError({
  slug: "client-boundary-violation",
  category: "BOUNDARY",
  status: 400,
  title: "Client boundary rule violation",
  suggestion: "Add 'use client' directive or move code to a client component",
});

export const SERVER_ONLY_IN_CLIENT = defineError({
  slug: "server-only-in-client",
  category: "BOUNDARY",
  status: 400,
  title: "Server-only code in client component",
  suggestion: "Move server-only code to a server component",
});

export const CLIENT_ONLY_IN_SERVER = defineError({
  slug: "client-only-in-server",
  category: "BOUNDARY",
  status: 400,
  title: "Client-only code in server component",
  suggestion: "Move client-only code to a client component",
});

export const INVALID_USE_CLIENT = defineError({
  slug: "invalid-use-client",
  category: "BOUNDARY",
  status: 400,
  title: "Invalid 'use client' directive",
  suggestion: "Place 'use client' at the top of the file",
});

export const INVALID_USE_SERVER = defineError({
  slug: "invalid-use-server",
  category: "BOUNDARY",
  status: 400,
  title: "Invalid 'use server' directive",
  suggestion: "Place 'use server' at the top of the file or function",
});

export const RSC_PAYLOAD_ERROR = defineError({
  slug: "rsc-payload-error",
  category: "BOUNDARY",
  status: 500,
  title: "RSC payload serialization error",
  suggestion: "Ensure props are serializable (no functions, symbols, etc.)",
});

export const SSR_OUTPUT_LIMIT_EXCEEDED = defineError({
  slug: "ssr-output-limit-exceeded",
  category: "BOUNDARY",
  status: 500,
  title: "SSR output limit exceeded",
  suggestion: "Reduce the rendered HTML size or split the response into smaller pages",
});

export const LOCAL_INTEGRATION_REQUEST_INVALID = defineError({
  slug: "local-integration-request-invalid",
  category: "BOUNDARY",
  status: 400,
  title: "Local integration request is invalid",
  suggestion: "Pass only the documented tool arguments with their declared JSON types",
});

/** Registry fragment for BOUNDARY errors (slug → definition). */
export const BOUNDARY_REGISTRY = {
  "client-boundary-violation": CLIENT_BOUNDARY_VIOLATION,
  "server-only-in-client": SERVER_ONLY_IN_CLIENT,
  "client-only-in-server": CLIENT_ONLY_IN_SERVER,
  "invalid-use-client": INVALID_USE_CLIENT,
  "invalid-use-server": INVALID_USE_SERVER,
  "rsc-payload-error": RSC_PAYLOAD_ERROR,
  "ssr-output-limit-exceeded": SSR_OUTPUT_LIMIT_EXCEEDED,
  "local-integration-request-invalid": LOCAL_INTEGRATION_REQUEST_INVALID,
} as const;
