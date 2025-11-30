import { replaceSpecifiers } from "./lexer.ts";
import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";

// Detect if running in Node.js (vs Deno/browser)
// Use a function instead of module-level constant to ensure correct evaluation
// when bundled with esbuild's __esm lazy initialization pattern
export function isNodeRuntime(): boolean {
  // deno-lint-ignore no-explicit-any
  const _global = globalThis as any;
  return typeof Deno === "undefined" && typeof _global.process !== "undefined" && !!_global.process?.versions?.node;
}

export async function resolveReactImports(code: string): Promise<string> {
  // For Node.js, keep bare imports as-is (npm packages)
  // For Deno/browser, transform to esm.sh URLs
  if (isNodeRuntime()) {
    return code; // Node.js can import react, react-dom directly from npm
  }

  const reactImports: Record<string, string> = {
    "react/jsx-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime`,
    "react-dom/server": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client`,
    "react-dom": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}`,
    "react": `https://esm.sh/react@${REACT_DEFAULT_VERSION}`,
  };

  return replaceSpecifiers(code, (specifier) => {
    return reactImports[specifier] || null;
  });
}

export async function addDepsToEsmShUrls(code: string): Promise<string> {
  // Skip for Node.js - no esm.sh URLs needed
  if (isNodeRuntime()) {
    return code;
  }

  return replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("https://esm.sh/") && !specifier.includes("?") && !specifier.includes(`react@${REACT_DEFAULT_VERSION}`)) {
      return `${specifier}?deps=react@${REACT_DEFAULT_VERSION},react-dom@${REACT_DEFAULT_VERSION}`;
    }
    return null;
  });
}