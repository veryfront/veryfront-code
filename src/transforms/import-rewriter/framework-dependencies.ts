/**
 * Browser dependency policy for packages imported by Veryfront framework
 * modules.
 *
 * The browser transform cannot consume Deno's relative workspace mappings, so
 * these exact versions prevent package-owned bare imports from drifting to the
 * latest esm.sh release. Explicit versions authored by applications still win.
 *
 * @module transforms/import-rewriter/framework-dependencies
 */

import {
  buildEsmShUrl,
  ESM_SH_BUILD_PIN,
  MERMAID_VERSION,
} from "#veryfront/utils/constants/cdn.ts";

/** esm.sh build-system release used by audited framework dependency URLs. */
export { ESM_SH_BUILD_PIN };

/** Exact npm releases owned by framework runtime modules. */
export const FRAMEWORK_BROWSER_DEPENDENCY_VERSIONS = Object.freeze(
  {
    "react-markdown": "9.0.3",
    "remark-gfm": "4.0.1",
    "shiki": "1.24.0",
    "mermaid": MERMAID_VERSION,
  } as const,
);

type FrameworkBrowserDependencyName = keyof typeof FRAMEWORK_BROWSER_DEPENDENCY_VERSIONS;

interface FrameworkWorkspaceDependencyOptions {
  readonly external?: readonly string[];
  readonly target: "denonext" | "es2022";
}

/**
 * Runtime options used by the local React-workspace facades.
 *
 * These are intentionally separate from the ordinary browser rewriter
 * options. The Markdown parser facades execute in Deno SSR and use
 * `denonext`; browser-only Shiki and Mermaid stay on `es2022`.
 */
const FRAMEWORK_WORKSPACE_DEPENDENCY_OPTIONS: Readonly<
  Record<FrameworkBrowserDependencyName, FrameworkWorkspaceDependencyOptions>
> = Object.freeze(
  {
    "react-markdown": Object.freeze({
      external: Object.freeze(["react"]),
      target: "denonext",
    }),
    "remark-gfm": Object.freeze({ target: "denonext" }),
    "shiki": Object.freeze({ target: "es2022" }),
    "mermaid": Object.freeze({ target: "es2022" }),
  },
);

/** Return the framework-owned version for an unversioned package, if any. */
export function getFrameworkBrowserDependencyVersion(
  packageName: string,
): string | undefined {
  if (!Object.hasOwn(FRAMEWORK_BROWSER_DEPENDENCY_VERSIONS, packageName)) {
    return undefined;
  }
  return FRAMEWORK_BROWSER_DEPENDENCY_VERSIONS[
    packageName as keyof typeof FRAMEWORK_BROWSER_DEPENDENCY_VERSIONS
  ];
}

/**
 * Return the exact esm.sh URL used by a React-workspace dependency facade.
 *
 * Unknown packages return `undefined` so callers cannot accidentally create
 * an unpinned framework-owned URL.
 */
export function getFrameworkWorkspaceDependencyUrl(
  packageName: string,
): string | undefined {
  const version = getFrameworkBrowserDependencyVersion(packageName);
  if (!version) return undefined;

  const name = packageName as FrameworkBrowserDependencyName;
  const options = FRAMEWORK_WORKSPACE_DEPENDENCY_OPTIONS[name];
  return buildEsmShUrl(name, version, undefined, {
    external: options.external ? [...options.external] : undefined,
    target: options.target,
    pin: ESM_SH_BUILD_PIN,
  });
}
