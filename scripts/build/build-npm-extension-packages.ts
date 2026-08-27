import { build, emptyDir } from "#dnt";
import { basename, dirname, join, relative, toFileUrl } from "#std/path";
import {
  patchDntArgvPolyfill,
  patchDntCryptoShim,
  patchDntDenoShim,
} from "./dnt-polyfill.ts";
import { NPM_DNT_COMPILER_OPTIONS } from "./dnt-compiler-options.ts";
import {
  bareImportPackageNames,
  createExtensionPackageSpecs,
  createVeryfrontPeerTypeImportReplacements,
  type ExtensionManifest,
  type ExtensionPackageSpec,
  firstPartyExtensionManifestPaths,
  normalizeExtensionPackageJson,
  type RootPackageConfig,
} from "./npm-extension-package-metadata.ts";

export type BuildExtensionPackagesOptions = {
  rootDir: string;
  outDir: string;
  rootConfig: RootPackageConfig;
  version: string;
  license: string;
};

export async function buildExtensionPackages(
  options: BuildExtensionPackagesOptions,
): Promise<void> {
  await emptyDir(options.outDir);

  const manifestPaths = firstPartyExtensionManifestPaths(options.rootConfig);
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(
      await Deno.readTextFile(`${options.rootDir}/${manifestPath}`),
    ) as ExtensionManifest;
    const specs = createExtensionPackageSpecs({
      manifestPath,
      manifest,
      rootConfig: options.rootConfig,
      rootDir: options.rootDir,
      version: options.version,
      license: options.license,
    });
    for (const spec of specs) {
      await buildExtensionPackage(options, spec);
    }
  }
}

async function buildExtensionPackage(
  options: BuildExtensionPackagesOptions,
  spec: ExtensionPackageSpec,
): Promise<void> {
  const outDir = `${options.outDir}/${spec.packageDirectoryName}`;

  console.log(`📦 Building ${spec.packageName}...`);
  const preparedInput = await prepareDntExtensionBuildInput({
    rootDir: options.rootDir,
    spec,
  });
  try {
    await build({
      entryPoints: preparedInput.entryPoints,
      outDir,
      test: false,
      scriptModule: false,
      declarationMap: true,
      typeCheck: false,
      skipNpmInstall: true,
      shims: {
        deno: true,
        crypto: true,
      },
      compilerOptions: NPM_DNT_COMPILER_OPTIONS,
      mappings: spec.dntMappings,
      package: spec.packageJson,
      async postBuild() {
        const pkgPath = `${outDir}/package.json`;
        const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
        normalizeExtensionPackageJson({
          packageJson: pkg,
          spec,
          version: options.version,
        });
        await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));

        await rewriteVeryfrontPeerTypeImports({
          outDir,
          rootConfig: options.rootConfig,
        });
        await patchDntArgvPolyfill(`${outDir}/esm/_dnt.polyfills.js`);
        await patchDntDenoShim(`${outDir}/esm/_dnt.shims.js`);
        await patchDntCryptoShim(`${outDir}/esm/_dnt.shims.js`);

        await Deno.copyFile(`${options.rootDir}/LICENSE`, `${outDir}/LICENSE`);
        await Deno.copyFile(`${options.rootDir}/NOTICE`, `${outDir}/NOTICE`);
        await Deno.copyFile(
          `${options.rootDir}/${spec.readmePath}`,
          `${outDir}/README.md`,
        );

        if (spec.packageName === "@veryfront/ext-document-kreuzberg") {
          await transpileDocumentExtractionWorker(options.rootDir, outDir);
        }

        await removeUnusedBundledRootSource(outDir, pkg);
        await removeDntImportMapArtifacts(outDir, spec);
        await removeUnreferencedTopLevelDir(outDir, "react");
        await removeUnreferencedDntDeps(outDir);

        await assertPackageEntryPointsExist({
          outDir,
          packageName: spec.packageName,
          packageJson: pkg,
        });
        await assertEmittedBareImportsAreDeclared({
          outDir,
          packageName: spec.packageName,
        });
      },
    });
  } finally {
    await preparedInput.cleanup();
  }
}

export function createDntExtensionEntryPoints(input: {
  rootDir: string;
  spec: Pick<ExtensionPackageSpec, "entryPoints">;
}): { name: string; path: string }[] {
  return input.spec.entryPoints.map((entryPoint) => ({
    name: entryPoint.name,
    path: `${input.rootDir}/${entryPoint.path}`,
  }));
}

