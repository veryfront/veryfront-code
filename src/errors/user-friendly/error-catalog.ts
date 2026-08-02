import type { ErrorSolution as CatalogErrorSolution } from "../catalog/types.ts";

export type ErrorSolution = Pick<CatalogErrorSolution, "message" | "steps" | "example" | "docs">;

export const ERROR_SOLUTIONS: Readonly<Record<string, ErrorSolution>> = {
  "missing-config": {
    message: "No supported Veryfront configuration file found in the project directory",
    steps: [
      "Create veryfront.config.js, veryfront.config.ts, or veryfront.config.mjs in the project root",
      "Export a configuration object as the file's default export",
      "Start with minimal configuration and add only the settings you need",
    ],
    example: `export default {
  title: "My App",
  dev: { port: 3002 }
};`,
  },

  "invalid-config": {
    message: "Invalid configuration in veryfront.config.ts",
    steps: [
      "Check that your config exports a default object",
      "Ensure all values are valid JavaScript",
      "Check for missing brackets, quotes, or delimiters near the reported location",
    ],
    example: `export default {
  title: "My App",  // ✓ Valid string
  dev: {
    port: 3002,     // ✓ Valid number
    open: true,     // ✓ Trailing commas are valid
  }
};`,
  },

  "invalid-route": {
    message: "Invalid route file format",
    steps: [
      "Route files must export handler functions (GET, POST, etc.)",
      "Each handler must return a Response object",
      "Check for syntax errors in your route file",
    ],
    example: `// app/api/users/route.ts
export async function GET() {
  return Response.json({ users: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ created: true });
}`,
  },

  "client-boundary": {
    message: "Server-only code used in Client Component",
    steps: [
      "Move server-only imports to Server Components",
      "Use 'use server' directive for server actions",
      "Split component into server and client parts",
    ],
    example: `// ❌ Wrong - database import in client component
'use client';
import { db } from './database'; // Error!

import { db } from './database';
export default async function ServerComponent() {
  const data = await db.query('...');
  return <ClientComponent data={data} />;
}

'use client';
export default function ClientComponent({ data }) {
}`,
    docs: "https://veryfront.com/docs/errors/client-boundary-violation",
  },

  "import-not-found": {
    message: "Failed to resolve import",
    steps: [
      "Check that the file path is correct",
      "Ensure the module is installed or available",
      "For remote imports, check network connectivity",
      "Add missing imports to veryfront.config.ts importMap",
    ],
    example: `// veryfront.config.ts
resolve: {
  importMap: {
    imports: {
      "my-lib": "https://esm.sh/my-lib@1.0.0",
      "@/utils": "./src/utils/index.ts"
    }
  }
}`,
  },

  "port-in-use": {
    message: "Port is already in use",
    steps: [
      "Stop any other servers running on this port",
      "Use a different port with --port flag",
      "Check for zombie processes: lsof -i :PORT",
    ],
    example: `veryfront dev --port 3003`,
  },

  "build-failed": {
    message: "Build failed with errors",
    steps: [
      "Check the error messages above for details",
      "Fix any TypeScript or syntax errors",
      "Ensure all imports can be resolved",
      "Run 'veryfront doctor' to check system",
    ],
  },

  "missing-deps": {
    message: "Required dependencies not found",
    steps: [
      "Check that React is in your import map",
      "Ensure all peer dependencies are included",
      "Run 'veryfront doctor' to verify setup",
    ],
    example: `// Minimum required imports
"react": "https://esm.sh/react@19.1.1",
"react-dom": "https://esm.sh/react-dom@19.1.1"`,
  },
};

for (const solution of Object.values(ERROR_SOLUTIONS)) {
  if (solution.steps) Object.freeze(solution.steps);
  Object.freeze(solution);
}
Object.freeze(ERROR_SOLUTIONS);
