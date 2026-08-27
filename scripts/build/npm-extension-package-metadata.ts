import { dirname, isAbsolute, join, normalize, relative, toFileUrl } from "#std/path";
import { parseNpmImport } from "./npm-dependency-sources.ts";
import { MINIMUM_NODE_VERSION, NPM_NODE_ENGINE } from "./runtime-support.ts";

export type ExtensionManifest = {
  name: string;
  version?: string;
  exports: string | Record<string, string>;
  veryfront?: {
    extension?: boolean;
    activation?: "auto" | "explicit";
    contracts?: {
      provides?: string[];
      requires?: string[];
    };
    capabilities?: unknown[];
    npm?: {
      nodeEngine?: string;
      publish?: boolean;
      stagedSources?: ExtensionStagedSourceManifest[];
      runtimePackages?: ExtensionRuntimePackageManifest[];
    };
  };
  imports?: Record<string, string>;
};

export type ExtensionRuntimePackageManifest = {
  name: string;
  export: string;
  dependencies: string[];
  peerVeryfront?: boolean;
};

export type ExtensionStagedSourceManifest = {
  specifier: string;
  source: string;
  target: string;
};

export type RootPackageConfig = {
  exports?: Record<string, string>;
  workspace?: string[];
};

export type NpmPackageMapping = {
  name: string;
  version: string;
  subPath?: string;
};

export type ExtensionEntryPoint = {
  name: string;
  path: string;
};

export type ExtensionPackageJson = Record<string, unknown> & {
  name: string;
  version: string;
};

export type ExtensionPackageSpec = {
  manifestPath: string;
  manifestDir: string;
  entryPoints: ExtensionEntryPoint[];
  entryPoint: string;
  packageName: string;
  packageDirectoryName: string;
  packageJson: ExtensionPackageJson;
  dntMappings: Record<string, NpmPackageMapping>;
  manifestDependencies: Record<string, string>;
  peerVeryfront: boolean;
  readmePath: string;
  stagedSources: ExtensionStagedSourceManifest[];
};

const TEST_ONLY_IMPORTS = new Set([
  "@std/assert",
  "@std/testing/bdd",
]);

