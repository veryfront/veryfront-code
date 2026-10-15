import * as nodeModule from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join } from "node:path";
import process from "node:process";

const create = Object.create;
const descriptors = Object.getOwnPropertyDescriptors;
const prototype = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const nativeResolveHasParent = typeof process.versions.bun === "string";
const marker = `__vf_source_meta_${randomUUID().replaceAll("-", "")}`;
const resolvers = new Map();
const sourceConditions = new Map();
const pending = new Map();
let registered = false;

/** Preload a native resolver without adding top-level await to user modules. */
async function prepareResolver(url) {
  if (nativeResolveHasParent || resolvers.has(url)) return;
  let entry = pending.get(url);
  if (!entry) {
    const operation = (async () => {
      if (!registered) {
        nodeModule.register(new URL("./source-module-resolver-hooks.mjs", import.meta.url), {
          data: { marker },
        });
        registered = true;
      }
      const virtual = new URL(url);
      virtual.searchParams.set(marker, "1");
      const loaded = await import(virtual.href);
      resolvers.set(url, loaded.resolve);
      sourceConditions.set(url, loaded.conditions);
    })();
    entry = { operation };
    pending.set(url, entry);
  }
  try {
    await entry.operation;
  } finally {
    if (pending.get(url) === entry) pending.delete(url);
  }
}

export async function prepareSourceModuleMeta(url, peers) {
  await prepareResolver(url);
  if (nativeResolveHasParent) return;
  await Promise.all(
    Object.values(peers?.roots ?? {}).map((root) =>
      prepareResolver(pathToFileURL(join(root, "package.json")).href)
    ),
  );
}

export function getSourceModuleConditions(url) {
  return sourceConditions.get(url)?.filter((condition) =>
    condition !== "import" && condition !== "require" && condition !== "default"
  );
}

export function createSourceModuleMeta(native, url, peers) {
  const meta = create(prototype(native), descriptors(native));
  const path = fileURLToPath(url);
  meta.url = url;
  for (const key of ["filename", "path"]) if (key in native) meta[key] = path;
  for (const key of ["dirname", "dir"]) if (key in native) meta[key] = dirname(path);
  if ("file" in native) meta.file = basename(path);
  if (typeof native.require === "function") meta.require = nodeModule.createRequire(url);
  const resolveFromSource = nativeResolveHasParent
    ? native.resolve.bind(native)
    : resolvers.get(url);
  if (!resolveFromSource) throw new Error("Script source metadata was not prepared");
  meta.resolve = function resolve(specifier, parent = url) {
    if (parent === url && typeof specifier === "string") {
      if (peers.paths && hasOwn(peers.paths, specifier)) return peers.paths[specifier];
      const root = specifier === "react" || specifier.startsWith("react/")
        ? peers.roots?.react
        : specifier === "react-dom" || specifier.startsWith("react-dom/")
        ? peers.roots?.["react-dom"]
        : undefined;
      if (root) {
        parent = pathToFileURL(join(root, "package.json")).href;
        if (!nativeResolveHasParent) {
          const peerResolver = resolvers.get(parent);
          if (!peerResolver) throw new Error("Captured peer metadata was not prepared");
          return peerResolver(specifier);
        }
      }
    }
    return resolveFromSource(specifier, parent);
  };
  if (typeof native.resolveSync === "function") {
    meta.resolveSync = (specifier, parent = url) => native.resolveSync(specifier, parent);
  }
  return meta;
}

/** Import retained native dependencies with their original issuer and promise semantics. */
export async function importSourceModule(specifier, options, url, peers) {
  // Compilation prepares this issuer; coerce the target before yielding, like native import.
  const resolved = createSourceModuleMeta(import.meta, url, peers).resolve(`${specifier}`);
  return import(resolved, options);
}
