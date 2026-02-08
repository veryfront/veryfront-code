import denoConfig from "#deno-config" with { type: "json" };

type DenoConfig = {
  exports?: Record<string, string>;
  imports?: Record<string, string>;
};

const MODULE_EXT_RE = /\.(mjs|cjs|js|jsx|ts|tsx)$/;
const SRC_PREFIX = "./src/";

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
