/**
 * Cross-runtime React path resolution.
 *
 * Provides consistent React module resolution for Bun/Node SSR.
 * This ensures the same React instance is used by both user components
 * and react-dom-server, preventing "Objects are not valid as a React child"
 * or "Cannot read properties of null (reading 'useState')" errors.
 *
 * @module
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import nodeModule from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { satisfies, valid, versionAdmission } from "./semver.ts";
import { isBun, isDeno, isNode } from "./runtime.ts";

const ReflectApply = Reflect.apply;
const StringStartsWith = String.prototype.startsWith;
const JSONParse = JSON.parse;
const ObjectFreeze = Object.freeze;

let localReactPathsCache: Readonly<Record<string, string>> | null = null;
const EMPTY_REACT_PATHS: Readonly<Record<string, string>> = Object.freeze({});

const REACT_SPECIFIERS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;

function freshPeerRoot(packageName: string): string {
  const issuer = fileURLToPath(import.meta.url);
  const findPnpApi = Reflect.get(nodeModule, "findPnpApi");
  const pnp = typeof findPnpApi === "function"
    ? ReflectApply(findPnpApi, nodeModule, [issuer])
    : undefined;
  if (pnp !== undefined && pnp !== null) {
    const resolveToUnqualified = typeof pnp === "object"
      ? Reflect.get(pnp, "resolveToUnqualified")
      : undefined;
    if (typeof resolveToUnqualified !== "function") {
      throw new TypeError("Invalid local React PnP resolver");
    }
    const root = ReflectApply(resolveToUnqualified, pnp, [packageName, issuer]);
    if (typeof root === "string" && root.length > 0) return root;
    throw new TypeError("Local React package resolution is unavailable");
  }
  for (const directory of createRequire(import.meta.url).resolve.paths(packageName) ?? []) {
    const root = join(directory, packageName);
    if (existsSync(join(root, "package.json"))) return realpathSync(root);
  }
  throw new TypeError("Local React package resolution is unavailable");
}

function resolveFreshPeer(specifier: string, capturedRoot?: string): string {
  const packageName = specifier === "react-dom" || specifier.startsWith("react-dom/")
    ? "react-dom"
    : "react";
  const root = capturedRoot ?? freshPeerRoot(packageName);
  const require = createRequire(pathToFileURL(join(root, "package.json")));
  const manifest = JSONParse(readFileSync(join(root, "package.json"), "utf8"));
  // A fresh physical issuer avoids Node's SDK-relative symlink path cache.
  // Self exports preserve Node conditions and missing-export failures.
  if (manifest.exports !== undefined) return require.resolve(specifier);
  const suffix = specifier.slice(packageName.length).replace(/^\//, "");
  return require.resolve(suffix ? join(root, suffix) : root);
}

function localPackageManifestPath(packageName: string): string {
  return join(freshPeerRoot(packageName), "package.json");
}

/** Fresh on-disk peer versions for cache invalidation after dependency updates. */
export function getLocalReactVersions(): Readonly<Record<string, string>> {
  if (!isNode && !isBun) return ObjectFreeze({});
  return ObjectFreeze({
    react: localPackageVersion("react"),
    "react-dom": localPackageVersion("react-dom"),
  });
}

function localPackageVersion(packageName: string, root?: string): string {
  const manifest = JSONParse(
    readFileSync(root ? join(root, "package.json") : localPackageManifestPath(packageName), "utf8"),
  );
  if (manifest.name !== packageName) {
    throw new ReactPackageIdentityError("Installed React peer package identity does not match");
  }
  const version = manifest.version;
  if (typeof version !== "string" || !valid(version)) {
    throw new TypeError("Invalid installed React package version");
  }
  return version;
}

export class ReactPackageIdentityError extends TypeError {}

/** Require the two modules of a prepared React peer graph to identify one version. */
export function assertReactDOMPeerVersion(reactVersion: string, domVersion: unknown): void {
  if (typeof domVersion !== "string" || !valid(domVersion) || domVersion !== reactVersion) {
    throw new ReactPackageIdentityError("Prepared React DOM version does not match React");
  }
}

/** Package aliases cannot define the React/React DOM identity used by CDN URLs. */
export function assertReactPackageDeclaration(declaration?: string): void {
  if (declaration !== undefined && /^npm:/i.test(declaration)) {
    throw new ReactPackageIdentityError(
      "React package aliases are unsupported; install React peers directly",
    );
  }
  if (declaration !== undefined && versionAdmission("0.0.0", declaration) === null) {
    const registryTag = /^[A-Za-z0-9._-]+$/.test(declaration) &&
      declaration !== "." && declaration !== ".." &&
      !/\.(?:tgz|tar(?:\.gz)?)$/i.test(declaration);
    if (!registryTag) {
      throw new ReactPackageIdentityError(
        "Alternate-source React declarations are unsupported; use registry versions, ranges or tags",
      );
    }
  }
}

/** Select a compatible installed version before emitting SSR and browser URLs. */
export function resolveInstalledReactRange(declaration?: string): string | undefined {
  assertReactPackageDeclaration(declaration);
  if ((!isNode && !isBun) || (declaration && valid(declaration))) return undefined;
  const version = localPackageVersion("react");
  if (declaration === undefined) return version;
  return versionAdmission(version, declaration) === false ? undefined : version;
}