const NODE_ENGINE_PATTERN = /^>=(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;

/**
 * Native npm dependencies must be pinned to a release that ships prebuilt
 * binaries for every supported Node release. Extension imports become exact
 * pins in the published package, so an older pin never resolves forward: it
 * falls back to `node-gyp rebuild`, which cannot compile against the V8
 * headers of newer Node majors and leaves the extension uninstallable.
 */
const PREBUILT_NATIVE_DEPENDENCY_FLOORS: Record<string, string> = {
  // 13.0.0 is the first release whose npm tarball carries Node-API prebuilds
  // for every platform, so installs never invoke node-gyp.
  "better-sqlite3": "13.0.0",
};

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function extensionNodeEngine(manifest: ExtensionManifest): string {
  const nodeEngine = manifest.veryfront?.npm?.nodeEngine ?? NPM_NODE_ENGINE;
  if (typeof nodeEngine !== "string" || !NODE_ENGINE_PATTERN.test(nodeEngine)) {
    throw new Error(
      `${manifest.name} veryfront.npm.nodeEngine must use the exact minimum-version form >=MAJOR.MINOR.PATCH`,
    );
  }
  const minimumVersion = nodeEngine.slice(2);
  if (compareVersions(minimumVersion, MINIMUM_NODE_VERSION) < 0) {
    throw new Error(
      `${manifest.name} veryfront.npm.nodeEngine cannot be lower than the Veryfront minimum ${NPM_NODE_ENGINE}`,
    );
  }
  return nodeEngine;
}

export function firstPartyExtensionManifestPaths(
  rootConfig: RootPackageConfig,
): string[] {
  return (rootConfig.workspace ?? [])
    .filter((entry) => entry.startsWith("./extensions/"))
    .map((entry) => `${entry.replace(/^\.\//, "")}/deno.json`)
    .toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function extensionPackageDirectoryName(packageName: string): string {
  return packageName.replace(/^@veryfront\//, "");
}

export function extensionNameFromPackageName(packageName: string): string {
  return packageName.replace(/^@veryfront\//, "");
}

function assertPrebuiltNativeDependency(name: string, version: string): void {
  const floor = PREBUILT_NATIVE_DEPENDENCY_FLOORS[name];
  if (!floor || compareVersions(version, floor) >= 0) return;

  throw new Error(
    `${name}@${version} predates ${floor}, the first release that ships prebuilt binaries. ` +
      `Older pins fall back to node-gyp and cannot install on every supported Node release.`,
  );
}

export function manifestDependencies(
  manifest: ExtensionManifest,
): Record<string, string> {
  const dependencies: Record<string, string> = {};

  for (const [specifier, target] of Object.entries(manifest.imports ?? {})) {
    if (TEST_ONLY_IMPORTS.has(specifier)) continue;

    const parsed = parseNpmImport(target);
    if (!parsed) continue;

    assertPrebuiltNativeDependency(parsed.name, parsed.version);
    dependencies[parsed.name] = parsed.version;
  }

  return Object.fromEntries(
    Object.entries(dependencies).toSorted(([left], [right]) =>
      left.localeCompare(right)
    ),
  );
}

function localFirstPartyExtensionDependencies(
  manifest: ExtensionManifest,
  manifestDir: string,
  version: string,
): Record<string, string> {
  const dependencies: Record<string, string> = {};
  for (const [specifier, target] of Object.entries(manifest.imports ?? {})) {
    if (!specifier.startsWith("@veryfront/ext-") || !target.startsWith(".")) continue;
    if (specifier === manifest.name) {
      throw new Error(`${manifest.name} cannot depend on itself`);
    }

    const dependencyDirectory = join(
      "extensions",
      extensionPackageDirectoryName(specifier),
    );
    const resolvedTarget = normalize(join(manifestDir, target));
    const relativeTarget = relative(dependencyDirectory, resolvedTarget);
    if (
      relativeTarget === "" ||
      relativeTarget === ".." ||
      relativeTarget.startsWith("../") ||
      relativeTarget.startsWith("..\\") ||
      isAbsolute(relativeTarget)
    ) {
      throw new Error(
        `${manifest.name} import "${specifier}" must target its matching first-party extension directory`,
      );
    }
    dependencies[specifier] = version;
  }
  return dependencies;
}

export function normalizeExtensionEntryPoints(input: {
  manifestPath: string;
  manifestDir: string;
  exports: ExtensionManifest["exports"];
}): ExtensionEntryPoint[] {
  if (typeof input.exports === "string") {
    return [{
      name: ".",
      path: resolveExtensionExportPath({
        manifestPath: input.manifestPath,
        manifestDir: input.manifestDir,
        exportName: ".",
        exportPath: input.exports,
      }),
    }];
  }

  const entryPoints: ExtensionEntryPoint[] = [];
  for (const [exportName, exportPath] of Object.entries(input.exports)) {
    validateExtensionExportName(input.manifestPath, exportName);
    entryPoints.push({
      name: exportName,
      path: resolveExtensionExportPath({
        manifestPath: input.manifestPath,
        manifestDir: input.manifestDir,
        exportName,
        exportPath,
      }),
    });
  }

  if (!entryPoints.some((entryPoint) => entryPoint.name === ".")) {
    throw new Error(
      `${input.manifestPath} exports must include "." when using an export map`,
    );
  }

  return entryPoints;
}

export function createExtensionPackageSpec(input: {
  manifestPath: string;
  manifest: ExtensionManifest;
  rootConfig: RootPackageConfig;
  rootDir: string;
  version: string;
  license: string;
}): ExtensionPackageSpec {
  return createBaseExtensionPackageSpec(input);
}

export function createExtensionPackageSpecs(input: {
  manifestPath: string;
  manifest: ExtensionManifest;
  rootConfig: RootPackageConfig;
  rootDir: string;
  version: string;
  license: string;
}): ExtensionPackageSpec[] {
  const baseSpec = createBaseExtensionPackageSpec(input);
  const runtimePackageSpecs =
    (input.manifest.veryfront?.npm?.runtimePackages ?? [])
      .map((runtimePackage) =>
        createRuntimeExtensionPackageSpec({
          ...input,
          baseSpec,
          runtimePackage,
        })
      );
  return [baseSpec, ...runtimePackageSpecs];
}

function createBaseExtensionPackageSpec(input: {
  manifestPath: string;
  manifest: ExtensionManifest;
  rootConfig: RootPackageConfig;
  rootDir: string;
  version: string;
  license: string;
}): ExtensionPackageSpec {
  const manifestDir = dirname(input.manifestPath);
  const packageName = input.manifest.name;
  if (!packageName?.startsWith("@veryfront/ext-")) {
    throw new Error(
      `Unsupported first-party extension package name: ${packageName}`,
    );
  }
  if (input.manifest.veryfront?.extension !== true) {
    throw new Error(
      `${input.manifestPath} must declare veryfront.extension: true`,
    );
  }

  const packageDirectoryName = extensionPackageDirectoryName(packageName);
  const dependencies = Object.fromEntries(
    Object.entries({
      ...manifestDependencies(input.manifest),
      ...localFirstPartyExtensionDependencies(
        input.manifest,
        manifestDir,
        input.version,
      ),
    }).toSorted(([left], [right]) => left.localeCompare(right)),
  );
  const veryfrontPeerRange = `^${input.version}`;
  const entryPoints = normalizeExtensionEntryPoints({
    manifestPath: input.manifestPath,
    manifestDir,
    exports: input.manifest.exports,
  });
  const stagedSources = normalizeExtensionStagedSources(
    input.manifestPath,
    input.manifest.veryfront?.npm?.stagedSources ?? [],
  );

  return {
    manifestPath: input.manifestPath,
    manifestDir,
    entryPoints,
    entryPoint: entryPoints.find((entryPoint) => entryPoint.name === ".")!
      .path,
    packageName,
    packageDirectoryName,
    manifestDependencies: dependencies,
    peerVeryfront: true,
    readmePath: join(manifestDir, "README.md"),
    stagedSources,
    dntMappings: createVeryfrontDntMappings({
      manifest: input.manifest,
      manifestDir,
      rootConfig: input.rootConfig,
      rootDir: input.rootDir,
      version: input.version,
    }),
    packageJson: {
      name: packageName,
      version: input.version,
      description: `Veryfront first-party extension package for ${
        extensionNameFromPackageName(packageName)
      }`,
      license: input.license,
      author: "Veryfront",
      repository: {
        type: "git",
        url: "git+https://github.com/veryfront/veryfront-code.git",
        directory: manifestDir,
      },
      bugs: {
        url: "https://github.com/veryfront/veryfront-code/issues",
      },
      homepage:
        `https://github.com/veryfront/veryfront-code/tree/main/${manifestDir}`,
      engines: {
        node: extensionNodeEngine(input.manifest),
      },
      peerDependencies: {
        veryfront: veryfrontPeerRange,
      },
      dependencies,
      keywords: [
        "veryfront",
        "extension",
        extensionNameFromPackageName(packageName),
      ],
      publishConfig: {
        access: "public",
      },
      veryfront: input.manifest.veryfront,
    },
  };
}

function createRuntimeExtensionPackageSpec(input: {
  manifestPath: string;
  manifest: ExtensionManifest;
  rootConfig: RootPackageConfig;
  rootDir: string;
  version: string;
  license: string;
  baseSpec: ExtensionPackageSpec;
  runtimePackage: ExtensionRuntimePackageManifest;
}): ExtensionPackageSpec {
  const runtimePackage = input.runtimePackage;
  if (!runtimePackage.name?.startsWith("@veryfront/ext-")) {
    throw new Error(
      `${input.manifestPath} runtime package name must start with @veryfront/ext-; received ${runtimePackage.name}`,
    );
  }

  const sourceEntryPoint = input.baseSpec.entryPoints.find((entryPoint) =>
    entryPoint.name === runtimePackage.export
  );
  if (!sourceEntryPoint) {
    throw new Error(
      `${input.manifestPath} runtime package ${runtimePackage.name} references missing export "${runtimePackage.export}"`,
    );
  }

  const allDependencies = manifestDependencies(input.manifest);
  const dependencies: Record<string, string> = {};
  for (const dependency of runtimePackage.dependencies) {
    const version = allDependencies[dependency];
    if (!version) {
      throw new Error(
        `${input.manifestPath} runtime package ${runtimePackage.name} references dependency "${dependency}" that is not declared in imports`,
      );
    }
    dependencies[dependency] = version;
  }

  const peerVeryfront = runtimePackage.peerVeryfront !== false;
  const packageJson: ExtensionPackageJson = {
    name: runtimePackage.name,
    version: input.version,
    description: `Veryfront first-party extension package for ${
      extensionNameFromPackageName(runtimePackage.name)
    }`,
    license: input.license,
    author: "Veryfront",
    repository: {
      type: "git",
      url: "git+https://github.com/veryfront/veryfront-code.git",
      directory: input.baseSpec.manifestDir,
    },
    bugs: {
      url: "https://github.com/veryfront/veryfront-code/issues",
    },
    homepage:
      `https://github.com/veryfront/veryfront-code/tree/main/${input.baseSpec.manifestDir}`,
    engines: {
      node: extensionNodeEngine(input.manifest),
    },
    dependencies,
    keywords: [
      "veryfront",
      "extension",
      extensionNameFromPackageName(runtimePackage.name),
    ],
    publishConfig: {
      access: "public",
    },
  };
  if (peerVeryfront) {
    packageJson.peerDependencies = {
      veryfront: `^${input.version}`,
    };
  }

  return {
    manifestPath: input.manifestPath,
    manifestDir: input.baseSpec.manifestDir,
    entryPoints: [{
      name: ".",
      path: sourceEntryPoint.path,
    }],
    entryPoint: sourceEntryPoint.path,
    packageName: runtimePackage.name,
    packageDirectoryName: extensionPackageDirectoryName(runtimePackage.name),
    manifestDependencies: dependencies,
    peerVeryfront,
    readmePath: input.baseSpec.readmePath,
    stagedSources: input.baseSpec.stagedSources,
    dntMappings: peerVeryfront ? input.baseSpec.dntMappings : {},
    packageJson,
  };
}

function normalizeExtensionStagedSources(
  manifestPath: string,
  stagedSources: ExtensionStagedSourceManifest[],
): ExtensionStagedSourceManifest[] {
  return stagedSources.map((stagedSource) => {
    if (!stagedSource.specifier || stagedSource.specifier.startsWith(".")) {
      throw new Error(
        `${manifestPath} staged source specifier must be a non-relative import; received "${stagedSource.specifier}"`,
      );
    }
    validateRepositoryRelativePath(
      manifestPath,
      "source",
      stagedSource.source,
    );
    validateRepositoryRelativePath(
      manifestPath,
      "target",
      stagedSource.target,
    );
    return { ...stagedSource };
  });
}

function validateRepositoryRelativePath(
  manifestPath: string,
  field: "source" | "target",
  path: string,
): void {
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.split(/[\\/]/).includes("..")
  ) {
    throw new Error(
      `${manifestPath} staged ${field} path must stay within the repository; received "${path}"`,
    );
  }
}

export function normalizeExtensionPackageJson(input: {
  packageJson: Record<string, unknown>;
  spec: ExtensionPackageSpec;
  version: string;
}): Record<string, unknown> {
  const pkg = input.packageJson as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    exports?: Record<string, string | { import?: string; types?: string }>;
    module?: string;
    types?: string;
    files?: string[];
    type?: string;
    veryfront?: unknown;
    _generatedBy?: string;
    devDependencies?: Record<string, string>;
  };

  const dependencies: Record<string, string> = {};
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (name.startsWith("@deno/shim-")) {
      dependencies[name] = version;
    }
  }
  for (
    const [name, version] of Object.entries(input.spec.manifestDependencies)
  ) {
    dependencies[name] = version;
  }
  if (Object.keys(dependencies).length === 0) {
    delete pkg.dependencies;
  } else {
    pkg.dependencies = dependencies;
  }

  if (input.spec.peerVeryfront) {
    pkg.peerDependencies ??= {};
    pkg.peerDependencies.veryfront = `^${input.version}`;
  } else {
    delete pkg.peerDependencies;
  }

  pkg.type = "module";
  const importPath = packageImportPath(pkg);
  if (importPath) {
    pkg.types = importPath.replace(/\.js$/, ".d.ts");
  }
  addExportTypes(pkg);
  pkg.files = ["esm", "LICENSE", "NOTICE", "README.md"];
  if (input.spec.packageJson.veryfront === undefined) {
    delete pkg.veryfront;
  } else {
    pkg.veryfront = input.spec.packageJson.veryfront;
  }
  delete pkg.devDependencies;
  delete pkg._generatedBy;

  return pkg;
}

function validateExtensionExportName(
  manifestPath: string,
  exportName: string,
): void {
  if (
    exportName === "." ||
    (
      exportName.startsWith("./") &&
      !exportName.endsWith("/") &&
      !exportName.includes("//") &&
      !exportName.split("/").includes("..")
    )
  ) {
    return;
  }

  throw new Error(
    `${manifestPath} contains unsupported extension export key "${exportName}". Export keys must be "." or package subpaths such as "./node".`,
  );
}

function resolveExtensionExportPath(input: {
  manifestPath: string;
  manifestDir: string;
  exportName: string;
  exportPath: string;
}): string {
  if (
    !input.exportPath.startsWith("./") ||
    input.exportPath.endsWith("/") ||
    input.exportPath.includes("//") ||
    input.exportPath.split("/").includes("..")
  ) {
    throw new Error(
      `${input.manifestPath} export "${input.exportName}" must point to a local file path such as "./src/index.ts"; received "${input.exportPath}".`,
    );
  }

  return join(input.manifestDir, input.exportPath);
}

function addExportTypes(pkg: {
  exports?: Record<string, string | { import?: string; types?: string }>;
}): void {
  if (!pkg.exports) return;

  for (const [exportName, exportValue] of Object.entries(pkg.exports)) {
    if (typeof exportValue === "string") {
      if (exportValue.endsWith(".js")) {
        pkg.exports[exportName] = {
          import: exportValue,
          types: exportValue.replace(/\.js$/, ".d.ts"),
        };
      }
      continue;
    }

    if (typeof exportValue.import === "string") {
      exportValue.types = exportValue.import.replace(/\.js$/, ".d.ts");
    }
  }
}

const BARE_IMPORT_SPECIFIER_PATTERNS = [
  // Static imports with bindings: `import x from "pkg"`, `import { a } from "pkg"`.
  /^\s*import\s[^"'()]*?from\s*["']([^"'\n]+)["']/gm,
  // Side-effect-only static imports: `import "pkg";`.
  /^\s*import\s*["']([^"'\n]+)["']/gm,
  // Re-exports: `export { a } from "pkg"`, `export * from "pkg"`.
  /^\s*export\s[^"'()]*?from\s*["']([^"'\n]+)["']/gm,
  // Dynamic imports: `import("pkg")`.
  /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  // CommonJS requires: `require("pkg")`.
  /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
];

/**
 * Extracts the npm package names imported via bare specifiers in emitted
 * JavaScript source. Relative/absolute specifiers and scheme-prefixed
 * specifiers such as `node:` builtins are ignored, and subpath imports
 * (`pkg/sub`, `@scope/pkg/sub`) are reduced to their package name.
 */
export function bareImportPackageNames(source: string): string[] {
  const packageNames = new Set<string>();

  for (const pattern of BARE_IMPORT_SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const packageName = bareSpecifierPackageName(match[1]!);
      if (packageName) packageNames.add(packageName);
    }
  }

  return [...packageNames].toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function bareSpecifierPackageName(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  // Scheme-prefixed specifiers (node:, data:, https:, ...) are not npm packages.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) return undefined;

  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    if (segments.length < 2 || !segments[1]) return undefined;
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] || undefined;
}

