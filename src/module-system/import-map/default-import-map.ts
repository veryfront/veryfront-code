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

/**
 * Get npm: mappings for common packages that need consistent module instances.
 * Using npm: ensures all imports resolve to the same module, avoiding
 * the React context mismatch issue when using different esm.sh URLs.
 */
function getCommonPackagesNpmMap(): Record<string, string> {
  return {
    // TanStack Query - commonly used, must be single instance for context to work
    "@tanstack/react-query": "npm:@tanstack/react-query@5",
    "@tanstack/query-core": "npm:@tanstack/query-core@5",
    // Theme providers
    "next-themes": "npm:next-themes@0.4",
    // Animation libraries
    "framer-motion": "npm:framer-motion@11",
  };
}

export function getDefaultImportMap(): ImportMapConfig {
  const reactVersion = REACT_DEFAULT_VERSION;

  if (!IS_TRUE_NODE) {
    // Deno: use npm: for React, common packages, and local exports for veryfront/*
    return {
      imports: {
        ...getNpmReactImportMap(reactVersion),
        ...getVeryfrontSsrImportMap(),
        ...getCommonPackagesNpmMap(),
      },
    };
  }

  const importMap = getReactImportMap(reactVersion);
  importMap["react/"] = `https://esm.sh/react@${reactVersion}/`;

  return { imports: importMap };
}
