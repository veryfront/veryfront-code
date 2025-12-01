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

// Cache whether project has both react and react-dom
let projectHasReactDom: boolean | null = null;

/**
 * Check if the project has both react and react-dom installed.
 * This is used to determine whether to use project's React or bundled React
 * during SSR to avoid the "multiple React instances" error.
 */
async function checkProjectHasReactDom(): Promise<boolean> {
  if (projectHasReactDom !== null) {
    return projectHasReactDom;
  }

  if (!isNodeRuntime()) {
    projectHasReactDom = false;
    return false;
  }

  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const projectRequire = createRequire(pathToFileURL(process.cwd() + "/").href);

    // Check that BOTH can be resolved
    projectRequire.resolve("react");
    projectRequire.resolve("react-dom/server");
    projectHasReactDom = true;
    return true;
  } catch {
    projectHasReactDom = false;
    return false;
  }
}

/**
 * Get the path to the bundled React in the CLI's node_modules.
 * This is used when the project doesn't have react-dom installed.
 */
async function getBundledReactPath(subpath: string = ""): Promise<string | null> {
  if (!isNodeRuntime()) {
    return null;
  }

  try {
    const { createRequire } = await import("node:module");
    const cliRequire = createRequire(import.meta.url);
    const moduleName = subpath ? `react${subpath}` : "react";
    return cliRequire.resolve(moduleName);
  } catch {
    return null;
  }
}

export async function resolveReactImports(code: string, forSSR: boolean = false): Promise<string> {
  // For Node.js SSR, check if project has both react and react-dom
  if (isNodeRuntime() && forSSR) {
    const hasReactDom = await checkProjectHasReactDom();
    if (!hasReactDom) {
      // Project doesn't have react-dom, rewrite imports to use bundled React
      // This ensures consistency with the bundled react-dom/server used by renderer
      const bundledReact = await getBundledReactPath();
      const bundledJsxRuntime = await getBundledReactPath("/jsx-runtime");
      const bundledJsxDevRuntime = await getBundledReactPath("/jsx-dev-runtime");

      if (bundledReact && bundledJsxRuntime && bundledJsxDevRuntime) {
        const { pathToFileURL } = await import("node:url");
        const bundledImports: Record<string, string> = {
          "react/jsx-runtime": pathToFileURL(bundledJsxRuntime).href,
          "react/jsx-dev-runtime": pathToFileURL(bundledJsxDevRuntime).href,
          "react": pathToFileURL(bundledReact).href,
        };

        return replaceSpecifiers(code, (specifier) => {
          return bundledImports[specifier] || null;
        });
      }
    }
    // Project has react-dom, keep bare imports for Node.js to resolve
    return code;
  }

  // For Node.js (non-SSR), keep bare imports as-is (npm packages)
  if (isNodeRuntime()) {
    return code;
  }

  // For Deno/browser, transform to esm.sh URLs
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