export function createVeryfrontPeerTypeImportReplacements(input: {
  rootConfig: RootPackageConfig;
  outDir: string;
  fromFile: string;
}): Record<string, string> {
  const replacements: Record<string, string> = {};

  for (
    const [exportPath, target] of Object.entries(input.rootConfig.exports ?? {})
  ) {
    const emittedTarget = emittedRootExportPath(target);
    if (!emittedTarget) continue;

    let specifier = relative(
      dirname(input.fromFile),
      join(input.outDir, "esm", emittedTarget),
    ).replaceAll("\\", "/");
    if (!specifier.startsWith(".")) {
      specifier = `./${specifier}`;
    }

    replacements[specifier] = exportPath === "."
      ? "veryfront"
      : `veryfront/${exportPath.replace(/^\.\//, "")}`;
  }

  return replacements;
}

function packageImportPath(
  pkg: {
    module?: string;
    exports?: Record<string, string | { import?: string }>;
  },
): string | undefined {
  const rootExport = pkg.exports?.["."];
  if (typeof rootExport === "object" && typeof rootExport.import === "string") {
    return rootExport.import;
  }
  if (typeof rootExport === "string") return rootExport;
  return pkg.module;
}

function emittedRootExportPath(target: string): string | undefined {
  if (!target.startsWith("./src/")) return undefined;
  return target.replace(/^\.\//, "").replace(/\.(?:tsx?|jsx?)$/, ".js");
}

function createVeryfrontDntMappings(input: {
  manifest: ExtensionManifest;
  manifestDir: string;
  rootConfig: RootPackageConfig;
  rootDir: string;
  version: string;
}): Record<string, NpmPackageMapping> {
  const exportSubpaths = new Set(Object.keys(input.rootConfig.exports ?? {}));
  const mappings: Record<string, NpmPackageMapping> = {};

  for (
    const [specifier, target] of Object.entries(input.manifest.imports ?? {})
  ) {
    if (specifier.startsWith("@veryfront/ext-") && target.startsWith(".")) {
      const resolvedTarget = resolveManifestTarget(input.manifestDir, target);
      mappings[toFileUrl(join(input.rootDir, resolvedTarget)).href] = {
        name: specifier,
        version: input.version,
      };
      continue;
    }
    if (!specifier.startsWith("veryfront/")) continue;

    const exportSubpath = `./${specifier.slice("veryfront/".length)}`;
    if (!exportSubpaths.has(exportSubpath)) continue;

    const resolvedTarget = resolveManifestTarget(input.manifestDir, target);
    mappings[toFileUrl(join(input.rootDir, resolvedTarget)).href] = {
      name: "veryfront",
      version: `^${input.version}`,
      subPath: exportSubpath.slice(2),
    };
  }

  return mappings;
}

function resolveManifestTarget(manifestDir: string, target: string): string {
  if (!target.startsWith(".")) {
    return target;
  }
  return normalize(join(manifestDir, target));
}
