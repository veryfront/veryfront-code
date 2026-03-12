import denoConfig from "#deno-config" with { type: "json" };

type DenoConfig = {
  exports?: Record<string, string>;
  imports?: Record<string, string>;
};

const MODULE_EXT_RE = /\.(mjs|cjs|js|jsx|ts|tsx)$/;
const SRC_PREFIX = "./src/";

type ModuleTargetIndex = {
  exactTargets: Map<string, string>;
  prefixTargets: Array<{ specifierPrefix: string; targetPrefix: string }>;
};

function createTargetIndex(): ModuleTargetIndex {
  return {
    exactTargets: new Map<string, string>(),
    prefixTargets: [],
  };
}

function normalizeModulePath(path: string): string {
  if (!path) return path;
  if (path.endsWith("/")) return path;
  return path.replace(MODULE_EXT_RE, ".js");
}

function toModuleServerUrl(target: string): string | null {
  if (!target.startsWith(SRC_PREFIX)) return null;

  const relative = target.slice(SRC_PREFIX.length);
  if (!relative) return null;

  return `/_vf_modules/_veryfront/${normalizeModulePath(relative)}`;
}

function addMapping(
  index: ModuleTargetIndex,
  specifier: string,
  target: string,
): void {
  if (!target.startsWith(SRC_PREFIX)) return;

  if (specifier.endsWith("/")) {
    index.prefixTargets.push({
      specifierPrefix: specifier,
      targetPrefix: target.endsWith("/") ? target : `${target}/`,
    });
    return;
  }

  index.exactTargets.set(specifier, target);
}

function finalizeIndex(index: ModuleTargetIndex): void {
  index.prefixTargets.sort((a, b) => b.specifierPrefix.length - a.specifierPrefix.length);
}

function resolveTarget(index: ModuleTargetIndex, specifier: string): string | null {
  const exact = index.exactTargets.get(specifier);
  if (exact) return exact;

  for (const { specifierPrefix, targetPrefix } of index.prefixTargets) {
    if (!specifier.startsWith(specifierPrefix)) continue;
    return `${targetPrefix}${specifier.slice(specifierPrefix.length)}`;
  }

  return null;
}

const config = denoConfig as DenoConfig;
const veryfrontTargetIndex = createTargetIndex();
const internalTargetIndex = createTargetIndex();

for (const [specifier, target] of Object.entries(config.imports ?? {})) {
  if (typeof target !== "string") continue;

  if (specifier === "veryfront" || specifier.startsWith("veryfront/")) {
    addMapping(veryfrontTargetIndex, specifier, target);
  }

  // Also index #veryfront imports so the import rewriter can
  // generate correct /_vf_modules/ URLs that match the actual filesystem layout.
  if (specifier === "#veryfront" || specifier.startsWith("#veryfront/")) {
    addMapping(internalTargetIndex, specifier, target);
  }
}

for (const [key, target] of Object.entries(config.exports ?? {})) {
  if (typeof target !== "string") continue;

  if (key === ".") {
    addMapping(veryfrontTargetIndex, "veryfront", target);
    continue;
  }

  if (!key.startsWith("./")) continue;
  addMapping(veryfrontTargetIndex, `veryfront/${key.slice(2)}`, target);
}

finalizeIndex(veryfrontTargetIndex);
finalizeIndex(internalTargetIndex);

export function resolveVeryfrontModuleTarget(specifier: string): string | null {
  return resolveTarget(veryfrontTargetIndex, specifier);
}

export function resolveInternalModuleTarget(specifier: string): string | null {
  return resolveTarget(internalTargetIndex, specifier);
}

export function resolveVeryfrontModuleUrl(specifier: string): string | null {
  const target = resolveVeryfrontModuleTarget(specifier);
  return target ? toModuleServerUrl(target) : null;
}

/**
 * Resolve an internal #veryfront/* specifier to a /_vf_modules/ URL.
 * Uses the deno.json import map to get the correct filesystem path,
 * which may differ from the specifier path (e.g. #veryfront/compat/console
 * maps to src/platform/compat/console/index.ts, not src/compat/console.ts).
 */
export function resolveInternalModuleUrl(specifier: string): string | null {
  const target = resolveInternalModuleTarget(specifier);
  return target ? toModuleServerUrl(target) : null;
}
