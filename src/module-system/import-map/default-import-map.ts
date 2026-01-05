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

/**
 * Get veryfront/* import mappings for SSR (Deno runtime).
 * These map to local exports to avoid esm.sh's Deno shim which fails in actual Deno.
 */
function getVeryfrontSsrImportMap(): Record<string, string> {
  return {
    "veryfront/head": "veryfront/head",
    "veryfront/router": "veryfront/router",
    "veryfront/context": "veryfront/context",
    "veryfront/fonts": "veryfront/fonts",
  };
}

export function getDefaultImportMap(): ImportMapConfig {
  const reactVersion = REACT_DEFAULT_VERSION;

  if (!IS_TRUE_NODE) {
    // Deno: use npm: for React and local exports for veryfront/*
    return {
      imports: {
        ...getNpmReactImportMap(reactVersion),
        ...getVeryfrontSsrImportMap(),
      },
    };
  }

  const importMap = getReactImportMap(reactVersion);
  importMap["react/"] = `https://esm.sh/react@${reactVersion}/`;

  return { imports: importMap };
}
