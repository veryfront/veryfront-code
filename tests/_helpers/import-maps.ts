/**
 * Helper to generate import maps for tests.
 *
 * Uses esm.sh URLs so tests behave consistently across runtimes.
 *
 * @module
 */

export interface ReactImportMap {
  react: string;
  "react-dom": string;
  "react/jsx-runtime": string;
  "react-dom/client"?: string;
  "react-dom/server"?: string;
}

/**
 * Generate React import map appropriate for the current runtime.
 *
 * @param reactVersion - React version (default: "18.3.1")
 * @returns Import map with React dependencies
 */
export function createReactImportMap(reactVersion = "18.3.1"): ReactImportMap {
  return {
    react: `https://esm.sh/react@${reactVersion}?target=es2022`,
    "react-dom": `https://esm.sh/react-dom@${reactVersion}?target=es2022&external=react`,
    "react/jsx-runtime": `https://esm.sh/react@${reactVersion}/jsx-runtime?target=es2022`,
    "react-dom/client": `https://esm.sh/react-dom@${reactVersion}/client?target=es2022&external=react`,
    "react-dom/server": `https://esm.sh/react-dom@${reactVersion}/server?target=es2022&external=react`,
  };
}

/**
 * Generate a complete deno.json config for tests.
 *
 * @param reactVersion - React version (default: "18.3.1")
 * @returns JSON string for deno.json
 */
export function createTestDenoConfig(reactVersion = "18.3.1"): string {
  const importMap = createReactImportMap(reactVersion);

  return JSON.stringify(
    {
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "react",
      },
      imports: importMap,
    },
    null,
    2,
  );
}

/**
 * Generate import map for RSC (React Server Components) tests.
 *
 * @param reactVersion - React version (default: "19.1.1" for RSC support)
 * @returns Import map with RSC dependencies
 */
export function createRscImportMap(reactVersion = "19.1.1"): ReactImportMap & {
  "react-server-dom-webpack/client.browser"?: string;
  "react-server-dom-webpack/server.edge"?: string;
} {
  const baseMap = createReactImportMap(reactVersion);
  return {
    ...baseMap,
    "react-server-dom-webpack/client.browser":
      `https://esm.sh/react-server-dom-webpack@${reactVersion}/client.browser`,
    "react-server-dom-webpack/server.edge":
      `https://esm.sh/react-server-dom-webpack@${reactVersion}/server.edge`,
  };
}
