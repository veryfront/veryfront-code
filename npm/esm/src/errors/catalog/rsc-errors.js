import { ErrorCode } from "../error-codes.js";
import { createErrorSolution, createSimpleError } from "./factory.js";
export const RSC_ERROR_CATALOG = {
    [ErrorCode.CLIENT_BOUNDARY_VIOLATION]: createErrorSolution(ErrorCode.CLIENT_BOUNDARY_VIOLATION, {
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
    [ErrorCode.SERVER_ONLY_IN_CLIENT]: createSimpleError(ErrorCode.SERVER_ONLY_IN_CLIENT, "Server-only module in Client Component", "Cannot use server-only module in client code.", [
        "Move server logic to Server Component",
        "Use API routes for client data fetching",
        "Pass data as props from server",
    ]),
    [ErrorCode.CLIENT_ONLY_IN_SERVER]: createSimpleError(ErrorCode.CLIENT_ONLY_IN_SERVER, "Client-only code in Server Component", "Cannot use browser APIs in Server Component.", [
        "Add 'use client' directive",
        "Move client-only code to Client Component",
        "Use useEffect for client-side logic",
    ]),
    [ErrorCode.INVALID_USE_CLIENT]: createErrorSolution(ErrorCode.INVALID_USE_CLIENT, {
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
    [ErrorCode.INVALID_USE_SERVER]: createSimpleError(ErrorCode.INVALID_USE_SERVER, "Invalid 'use server' directive", "'use server' directive is not properly placed.", [
        "Place 'use server' at top of function",
        "Or at top of file for all functions",
        'Use exact string: "use server"',
    ]),
    [ErrorCode.RSC_PAYLOAD_ERROR]: createSimpleError(ErrorCode.RSC_PAYLOAD_ERROR, "RSC payload error", "Error serializing Server Component payload.", [
        "Ensure props are JSON-serializable",
        "Avoid passing functions as props",
        "Check for circular references",
    ]),
};
