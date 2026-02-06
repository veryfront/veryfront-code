import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const RSC_ERROR_CATALOG: PartialErrorCatalog = {
  "client-boundary-violation": createErrorSolution("client-boundary-violation", {
    title: "Client/Server boundary violation",
    message: "Server-only code used in Client Component.",
    steps: [
      "Move server-only imports to Server Components",
      "Use 'use server' for server actions",
      "Split component into server and client parts",
    ],
    example: `// ✓ Correct pattern
import { db } from './database'
export default async function ServerComponent() {
  const data = await db.query('...')
  return <ClientComponent data={data} />
}

'use client'
export default function ClientComponent({ data }) {
  return <div>{data}</div>
}`,
  }),

  "server-only-in-client": createSimpleError(
    "server-only-in-client",
    "Server-only module in Client Component",
    "Cannot use server-only module in client code.",
    [
      "Move server logic to Server Component",
      "Use API routes for client data fetching",
      "Pass data as props from server",
    ],
  ),

  "client-only-in-server": createSimpleError(
    "client-only-in-server",
    "Client-only code in Server Component",
    "Cannot use browser APIs in Server Component.",
    [
      "Add 'use client' directive",
      "Move client-only code to Client Component",
      "Use useEffect for client-side logic",
    ],
  ),

  "invalid-use-client": createErrorSolution("invalid-use-client", {
    title: "Invalid 'use client' directive",
    message: "'use client' directive is not properly placed.",
    steps: [
      "Place 'use client' at the very top of file",
      "Must be before any imports",
      'Use exact string: "use client"',
    ],
    example: `'use client'  // Must be first line

import React from 'react'`,
  }),

  "invalid-use-server": createSimpleError(
    "invalid-use-server",
    "Invalid 'use server' directive",
    "'use server' directive is not properly placed.",
    [
      "Place 'use server' at top of function",
      "Or at top of file for all functions",
      'Use exact string: "use server"',
    ],
  ),

  "rsc-payload-error": createSimpleError(
    "rsc-payload-error",
    "RSC payload error",
    "Error serializing Server Component payload.",
    [
      "Ensure props are JSON-serializable",
      "Avoid passing functions as props",
      "Check for circular references",
    ],
  ),
};
