import { replaceSpecifiers } from "./lexer.ts";
import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";
import { isNodeRuntime } from "../../../platform/compat/runtime.ts";
import { cwd } from "../../../platform/compat/process.ts";

function getVeryfrontAIReactPath(subpath: string = ""): string {
  const currentDir = new URL(".", import.meta.url).pathname;
  const srcDir = currentDir.replace(/\/build\/transforms\/esm\/?$/, "");
  const modulePath = subpath || "index.ts";
  return `file://${srcDir}/ai/react/${modulePath}`;
}

let projectHasReactDom: boolean | null = null;

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
    const projectRequire = createRequire(pathToFileURL(cwd() + "/").href);

    projectRequire.resolve("react");
    projectRequire.resolve("react-dom/server");
    projectHasReactDom = true;
    return true;
  } catch {
    projectHasReactDom = false;
    return false;
  }
}

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
  const isNode = isNodeRuntime();

  // This is required because temp modules can't resolve bare imports
  if (isNode && forSSR) {
    const hasReactDom = await checkProjectHasReactDom();
    const { pathToFileURL } = await import("node:url");

    if (hasReactDom) {
      try {
        const { createRequire } = await import("node:module");
        const projectRequire = createRequire(pathToFileURL(cwd() + "/").href);

        const projectImports: Record<string, string> = {
          "react/jsx-runtime": pathToFileURL(projectRequire.resolve("react/jsx-runtime")).href,
          "react/jsx-dev-runtime":
            pathToFileURL(projectRequire.resolve("react/jsx-dev-runtime")).href,
          "react": pathToFileURL(projectRequire.resolve("react")).href,
        };

        return replaceSpecifiers(code, (specifier) => {
          return projectImports[specifier] || null;
        });
      } catch {
      }
    }

    const bundledReact = await getBundledReactPath();
    const bundledJsxRuntime = await getBundledReactPath("/jsx-runtime");
    const bundledJsxDevRuntime = await getBundledReactPath("/jsx-dev-runtime");

    if (bundledReact && bundledJsxRuntime && bundledJsxDevRuntime) {
      const bundledImports: Record<string, string> = {
        "react/jsx-runtime": pathToFileURL(bundledJsxRuntime).href,
        "react/jsx-dev-runtime": pathToFileURL(bundledJsxDevRuntime).href,
        "react": pathToFileURL(bundledReact).href,
      };

      return replaceSpecifiers(code, (specifier) => {
        return bundledImports[specifier] || null;
      });
    }

    return code;
  }

  if (isNode) {
    return code;
  }

  if (forSSR) {
    const denoSSRImports: Record<string, string> = {
      "react/jsx-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime`,
      "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime`,
      "react-dom/server": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server`,
      "react-dom/client": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client`,
      "react-dom": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}`,
      "react": `https://esm.sh/react@${REACT_DEFAULT_VERSION}`,
      "veryfront/ai/react": getVeryfrontAIReactPath(),
      "veryfront/ai/components": getVeryfrontAIReactPath("components/index.ts"),
      "veryfront/ai/primitives": getVeryfrontAIReactPath("primitives/index.ts"),
    };

    return replaceSpecifiers(code, (specifier) => {
      return denoSSRImports[specifier] || null;
    });
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

export function addDepsToEsmShUrls(code: string): Promise<string> {
  if (isNodeRuntime()) {
    return Promise.resolve(code);
  }

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (
      specifier.startsWith("https://esm.sh/") && !specifier.includes("?") &&
      !specifier.includes(`react@${REACT_DEFAULT_VERSION}`)
    ) {
      return `${specifier}?deps=react@${REACT_DEFAULT_VERSION},react-dom@${REACT_DEFAULT_VERSION}`;
    }
    return null;
  }));
}