async function prepareDntExtensionBuildInput(input: {
  rootDir: string;
  spec: Pick<ExtensionPackageSpec, "entryPoints" | "manifestDir" | "stagedSources">;
}): Promise<
  { entryPoints: { name: string; path: string }[]; cleanup(): Promise<void> }
> {
  if (input.spec.stagedSources.length === 0) {
    return {
      entryPoints: createDntExtensionEntryPoints({
        rootDir: input.rootDir,
        spec: input.spec,
      }),
      cleanup: () => Promise.resolve(),
    };
  }

  const tempDir = await Deno.makeTempDir({
    prefix: "veryfront-extension-dnt-",
  });
  const stagedExtensionDir = join(tempDir, basename(input.spec.manifestDir));
  const sourceExtensionDir = join(input.rootDir, input.spec.manifestDir);
  await copyDirectory(sourceExtensionDir, stagedExtensionDir);

  const stagedSourceTargets = new Map<string, string>();
  for (const stagedSource of input.spec.stagedSources) {
    const targetPath = join(stagedExtensionDir, stagedSource.target);
    await Deno.mkdir(dirname(targetPath), { recursive: true });
    await Deno.copyFile(join(input.rootDir, stagedSource.source), targetPath);
    stagedSourceTargets.set(stagedSource.specifier, targetPath);
  }

  const usedSpecifiers = new Set<string>();

  for await (const filePath of walkFiles(stagedExtensionDir)) {
    if (!filePath.endsWith(".ts")) continue;
    const original = await Deno.readTextFile(filePath);
    let next = original;
    for (const [specifier, targetPath] of stagedSourceTargets) {
      if (!next.includes(specifier)) continue;
      let targetSpecifier = relative(dirname(filePath), targetPath).replaceAll("\\", "/");
      if (!targetSpecifier.startsWith(".")) targetSpecifier = `./${targetSpecifier}`;
      next = next.replaceAll(specifier, targetSpecifier);
      usedSpecifiers.add(specifier);
    }
    next = next.replaceAll(
      '"veryfront/extensions"',
      `"${toFileUrl(join(input.rootDir, "src/extensions/index.ts")).href}"`,
    );
    if (next !== original) {
      await Deno.writeTextFile(filePath, next);
    }
  }

  for (const stagedSource of input.spec.stagedSources) {
    if (!usedSpecifiers.has(stagedSource.specifier)) {
      await Deno.remove(tempDir, { recursive: true });
      throw new Error(
        `${input.spec.manifestDir} staged source specifier "${stagedSource.specifier}" is not imported by extension source`,
      );
    }
  }

  return {
    entryPoints: input.spec.entryPoints.map((entryPoint) => ({
      name: entryPoint.name,
      path: join(
        stagedExtensionDir,
        relative(input.spec.manifestDir, entryPoint.path),
      ),
    })),
    cleanup: () => Deno.remove(tempDir, { recursive: true }),
  };
}

async function copyDirectory(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await Deno.mkdir(targetDir, { recursive: true });
  for await (const entry of Deno.readDir(sourceDir)) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile) {
      await Deno.copyFile(sourcePath, targetPath);
    }
  }
}

async function rewriteVeryfrontPeerTypeImports(input: {
  outDir: string;
  rootConfig: RootPackageConfig;
}): Promise<void> {
  for await (const filePath of walkFiles(`${input.outDir}/esm`)) {
    if (!filePath.endsWith(".d.ts")) continue;

    const replacements = createVeryfrontPeerTypeImportReplacements({
      rootConfig: input.rootConfig,
      outDir: input.outDir,
      fromFile: filePath,
    });
    const original = await Deno.readTextFile(filePath);
    let next = original;

    for (const [source, target] of Object.entries(replacements)) {
      next = next.replaceAll(`"${source}"`, `"${target}"`);
      next = next.replaceAll(`'${source}'`, `'${target}'`);
    }

    if (next !== original) {
      await Deno.writeTextFile(filePath, next);
    }
  }
}

