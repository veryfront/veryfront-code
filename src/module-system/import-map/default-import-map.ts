import { getReactImportMap, REACT_DEFAULT_VERSION } from "@veryfront/utils";
import { isDeno, isNode } from "../../platform/compat/runtime.ts";
import type { ImportMapConfig } from "./types.ts";

const IS_TRUE_NODE = isNode && !isDeno;

function getNpmReactImportMap(version: string): Record<string, string> {
  return {
    react: `npm:react@${version}`,
    "react-dom": `npm:react-dom@${version}`,
    "react-dom/client": `npm:react-dom@${version}/client`,
    "react-dom/server": `npm:react-dom@${version}/server`,
    "react/jsx-runtime": `npm:react@${version}/jsx-runtime`,
    "react/jsx-dev-runtime": `npm:react@${version}/jsx-dev-runtime`,
    "react/": `npm:react@${version}/`,
  };
}

export function getDefaultImportMap(): ImportMapConfig {
  const reactVersion = REACT_DEFAULT_VERSION;

  if (!IS_TRUE_NODE) {
    return { imports: getNpmReactImportMap(reactVersion) };
  }

  const importMap = getReactImportMap(reactVersion);
  importMap["react/"] = `https://esm.sh/react@${reactVersion}/`;

  return { imports: importMap };
}
