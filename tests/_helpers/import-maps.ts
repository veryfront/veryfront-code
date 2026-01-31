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

export function createReactImportMap(
  reactVersion: string = "18.3.1",
): ReactImportMap {
  const baseUrl = `https://esm.sh`;
  const target = `target=es2022`;
  const externalReact = `external=react`;

  return {
    react: `${baseUrl}/react@${reactVersion}?${target}`,
    "react-dom": `${baseUrl}/react-dom@${reactVersion}?${target}&${externalReact}`,
    "react/jsx-runtime": `${baseUrl}/react@${reactVersion}/jsx-runtime?${target}`,
    "react-dom/client": `${baseUrl}/react-dom@${reactVersion}/client?${target}&${externalReact}`,
    "react-dom/server": `${baseUrl}/react-dom@${reactVersion}/server?${target}&${externalReact}`,
  };
}

export function createTestDenoConfig(
  reactVersion: string = "18.3.1",
): string {
  return JSON.stringify(
    {
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "react",
      },
      imports: createReactImportMap(reactVersion),
    },
    null,
    2,
  );
}

export function createRscImportMap(
  reactVersion: string = "19.1.1",
): ReactImportMap & {
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