async function removeUnusedBundledRootSource(
  outDir: string,
  packageJson: Record<string, unknown>,
): Promise<void> {
  const rootSourceDir = `${outDir}/esm/src`;
  if (!await directoryExists(rootSourceDir)) return;
  if (
    extensionPackageEntryPointPaths(packageJson).some((target) =>
      target === "./esm/src" || target.startsWith("./esm/src/")
    )
  ) {
    return;
  }
  if (await hasGeneratedRootSourceReferences(outDir)) return;

  await Deno.remove(rootSourceDir, { recursive: true });
}

/**
 * Returns the local files exposed by generated package entry-point metadata.
 * Conditional and nested export maps are traversed so artifact validation does
 * not silently miss a target added by a future DNT release.
 */
export function extensionPackageEntryPointPaths(
  packageJson: Record<string, unknown>,
): string[] {
  const paths = new Set<string>();
  const addTarget = (target: unknown): void => {
    if (typeof target === "string") {
      paths.add(target);
      return;
    }
    if (Array.isArray(target)) {
      for (const candidate of target) addTarget(candidate);
      return;
    }
    if (target === null || typeof target !== "object") return;
    for (const candidate of Object.values(target)) addTarget(candidate);
  };

  addTarget(packageJson.main);
  addTarget(packageJson.module);
  addTarget(packageJson.types);
  addTarget(packageJson.exports);
  return [...paths].toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export async function assertPackageEntryPointsExist(input: {
  outDir: string;
  packageName: string;
  packageJson: Record<string, unknown>;
}): Promise<void> {
  for (const target of extensionPackageEntryPointPaths(input.packageJson)) {
    const segments = target.split("/");
    if (
      !target.startsWith("./") ||
      target.includes("\\") ||
      segments.includes("..") ||
      target.includes("*")
    ) {
      throw new Error(
        `${input.packageName} generated an unsupported package entry-point target: ${target}`,
      );
    }

    const filePath = join(input.outDir, ...segments.slice(1));
    try {
      const stat = await Deno.stat(filePath);
      if (!stat.isFile) {
        throw new Error(
          `${input.packageName} package entry point ${target} is not a file`,
        );
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(
          `${input.packageName} package entry point ${target} was not emitted`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

async function removeDntImportMapArtifacts(
  outDir: string,
  spec: Pick<ExtensionPackageSpec, "entryPoints">,
): Promise<void> {
  if (await hasGeneratedDntImportMapReferences(outDir)) return;
  if (
    spec.entryPoints.some((entryPoint) =>
      entryPoint.name === "./deno" || entryPoint.path.endsWith("/deno.ts")
    )
  ) {
    return;
  }

  await removeIfExists(`${outDir}/esm/deno.js`);
  await removeIfExists(`${outDir}/esm/deno.d.ts`);
  await removeIfExists(`${outDir}/esm/deno.d.ts.map`);
}

async function removeUnreferencedTopLevelDir(
  outDir: string,
  directoryName: string,
): Promise<void> {
  const directoryPath = `${outDir}/esm/${directoryName}`;
  if (!await directoryExists(directoryPath)) return;
  if (await hasGeneratedTopLevelDirReferences(outDir, directoryName)) return;

  await Deno.remove(directoryPath, { recursive: true });
}

async function removeUnreferencedDntDeps(outDir: string): Promise<void> {
  const depsDir = `${outDir}/esm/deps`;
  if (!await directoryExists(depsDir)) return;
  if (await hasGeneratedDntDepsReferences(outDir)) return;

  await Deno.remove(depsDir, { recursive: true });
}

async function assertEmittedBareImportsAreDeclared(input: {
  outDir: string;
  packageName: string;
}): Promise<void> {
  const pkg = JSON.parse(
    await Deno.readTextFile(`${input.outDir}/package.json`),
  ) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);

  const missing = new Map<string, Set<string>>();
  for await (const filePath of walkFiles(`${input.outDir}/esm`)) {
    if (!filePath.endsWith(".js")) continue;

    const text = await Deno.readTextFile(filePath);
    for (const packageName of bareImportPackageNames(text)) {
      if (declared.has(packageName)) continue;
      const files = missing.get(packageName) ?? new Set<string>();
      files.add(filePath.slice(`${input.outDir}/`.length));
      missing.set(packageName, files);
    }
  }

  if (missing.size === 0) return;

  const details = [...missing.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([packageName, files]) => {
      const sortedFiles = [...files].toSorted((left, right) =>
        left < right ? -1 : left > right ? 1 : 0
      );
      return `  ${packageName} (imported by ${sortedFiles.join(", ")})`;
    })
    .join("\n");
  throw new Error(
    `${input.packageName} emits imports of npm packages that are not declared in its package.json dependencies, peerDependencies, or optionalDependencies:\n${details}\nDeclare them in the extension's deno.json imports so they are published as dependencies.`,
  );
}

async function hasGeneratedRootSourceReferences(
  outDir: string,
): Promise<boolean> {
  const rootSourceDir = `${outDir}/esm/src`;
  const relativeRootSourceSpecifier =
    /(?:from\s+|import\s*\(\s*|import\s+)["'](?:\.\.\/)+src\//;

  for await (const filePath of walkFiles(`${outDir}/esm`)) {
    if (filePath.startsWith(`${rootSourceDir}/`)) continue;
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;

    const text = await Deno.readTextFile(filePath);
    if (relativeRootSourceSpecifier.test(text)) {
      return true;
    }
  }

  return false;
}

async function hasGeneratedDntImportMapReferences(
  outDir: string,
): Promise<boolean> {
  const dntImportMapSpecifier =
    /(?:from\s+|import\s*\(\s*|import\s+)["'](?:\.\.\/)+deno\.js["']/;

  for await (const filePath of walkFiles(`${outDir}/esm`)) {
    if (filePath === `${outDir}/esm/deno.js`) continue;
    if (filePath === `${outDir}/esm/deno.d.ts`) continue;
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;

    const text = await Deno.readTextFile(filePath);
    if (dntImportMapSpecifier.test(text)) {
      return true;
    }
  }

  return false;
}

async function hasGeneratedTopLevelDirReferences(
  outDir: string,
  directoryName: string,
): Promise<boolean> {
  const directoryPath = `${outDir}/esm/${directoryName}`;
  const marker = `/${directoryName}/`;

  for await (const filePath of walkFiles(`${outDir}/esm`)) {
    if (filePath.startsWith(`${directoryPath}/`)) continue;
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;

    const text = await Deno.readTextFile(filePath);
    if (text.includes(marker)) {
      return true;
    }
  }

  return false;
}

async function hasGeneratedDntDepsReferences(outDir: string): Promise<boolean> {
  const depsDir = `${outDir}/esm/deps`;

  for await (const filePath of walkFiles(`${outDir}/esm`)) {
    if (filePath.startsWith(`${depsDir}/`)) continue;
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;

    const text = await Deno.readTextFile(filePath);
    if (text.includes("/deps/")) {
      return true;
    }
  }

  return false;
}

async function transpileDocumentExtractionWorker(
  rootDir: string,
  outDir: string,
): Promise<void> {
  const esbuild = await import("npm:esbuild@0.28.1");
  try {
    for (
      const workerName of [
        "upload-extraction-worker",
        "native-progress-extraction-worker",
        "native-extraction",
        "native-extraction-process",
      ]
    ) {
      const workerSrc =
        `${rootDir}/extensions/ext-document-kreuzberg/src/${workerName}.ts`;
      const workerDest =
        `${outDir}/esm/extensions/ext-document-kreuzberg/src/${workerName}.js`;
      const transpiled = await esbuild.transform(
        await Deno.readTextFile(workerSrc),
        {
          loader: "ts",
          format: "esm",
          target: "esnext",
        },
      );
      await Deno.mkdir(dirname(workerDest), { recursive: true });
      await Deno.writeTextFile(
        workerDest,
        rewriteLocalTypeScriptImports(transpiled.code),
      );
    }
    console.log(
      "📝 Transpiled @veryfront/ext-document-kreuzberg extraction workers",
    );
  } finally {
    await esbuild.stop();
  }
}

function rewriteLocalTypeScriptImports(code: string): string {
  const rewritten = code.replaceAll(
    /(["'])\.\/([^"']+)\.ts\1/g,
    "$1./$2.js$1",
  );

  const leftoverLocalTypeScriptImport = /["']\.\/[^"']+\.ts["']/;
  if (leftoverLocalTypeScriptImport.test(rewritten)) {
    throw new Error(
      "Transpiled extraction worker still contains a local .ts import",
    );
  }

  return rewritten;
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  if (!await directoryExists(root)) return;

  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkFiles(path);
    } else if (entry.isFile) {
      yield path;
    }
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
