import { build, emptyDir } from "#dnt";
import { dirname } from "#std/path";
import {
  bareImportPackageNames,
  createExtensionPackageSpec,
  createVeryfrontPeerTypeImportReplacements,
  type ExtensionManifest,
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
    const spec = createExtensionPackageSpec({
      manifestPath,
      manifest,
      rootConfig: options.rootConfig,
      rootDir: options.rootDir,
      version: options.version,
      license: options.license,
    });
    const outDir = `${options.outDir}/${spec.packageDirectoryName}`;

    console.log(`📦 Building ${spec.packageName}...`);
    await build({
      entryPoints: [{
        name: ".",
        path: `${options.rootDir}/${spec.entryPoint}`,
      }],
      outDir,
      test: false,
      scriptModule: false,
      typeCheck: false,
      skipNpmInstall: true,
      shims: {
        deno: true,
        timers: true,
        crypto: true,
      },
      compilerOptions: {
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        target: "ES2022",
        skipLibCheck: true,
      },
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

        await Deno.copyFile(`${options.rootDir}/LICENSE`, `${outDir}/LICENSE`);
        await Deno.copyFile(`${options.rootDir}/NOTICE`, `${outDir}/NOTICE`);
        await Deno.copyFile(
          `${options.rootDir}/${spec.readmePath}`,
          `${outDir}/README.md`,
        );

        if (spec.packageName === "@veryfront/ext-document-kreuzberg") {
          await transpileDocumentExtractionWorker(options.rootDir, outDir);
        }

        await removeUnusedBundledRootSource(outDir);
        await removeDntImportMapArtifacts(outDir);
        await removeUnreferencedTopLevelDir(outDir, "react");
        await removeUnreferencedDntDeps(outDir);

        await assertEmittedBareImportsAreDeclared({
          outDir,
          packageName: spec.packageName,
        });
      },
    });
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

async function removeUnusedBundledRootSource(outDir: string): Promise<void> {
  const rootSourceDir = `${outDir}/esm/src`;
  if (!await directoryExists(rootSourceDir)) return;
  if (await hasGeneratedRootSourceReferences(outDir)) return;

  await Deno.remove(rootSourceDir, { recursive: true });
}

async function removeDntImportMapArtifacts(outDir: string): Promise<void> {
  if (await hasGeneratedDntImportMapReferences(outDir)) return;

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
    .map(([packageName, files]) =>
      `  ${packageName} (imported by ${[...files].toSorted().join(", ")})`
    )
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
    const workerSrc =
      `${rootDir}/extensions/ext-document-kreuzberg/src/upload-extraction-worker.ts`;
    const workerDest =
      `${outDir}/esm/extensions/ext-document-kreuzberg/src/upload-extraction-worker.js`;
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
      transpiled.code.replaceAll("./kreuzberg.ts", "./kreuzberg.js"),
    );
    console.log(
      "📝 Transpiled @veryfront/ext-document-kreuzberg upload-extraction worker",
    );
  } finally {
    await esbuild.stop();
  }
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
