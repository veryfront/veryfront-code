import { replaceSpecifiers } from "./lexer.ts";
import { DEFAULT_REACT_VERSION, getReactImportMap } from "./react-cdn.ts";
import {
  captureLocalReactPeers,
  getLocalReactPath,
  type LocalReactPeerSnapshot,
  resolveInstalledReactRange,
} from "#veryfront/platform/compat/react-paths.ts";

const srcDir = new URL(".", import.meta.url).pathname.replace(
  /\/(build|src)\/transforms\/esm\/?$/,
  "",
);

function getVeryfrontModulePaths(): Record<string, string> {
  return {
    "veryfront/chat": `file://${srcDir}/chat/index.ts`,
    "veryfront/markdown": `file://${srcDir}/markdown/index.ts`,
    "veryfront/mdx": `file://${srcDir}/mdx/index.ts`,
  };
}

export async function resolveReactImports(
  code: string,
  forSSR: boolean = false,
  reactVersion?: string,
  reactPeers?: LocalReactPeerSnapshot,
): Promise<string> {
  if (forSSR) reactPeers ??= captureLocalReactPeers();
  reactVersion ??= reactPeers?.versions.react ??
    (forSSR ? resolveInstalledReactRange() : undefined) ?? DEFAULT_REACT_VERSION;
  const reactImports = getReactImportMap(reactVersion);

  if (!forSSR) {
    return replaceSpecifiers(code, (specifier) => reactImports[specifier] ?? null);
  }

  const ssrImports: Record<string, string> = {
    ...getVeryfrontModulePaths(),
    ...reactImports,
  };

  return replaceSpecifiers(
    code,
    (specifier) =>
      getLocalReactPath(specifier, reactVersion, reactPeers) ?? ssrImports[specifier] ?? null,
  );
}

export function addDepsToEsmShUrls(
  code: string,
  _forSSR: boolean = false,
  reactVersion: string = DEFAULT_REACT_VERSION,
): Promise<string> {
  return Promise.resolve(
    replaceSpecifiers(code, (specifier) => {
      if (!specifier.startsWith("https://esm.sh/")) return null;
      if (specifier.includes(`react@${reactVersion}`)) return null;
      if (specifier.includes("?")) return null;
      return `${specifier}?external=react,react-dom&target=es2022`;
    }),
  );
}