function resolveReactSpecifier(specifier: string): string | undefined {
  // Resolve from the framework, never from an application or writable cache.
  // Node imports CJS through file URLs with its normal ESM interop.
  // Missing peers are fatal: falling back to a CDN could split React identity.
  if (isNode || isBun) return pathToFileURL(resolveFreshPeer(specifier)).href;
  return undefined;
}

export function getLocalReactPaths(
  options?: { fresh?: boolean },
): Readonly<Record<string, string>> {
  // Deno owns its HTTP import graph; Node/Bun use the framework's local peers.
  if (isDeno) return EMPTY_REACT_PATHS;
  if (localReactPathsCache && !options?.fresh) return localReactPathsCache;

  const paths: Record<string, string> = {};

  for (const specifier of REACT_SPECIFIERS) {
    try {
      const resolved = resolveReactSpecifier(specifier);
      if (resolved) paths[specifier] = resolved;
    } catch (error) {
      // Older peers may not export optional client/runtime entrypoints. A
      // requested Node entrypoint is resolved separately and still fails closed.
      const code = (error as { code?: string }).code;
      if (code !== "MODULE_NOT_FOUND" && code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    }
  }

  localReactPathsCache = Object.freeze(paths);
  return localReactPathsCache;
}

/** Immutable local package identity owned by one SSR transform graph. */
export interface LocalReactPeerSnapshot {
  readonly roots: Readonly<Record<string, string>>;
  readonly paths: Readonly<Record<string, string>>;
  readonly versions: Readonly<Record<string, string>>;
}

export function captureLocalReactPeers(): LocalReactPeerSnapshot {
  if (!isNode && !isBun) {
    return ObjectFreeze({
      roots: EMPTY_REACT_PATHS,
      paths: EMPTY_REACT_PATHS,
      versions: EMPTY_REACT_PATHS,
    });
  }
  const roots = ObjectFreeze({
    react: freshPeerRoot("react"),
    "react-dom": freshPeerRoot("react-dom"),
  });
  const versions = ObjectFreeze({
    react: localPackageVersion("react", roots.react),
    "react-dom": localPackageVersion("react-dom", roots["react-dom"]),
  });
  const paths: Record<string, string> = {};
  for (const specifier of REACT_SPECIFIERS) {
    const name = specifier === "react-dom" || specifier.startsWith("react-dom/")
      ? "react-dom"
      : "react";
    try {
      paths[specifier] = pathToFileURL(resolveFreshPeer(specifier, roots[name])).href;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "MODULE_NOT_FOUND" && code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    }
  }
  // A concurrent package-store replacement must not mix roots during capture.
  if (freshPeerRoot("react") !== roots.react || freshPeerRoot("react-dom") !== roots["react-dom"]) {
    throw new TypeError("Local React peer roots changed during graph capture");
  }
  return ObjectFreeze({ roots, paths: ObjectFreeze(paths), versions });
}

/** Resolve SSR React imports against the same peers as the framework renderer. */
export function getLocalReactPath(
  specifier: string,
  reactVersion?: string,
  peers?: LocalReactPeerSnapshot,
): string | undefined {
  if (!isReactSpecifier(specifier)) return undefined;
  assertReactPackageDeclaration(reactVersion);
  if (peers && (isNode || isBun)) {
    const packageName =
      specifier === "react-dom" || ReflectApply(StringStartsWith, specifier, ["react-dom/"])
        ? "react-dom"
        : "react";
    const version = peers.versions[packageName];
    if (
      !version || (reactVersion !== undefined && versionAdmission(version, reactVersion) === false)
    ) {
      throw new TypeError("Local React runtime does not match the selected project version");
    }
    const path = peers.paths[specifier];
    if (path) return path;
    const root = peers.roots[packageName];
    if (!root) throw new TypeError("Local React peer root is unavailable in captured graph");
    try {
      return pathToFileURL(resolveFreshPeer(specifier, root)).href;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
        throw new TypeError("Local React peer subpath is unavailable in captured graph");
      }
      throw error;
    }
  }
  if ((isNode || isBun) && reactVersion !== undefined) {
    const packageName =
      specifier === "react-dom" || ReflectApply(StringStartsWith, specifier, ["react-dom/"])
        ? "react-dom"
        : "react";
    const installedVersion = localPackageVersion(packageName);
    const selectedVersion = resolveInstalledReactRange(reactVersion) ?? reactVersion;
    if (!satisfies(installedVersion, selectedVersion)) {
      throw new TypeError("Local React runtime does not match the selected project version");
    }
  }
  if (isNode || isBun) return resolveReactSpecifier(specifier);
  const mapped = getLocalReactPaths()[specifier];
  if (mapped) return mapped;
  return undefined;
}

export function isReactSpecifier(specifier: string): boolean {
  return (
    specifier === "react" ||
    specifier === "react-dom" ||
    ReflectApply(StringStartsWith, specifier, ["react/"]) ||
    ReflectApply(StringStartsWith, specifier, ["react-dom/"])
  );
}

export function clearReactPathsCache(): void {
  localReactPathsCache = null;
}
