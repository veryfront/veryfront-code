import denoConfig from "../../deno.json" with { type: "json" };
import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { VERYFRONT_VERSION } from "#veryfront/utils/constants/cdn.ts";

type DenoConfig = {
  exports?: Record<string, string>;
  imports?: Record<string, string>;
};

const MODULE_EXT_RE = /\.(mjs|cjs|js|jsx|ts|tsx)$/;
const SRC_PREFIX = "./src/";

// Client-side modules that are NOT embedded in compiled binaries
// These must use CDN URLs when running from a compiled binary
const AI_MODULE_SPECIFIERS = new Set([
  "veryfront/chat",
  "veryfront/markdown",
  "veryfront/mdx",
]);

// CDN URLs for client-side modules (used when running from compiled binary)
function getAiModuleCdnUrl(specifier: string): string | null {
  const version = VERYFRONT_VERSION;
  switch (specifier) {
    case "veryfront/chat":
      return `https://esm.sh/veryfront@${version}/chat?external=react,react-dom&target=es2022`;
    case "veryfront/markdown":
      return `https://esm.sh/veryfront@${version}/markdown?external=react,react-dom&target=es2022`;
    case "veryfront/mdx":
      return `https://esm.sh/veryfront@${version}/mdx?external=react,react-dom&target=es2022`;
    default:
      return null;
  }
}

function toModuleServerUrl(target: string): string | null {
  if (!target.startsWith(SRC_PREFIX)) return null;

  const relative = target.slice(SRC_PREFIX.length);
  if (!relative) return null;

  const withoutExt = relative.replace(MODULE_EXT_RE, "");
  return `/_vf_modules/_veryfront/${withoutExt}.js`;
}

function addMapping(
  map: Map<string, string>,
  specifier: string,
  target: string,
): void {
  // For AI modules in compiled binaries, use CDN URLs instead of local paths
  if (isDenoCompiled && AI_MODULE_SPECIFIERS.has(specifier)) {
    const cdnUrl = getAiModuleCdnUrl(specifier);
    if (cdnUrl) {
      map.set(specifier, cdnUrl);
      return;
    }
  }

  const url = toModuleServerUrl(target);
  if (!url) return;
  map.set(specifier, url);
}

const config = denoConfig as DenoConfig;
const veryfrontModuleUrlMap = new Map<string, string>();

for (const [specifier, target] of Object.entries(config.imports ?? {})) {
  if (!specifier.startsWith("veryfront/")) continue;
  if (typeof target !== "string") continue;
  addMapping(veryfrontModuleUrlMap, specifier, target);
}

for (const [key, target] of Object.entries(config.exports ?? {})) {
  if (typeof target !== "string") continue;

  if (key === ".") {
    addMapping(veryfrontModuleUrlMap, "veryfront", target);
    continue;
  }

  if (!key.startsWith("./")) continue;
  addMapping(veryfrontModuleUrlMap, `veryfront/${key.slice(2)}`, target);
}

export function resolveVeryfrontModuleUrl(specifier: string): string | null {
  return veryfrontModuleUrlMap.get(specifier) ?? null;
}

export function getVeryfrontModuleUrlMap(): Record<string, string> {
  return Object.fromEntries(veryfrontModuleUrlMap);
}
