import { dirname, join, normalize, relative, toFileUrl } from "#std/path";
import type { PackageJson } from "#dnt";
import { parseNpmImport } from "./npm-dependency-sources.ts";

export type ExtensionManifest = {
  name: string;
  version?: string;
  exports: string;
  veryfront?: {
    extension?: boolean;
    contracts?: {
      provides?: string[];
      requires?: string[];
    };
    capabilities?: unknown[];
  };
  imports?: Record<string, string>;
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

export type ExtensionPackageSpec = {
  manifestPath: string;
  manifestDir: string;
  entryPoint: string;
  packageName: string;
  packageDirectoryName: string;
  packageJson: PackageJson;
  dntMappings: Record<string, NpmPackageMapping>;
  manifestDependencies: Record<string, string>;
  readmePath: string;
};

const TEST_ONLY_IMPORTS = new Set([
  "@std/assert",
  "@std/testing/bdd",
]);

export function firstPartyExtensionManifestPaths(
  rootConfig: RootPackageConfig,
): string[] {
  return (rootConfig.workspace ?? [])
    .filter((entry) => entry.startsWith("./extensions/"))
    .map((entry) => `${entry.replace(/^\.\//, "")}/deno.json`)
    .toSorted();
}

export function extensionPackageDirectoryName(packageName: string): string {
  return packageName.replace(/^@veryfront\//, "");
}

export function extensionNameFromPackageName(packageName: string): string {
  return packageName.replace(/^@veryfront\//, "");
}

export function manifestDependencies(
  manifest: ExtensionManifest,
): Record<string, string> {
  const dependencies: Record<string, string> = {};

  for (const [specifier, target] of Object.entries(manifest.imports ?? {})) {
    if (TEST_ONLY_IMPORTS.has(specifier)) continue;

    const parsed = parseNpmImport(target);
    if (!parsed) continue;

    dependencies[parsed.name] = parsed.version;
  }

  return Object.fromEntries(
    Object.entries(dependencies).toSorted(([left], [right]) =>
      left.localeCompare(right)
    ),
  );
}

export function createExtensionPackageSpec(input: {
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
  const dependencies = manifestDependencies(input.manifest);
  const veryfrontPeerRange = `^${input.version}`;

  return {
    manifestPath: input.manifestPath,
    manifestDir,
    entryPoint: join(manifestDir, input.manifest.exports),
    packageName,
    packageDirectoryName,
    manifestDependencies: dependencies,
    readmePath: join(manifestDir, "README.md"),
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
        node: ">=18.0.0",
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

  pkg.peerDependencies ??= {};
  pkg.peerDependencies.veryfront = `^${input.version}`;

  pkg.type = "module";
  const importPath = packageImportPath(pkg);
  if (importPath) {
    pkg.types = importPath.replace(/\.js$/, ".d.ts");
    if (pkg.exports?.["."] && typeof pkg.exports["."] === "object") {
      pkg.exports["."].types = pkg.types;
    }
  }
  pkg.files = ["esm", "LICENSE", "NOTICE", "README.md"];
  pkg.veryfront = input.spec.packageJson.veryfront;
  delete pkg.devDependencies;
  delete pkg._generatedBy;

  return pkg;
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

  return [...packageNames].toSorted();
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
