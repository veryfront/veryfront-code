/**************************
 * Client Runtime Generation for Build
 * Handles generation of client-side router and prefetch scripts
 **************************/

import {
  dirname,
  extname,
  fromFileUrl,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { serverLogger as logger } from "#veryfront/utils";
import {
  build,
  type ModuleLexer,
  type OnResolveArgs,
  type Plugin,
} from "veryfront/extensions/bundler";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import { copyFixedUint8ArrayWithinLimit } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import {
  isNativeErrorWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { CLIENT_PREFETCH_BUNDLE, CLIENT_ROUTER_BUNDLE } from "./templates.ts";
import { PRODUCTION_BUILD_FORMAT_VERSION } from "./constants.ts";

interface ClientScriptGenerationOptions {
  forceSourceBundle?: boolean;
}

const moduleDir = dirname(fromFileUrl(import.meta.url));
const packageRoot = resolve(join(moduleDir, "..", "..", ".."));
const MAX_CLIENT_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_CLIENT_BUNDLE_BYTES = 8 * 1024 * 1024;
const vfSrcPrefix = "@vf-src/";
const veryfrontInternalPrefix = "#veryfront/";
const moduleExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts"] as const;
const externalSpecifier = /^(std\/|@std\/|node:|deno:|https?:)/;
const relativeSpecifier = /^\.{1,2}(?:\/|$)/;
const clientExternalSpecifiers = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;
const clientExternalSpecifierSet = new Set<string>(clientExternalSpecifiers);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();
let physicalPackageRootPromise: Promise<string> | undefined;

type InspectedClientImport =
  | { readonly kind: "import-meta" }
  | { readonly kind: "computed" }
  | { readonly kind: "specifier"; readonly specifier: string };

const clientAliasPaths = new Map([
  ["#veryfront/config", "src/rendering/client/browser-stubs/config.ts"],
  ["#veryfront/errors/error-registry.ts", "src/rendering/client/browser-stubs/error-registry.ts"],
  ["#veryfront/routing", "src/routing/client/index.ts"],
]);

/**
 * Generate app.js module
 */
export function generateAppModule(): string {
  return `
// Veryfront App Module
(() => {
  console.log('[Veryfront] App module loaded');

  // Export for ES modules
  if (typeof window !== 'undefined') {
    window.__veryfront = window.__veryfront || {};
    window.__veryfront.version = '${PRODUCTION_BUILD_FORMAT_VERSION}';
    window.__veryfront.initialized = true;
  }

  // Basic hydration support
  window.hydrate = async function(slug, options = {}) {
    console.log('[Veryfront] Hydrating page:', slug, options);

    // Mark as hydrated
    const root = document.getElementById('root');
    if (root) {
      root.setAttribute('data-hydrated', 'true');
    }
  };
})();

export const version = '${PRODUCTION_BUILD_FORMAT_VERSION}';
export const hydrate = window.hydrate;
`;
}

/**
 * Generate client.js module for hydration
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generateClientModule(
  options?: ClientScriptGenerationOptions,
): Promise<string> {
  try {
    return await loadClientScript(
      CLIENT_ROUTER_BUNDLE,
      "router",
      "../../rendering/client/router.ts",
      options,
    );
  } catch (error) {
    logger.error("Failed to generate client runtime bundle", error);
    throw error;
  }
}

async function loadClientScript(
  preBundledScript: string | undefined,
  scriptName: string,
  sourceEntry: string,
  options?: ClientScriptGenerationOptions,
): Promise<string> {
  if (!options?.forceSourceBundle && preBundledScript !== undefined) {
    await assertUsableClientBundle(preBundledScript, scriptName, "embedded");
    logger.debug(`Using pre-bundled client ${scriptName} script`);
    return preBundledScript;
  }

  return await bundleClientEntry(sourceEntry);
}

async function assertUsableClientBundle(
  script: string,
  scriptName: string,
  source: "embedded" | "generated",
): Promise<void> {
  if (script.trim().length === 0) {
    throw BUILD_FAILED.create({
      detail: `The ${source} client ${scriptName} bundle is empty`,
    });
  }

  const byteLength = utf8Encoder.encode(script).byteLength;
  if (byteLength > MAX_CLIENT_BUNDLE_BYTES) {
    throw BUILD_FAILED.create({
      detail: `The ${source} client ${scriptName} bundle exceeds ${MAX_CLIENT_BUNDLE_BYTES} bytes`,
    });
  }

  const lexer = tryResolve<ModuleLexer>("ModuleLexer");
  if (lexer === undefined) {
    throw BUILD_FAILED.create({
      detail: `The ${source} client ${scriptName} bundle requires a ModuleLexer extension ` +
        "before it can be inspected for browser delivery",
    });
  }

  let imports: readonly InspectedClientImport[];
  try {
    await lexer.init?.();
    const parsed = lexer.parse(script) as unknown;
    imports = inspectClientBundleImports(parsed, script.length);
  } catch (cause) {
    throw BUILD_FAILED.create({
      detail:
        `The ${source} client ${scriptName} bundle could not be inspected for browser delivery`,
      cause,
    });
  }

  for (const imported of imports) {
    if (imported.kind === "import-meta") continue;
    if (imported.kind === "computed") {
      throw BUILD_FAILED.create({
        detail: `The ${source} client ${scriptName} bundle contains a computed dynamic import`,
      });
    }
    if (!clientExternalSpecifierSet.has(imported.specifier)) {
      throw BUILD_FAILED.create({
        detail: `The ${source} client ${scriptName} bundle contains unsupported external import ${
          JSON.stringify(imported.specifier)
        }`,
      });
    }
  }
}

function inspectClientBundleImports(
  parsed: unknown,
  sourceLength: number,
): readonly InspectedClientImport[] {
  if (!Array.isArray(parsed)) {
    throw new TypeError("ModuleLexer.parse() must return an array");
  }

  const declaredLength = parsed.length;
  if (
    !Number.isSafeInteger(declaredLength) || declaredLength < 0 ||
    declaredLength > sourceLength
  ) {
    throw new TypeError("ModuleLexer.parse() returned an invalid record count");
  }

  const inspected: InspectedClientImport[] = [];
  let consumed = 0;
  for (const candidate of parsed) {
    consumed++;
    if (consumed > declaredLength) {
      throw new TypeError("ModuleLexer.parse() yielded more records than its array length");
    }
    if (typeof candidate !== "object" || candidate === null) {
      throw new TypeError("ModuleLexer.parse() returned a non-object import record");
    }

    const record = candidate as Record<string, unknown>;
    const n = record.n;
    const s = record.s;
    const e = record.e;
    const ss = record.ss;
    const se = record.se;
    const d = record.d;
    const a = record.a;

    if (n !== undefined && typeof n !== "string") {
      throw new TypeError("ModuleLexer import record n must be a string or undefined");
    }
    if (
      !Number.isSafeInteger(s) ||
      !Number.isSafeInteger(e) ||
      !Number.isSafeInteger(ss) ||
      !Number.isSafeInteger(se) ||
      !Number.isSafeInteger(d) ||
      !Number.isSafeInteger(a)
    ) {
      throw new TypeError("ModuleLexer import positions must be finite safe integers");
    }

    const specifierStart = s as number;
    const specifierEnd = e as number;
    const statementStart = ss as number;
    const statementEnd = se as number;
    const dynamicImportIndex = d as number;
    const attributesStart = a as number;
    if (
      specifierStart < 0 ||
      specifierEnd < specifierStart ||
      statementStart < 0 ||
      statementStart > specifierStart ||
      statementEnd < specifierEnd ||
      statementEnd > sourceLength
    ) {
      throw new TypeError("ModuleLexer import positions are outside the source statement");
    }
    if (
      dynamicImportIndex < -2 ||
      dynamicImportIndex > sourceLength ||
      (dynamicImportIndex >= 0 &&
        (dynamicImportIndex < statementStart || dynamicImportIndex > specifierStart))
    ) {
      throw new TypeError("ModuleLexer dynamic import position is invalid");
    }
    if (
      attributesStart < -1 ||
      attributesStart > sourceLength ||
      (attributesStart >= 0 &&
        (attributesStart < specifierEnd || attributesStart >= statementEnd))
    ) {
      throw new TypeError("ModuleLexer import attributes position is invalid");
    }

    if (dynamicImportIndex === -2) {
      if (n !== undefined || attributesStart !== -1) {
        throw new TypeError("ModuleLexer import.meta record is contradictory");
      }
      inspected.push({ kind: "import-meta" });
      continue;
    }
    if (dynamicImportIndex === -1 && n === undefined) {
      throw new TypeError("ModuleLexer static import record has no resolved specifier");
    }
    inspected.push(
      n === undefined ? { kind: "computed" } : { kind: "specifier", specifier: n },
    );
  }

  if (consumed !== declaredLength) {
    throw new TypeError("ModuleLexer.parse() yielded fewer records than its array length");
  }
  return inspected;
}

/**
 * Load and transform router script from source
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generateRouterScript(
  _adapter: RuntimeAdapter,
  options?: ClientScriptGenerationOptions,
): Promise<string> {
  return loadClientScript(
    CLIENT_ROUTER_BUNDLE,
    "router",
    "../../rendering/client/router.ts",
    options,
  );
}

/**
 * Generate prefetch script
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generatePrefetchScript(
  _adapter: RuntimeAdapter,
  options?: ClientScriptGenerationOptions,
): Promise<string> {
  return loadClientScript(
    CLIENT_PREFETCH_BUNDLE,
    "prefetch",
    "../../rendering/client/prefetch.ts",
    options,
  );
}

/**
 * Generate import map for React dependencies
 *
 * Uses centralized React version configuration from cdn.ts
 */
export async function generateImportMap(): Promise<string> {
  const { getReactImportMap, REACT_DEFAULT_VERSION } = await import(
    "#veryfront/utils/constants/cdn.ts"
  );
  const imports = getReactImportMap(REACT_DEFAULT_VERSION);

  return `
  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${JSON.stringify({ imports }, null, 2)}
  </script>
  `;
}

function createClientShimPlugin(shimPath: string): Plugin {
  return {
    name: "veryfront-client-shims",
    setup(build) {
      build.onResolve({ filter: /^#veryfront\/utils$/ }, () => ({ path: shimPath }));
    },
  };
}

function createPathResolverPlugin(): Plugin {
  return {
    name: "veryfront-path-resolver",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        const specifier = stripSpecifier(args.path);

        if (externalSpecifier.test(specifier)) {
          return { path: args.path, external: true };
        }

        if (specifier.startsWith(vfSrcPrefix)) {
          const lookupBase = resolve(packageRoot, specifier.slice(vfSrcPrefix.length));
          assertPathWithinPackage(lookupBase);
          const resolved = await resolveFromCandidates(lookupBase);
          return resolved ? { path: resolved } : null;
        }

        const aliasPath = clientAliasPaths.get(specifier);
        if (aliasPath) {
          const lookupBase = resolve(packageRoot, aliasPath);
          const resolved = await resolveFromCandidates(lookupBase);
          return resolved ? { path: resolved } : null;
        }

        if (specifier.startsWith(veryfrontInternalPrefix)) {
          const lookupBase = resolve(
            packageRoot,
            "src",
            specifier.slice(veryfrontInternalPrefix.length),
          );
          assertPathWithinPackage(lookupBase);
          const resolved = await resolveFromCandidates(lookupBase);
          return resolved ? { path: resolved } : null;
        }

        if (relativeSpecifier.test(specifier)) {
          const importerDir = determineImporterDir(args);
          const lookupBase = resolve(importerDir, specifier);
          assertPathWithinPackage(lookupBase);
          const resolved = await resolveFromCandidates(lookupBase);
          return resolved ? { path: resolved } : null;
        }

        return { external: true };
      });
    },
  };
}

function determineImporterDir(args: OnResolveArgs): string {
  if (args.resolveDir) {
    return isAbsolute(args.resolveDir) ? args.resolveDir : resolve(packageRoot, args.resolveDir);
  }

  if (args.importer?.startsWith("file://")) {
    return dirname(fromFileUrl(new URL(args.importer)));
  }

  if (args.importer && isAbsolute(args.importer)) {
    return dirname(args.importer);
  }

  return packageRoot;
}

async function resolveFromCandidates(basePath: string): Promise<string | null> {
  assertPathWithinPackage(basePath);
  for (const candidate of buildCandidatePaths(basePath)) {
    if (await isSafeClientSourceFile(candidate)) return candidate;
  }
  return null;
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "." ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\"));
}

function assertPathWithinPackage(candidatePath: string): void {
  if (!isPathWithin(packageRoot, candidatePath)) {
    throw BUILD_FAILED.create({
      detail: "Client runtime source resolution escaped the framework package root",
    });
  }
}

function getPhysicalPackageRoot(): Promise<string> {
  physicalPackageRootPromise ??= realPath(packageRoot).catch((error) => {
    physicalPackageRootPromise = undefined;
    throw error;
  });
  return physicalPackageRootPromise;
}

async function assertPhysicalPathWithinPackage(candidatePath: string): Promise<void> {
  const [physicalRoot, physicalCandidate] = await Promise.all([
    getPhysicalPackageRoot(),
    realPath(candidatePath),
  ]);
  if (!isPathWithin(physicalRoot, physicalCandidate)) {
    throw BUILD_FAILED.create({
      detail: "Client runtime source resolved outside the framework package root",
    });
  }
}

async function getClientSourceFileInfo(path: string) {
  assertPathWithinPackage(path);
  const fs = createFileSystem();
  const info = fs.lstat ? await fs.lstat(path) : await fs.stat(path);
  if (
    info.isSymlink ||
    !info.isFile ||
    info.isDirectory ||
    !Number.isSafeInteger(info.size) ||
    info.size < 0
  ) {
    throw BUILD_FAILED.create({
      detail: "Client runtime source is not a safe regular file",
    });
  }
  if (info.size > MAX_CLIENT_SOURCE_BYTES) {
    throw BUILD_FAILED.create({
      detail: `Client runtime source exceeds ${MAX_CLIENT_SOURCE_BYTES} bytes`,
    });
  }
  await assertPhysicalPathWithinPackage(path);
  return { fs, size: info.size };
}

async function isSafeClientSourceFile(path: string): Promise<boolean> {
  try {
    await getClientSourceFileInfo(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function readClientSource(path: string): Promise<string> {
  const { fs, size } = await getClientSourceFileInfo(path);
  const exactReader = fs.readFileBytesWithinLimit;
  if (typeof exactReader !== "function") {
    throw BUILD_FAILED.create({
      detail: "Client runtime source requires an exact bounded filesystem reader",
    });
  }

  let rawBytes: unknown;
  try {
    rawBytes = await Reflect.apply(exactReader, fs, [path, MAX_CLIENT_SOURCE_BYTES]);
  } catch (error) {
    if (
      isNativeErrorWithoutHooks(error) &&
      readNativeErrorNameWithoutHooks(error) === "RangeError"
    ) {
      throw BUILD_FAILED.create({
        detail: `Client runtime source exceeds ${MAX_CLIENT_SOURCE_BYTES} bytes`,
        cause: error,
      });
    }
    throw error;
  }

  let bytes: Uint8Array;
  try {
    bytes = copyFixedUint8ArrayWithinLimit(
      rawBytes,
      MAX_CLIENT_SOURCE_BYTES,
      "Client runtime source",
    );
  } catch (error) {
    throw BUILD_FAILED.create({
      detail: "Client runtime source reader violated its exact bounded-read contract",
      cause: error,
    });
  }
  if (bytes.byteLength !== size || bytes.byteLength > MAX_CLIENT_SOURCE_BYTES) {
    throw BUILD_FAILED.create({
      detail: "Client runtime source changed while it was being read",
    });
  }

  try {
    return utf8Decoder.decode(bytes);
  } catch (error) {
    throw BUILD_FAILED.create({
      detail: "Client runtime source is not valid UTF-8",
      cause: error,
    });
  }
}

function buildCandidatePaths(basePath: string): string[] {
  const normalizedBase = stripTrailingSeparator(basePath);

  if (hasSupportedExtension(normalizedBase)) return [normalizedBase];

  const withExtensions = moduleExtensions.map((extension) => `${normalizedBase}${extension}`);
  const indexCandidates = moduleExtensions.map((extension) =>
    join(normalizedBase, `index${extension}`)
  );

  return [...withExtensions, ...indexCandidates];
}

function hasSupportedExtension(filePath: string): boolean {
  const extension = extname(filePath);
  return extension.length > 0 &&
    moduleExtensions.includes(extension as (typeof moduleExtensions)[number]);
}

function stripTrailingSeparator(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function stripSpecifier(specifier: string): string {
  const queryIndex = specifier.indexOf("?");
  const hashIndex = specifier.startsWith("#") ? -1 : specifier.indexOf("#");

  if (queryIndex === -1 && hashIndex === -1) return specifier;
  if (queryIndex === -1) return specifier.slice(0, hashIndex);
  if (hashIndex === -1) return specifier.slice(0, queryIndex);

  return specifier.slice(0, Math.min(queryIndex, hashIndex));
}

const extensionToLoader: Record<string, "js" | "ts" | "tsx" | "jsx" | "json"> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".jsx": "jsx",
  ".json": "json",
};

function createFsLoaderPlugin(): Plugin {
  return {
    name: "veryfront-fs-loader",
    setup(build) {
      build.onLoad({ filter: /.*/ }, async (args) => {
        const contents = await readClientSource(args.path);
        const ext = extname(args.path).toLowerCase();
        const loader = extensionToLoader[ext] ?? "js";
        return { contents, loader };
      });
    },
  };
}

async function bundleClientEntry(entryRelative: string): Promise<string> {
  const entryUrl = new URL(entryRelative, import.meta.url);
  const shimUrl = new URL("../../rendering/client/browser-stubs/logger.ts", import.meta.url);

  const entryPath = fromFileUrl(entryUrl);
  const entryDir = dirname(entryPath);
  const shimPath = fromFileUrl(shimUrl);
  const source = await readClientSource(entryPath);
  const loader = entryPath.endsWith(".tsx") ? "tsx" : "ts";

  const result = await build({
    absWorkingDir: packageRoot,
    stdin: {
      contents: source,
      loader,
      resolveDir: entryDir,
      sourcefile: entryPath,
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    write: false,
    sourcemap: false,
    packages: "external",
    mainFields: ["module", "browser", "main"],
    resolveExtensions: [...moduleExtensions],
    loader: {
      ".ts": "ts",
      ".tsx": "tsx",
      ".js": "js",
    },
    external: [...clientExternalSpecifiers],
    plugins: [
      createClientShimPlugin(shimPath),
      createPathResolverPlugin(),
      createFsLoaderPlugin(),
    ],
  });

  if (result.errors.length > 0) {
    throw BUILD_FAILED.create({
      detail: `The bundler reported errors for client entry ${entryRelative}`,
    });
  }
  if (result.outputFiles.length !== 1) {
    throw BUILD_FAILED.create({
      detail: `Expected one bundled output for client entry ${entryRelative}, ` +
        `received ${result.outputFiles.length}`,
    });
  }

  const output = result.outputFiles[0]!.text;
  await assertUsableClientBundle(output, entryRelative, "generated");
  return output;
}
